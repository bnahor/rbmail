import { isAuthorized, unauthorized } from "@/lib/server/auth";
import { changeThread } from "@/lib/server/mail-actions";

export const runtime = "nodejs";

export async function POST(
  request: Request,
  context: { params: Promise<{ id: string }> },
) {
  if (!isAuthorized(request)) return unauthorized();
  const { id } = await context.params;
  const input = (await request.json()) as {
    action?: "read" | "unread" | "archive";
  };
  if (!input.action || !["read", "unread", "archive"].includes(input.action)) {
    return Response.json({ error: "Invalid mail action." }, { status: 400 });
  }
  try {
    await changeThread(id, input.action);
    return Response.json({ ok: true });
  } catch (error) {
    return Response.json(
      { error: error instanceof Error ? error.message : "Mail action failed." },
      { status: 502 },
    );
  }
}
