import { requireUser, unauthorized } from "@/lib/server/auth";
import { getAccount, getAttachment } from "@/lib/server/db";
import { downloadGoogleAttachment } from "@/lib/server/google";
import { downloadMicrosoftAttachment } from "@/lib/server/microsoft";

export const runtime = "nodejs";
export const maxDuration = 60;

export async function GET(
  request: Request,
  context: { params: Promise<{ id: string; attachmentId: string }> },
) {
  const user = await requireUser(request);
  if (!user) return unauthorized();
  const { id, attachmentId } = await context.params;
  const found = getAttachment(id, attachmentId, user.id);
  if (!found?.message) {
    return Response.json({ error: "Attachment not found." }, { status: 404 });
  }
  const account = getAccount(found.message.accountId, user.id);
  if (!account) return Response.json({ error: "Account not found." }, { status: 404 });
  try {
    const bytes = found.attachment.contentBase64
      ? Buffer.from(
          found.attachment.contentBase64.replace(/-/g, "+").replace(/_/g, "/"),
          "base64",
        )
      : account.provider === "google"
        ? await downloadGoogleAttachment(
            account,
            found.message.providerId,
            found.attachment.providerAttachmentId,
          )
        : await downloadMicrosoftAttachment(
            account,
            found.message.providerId,
            found.attachment.providerAttachmentId,
          );
    const safeName = found.attachment.filename.replace(/[\r\n"\\/]/g, "_");
    const url = new URL(request.url);
    if (url.searchParams.get("encoding") === "base64") {
      return Response.json({
        contentBase64: bytes.toString("base64"),
        filename: safeName,
        mimeType: found.attachment.mimeType,
        size: bytes.length,
      });
    }
    const range = request.headers.get("range")?.match(/^bytes=(\d+)-(\d*)$/);
    const start = range ? Math.min(Number(range[1]), bytes.length) : 0;
    const requestedEnd = range?.[2] ? Number(range[2]) : bytes.length - 1;
    const end = range ? Math.min(Math.max(start, requestedEnd), bytes.length - 1) : bytes.length - 1;
    const payload = range ? bytes.subarray(start, end + 1) : bytes;
    return new Response(new Uint8Array(payload), {
      status: range ? 206 : 200,
      headers: {
        "content-type": found.attachment.mimeType || "application/octet-stream",
        "content-length": String(payload.length),
        "accept-ranges": "bytes",
        ...(range ? { "content-range": `bytes ${start}-${end}/${bytes.length}` } : {}),
        "content-disposition": `${found.attachment.inline ? "inline" : "attachment"}; filename="${safeName}"`,
        "cache-control": "private, max-age=300",
        "x-content-type-options": "nosniff",
        "content-security-policy": "default-src 'none'; sandbox",
      },
    });
  } catch (error) {
    return Response.json(
      { error: error instanceof Error ? error.message : "Attachment download failed." },
      { status: 502 },
    );
  }
}
