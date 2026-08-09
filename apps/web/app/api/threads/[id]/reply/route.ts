import { requireUser, unauthorized } from "@/lib/server/auth";
import type { ComposeMessageInput, MailAddress } from "@/lib/mail/types";
import { getMailMutation, getThread, saveMailMutation } from "@/lib/server/db";
import { sendComposedMessage } from "@/lib/server/mail-actions";

export const runtime = "nodejs";

export async function POST(
  request: Request,
  context: { params: Promise<{ id: string }> },
) {
  const user = await requireUser(request);
  if (!user) return unauthorized();
  const { id } = await context.params;
  const thread = getThread(id, user.id);
  if (!thread) {
    return Response.json({ error: "Thread not found." }, { status: 404 });
  }
  const input = (await request.json()) as {
    body?: string;
    bodyText?: string;
    bodyHtml?: string;
    mode?: "reply" | "replyAll";
    recipients?: ComposeMessageInput["recipients"];
    attachments?: ComposeMessageInput["attachments"];
  };
  const body = input.bodyText?.trim() || input.body?.trim();
  if (!body) {
    return Response.json({ error: "Reply cannot be empty." }, { status: 400 });
  }
  const latest = thread.messages.at(-1)!;
  const own = thread.email.toLowerCase();
  const unique = (values: MailAddress[]) =>
    values.filter(
      (value, index, all) =>
        value.address && value.address.toLowerCase() !== own &&
        all.findIndex((candidate) => candidate.address.toLowerCase() === value.address.toLowerCase()) === index,
    );
  const direct = latest.headers.replyTo.length ? latest.headers.replyTo : [latest.from];
  const recipients = input.recipients ?? {
    to: unique(input.mode === "replyAll" ? [...direct, ...latest.to] : direct),
    cc: input.mode === "replyAll" ? unique(latest.cc) : [],
    bcc: [],
  };
  const key = request.headers.get("idempotency-key")?.trim();
  if (key) {
    const cached = getMailMutation<{ sent: boolean }>(user.id, key);
    if (cached) return Response.json(cached);
  }
  try {
    await sendComposedMessage({
      accountId: thread.accountId,
      recipients,
      subject: /^re:/i.test(thread.subject) ? thread.subject : `Re: ${thread.subject}`,
      bodyText: body,
      bodyHtml: input.bodyHtml,
      attachments: input.attachments,
      threadId: thread.providerThreadId,
      replyMode: input.mode || "reply",
    });
    const response = { sent: true };
    if (key) saveMailMutation(user.id, key, response);
    return Response.json(response);
  } catch (error) {
    return Response.json(
      { error: error instanceof Error ? error.message : "Reply failed." },
      { status: 502 },
    );
  }
}
