import { requireUser, unauthorized } from "@/lib/server/auth";
import type { ComposeMessageInput, MailAddress } from "@/lib/mail/types";
import {
  getAccount,
  getMailMutation,
  saveDraft,
  saveMailMutation,
} from "@/lib/server/db";
import { sendComposedMessage } from "@/lib/server/mail-actions";

export const runtime = "nodejs";

export async function POST(request: Request) {
  const user = await requireUser(request);
  if (!user) return unauthorized();
  const raw = (await request.json()) as Partial<ComposeMessageInput> & {
    accountId?: string;
    to?: string;
    subject?: string;
    body?: string;
  };
  const legacyAddress = (value: string): MailAddress => ({
    name: value.trim(),
    address: value.trim().toLowerCase(),
  });
  const input: ComposeMessageInput = {
    accountId: raw.accountId || "",
    recipients: raw.recipients ?? {
      to: raw.to ? raw.to.split(",").map(legacyAddress) : [],
      cc: [],
      bcc: [],
    },
    subject: raw.subject?.trim() || "",
    bodyText: raw.bodyText?.trim() || raw.body?.trim() || "",
    bodyHtml: raw.bodyHtml,
    attachments: raw.attachments ?? [],
    threadId: raw.threadId,
    replyToMessageId: raw.replyToMessageId,
    inReplyTo: raw.inReplyTo,
    references: raw.references,
    replyMode: raw.replyMode,
    sendAt: raw.sendAt,
  };
  if (!input.accountId || !input.recipients.to.length || !input.bodyText.trim()) {
    return Response.json(
      { error: "Account, at least one recipient, and a message are required." },
      { status: 400 },
    );
  }
  if (!getAccount(input.accountId, user.id)) {
    return Response.json({ error: "Account not found." }, { status: 404 });
  }
  const key = request.headers.get("idempotency-key")?.trim();
  if (key) {
    const cached = getMailMutation<{ sent?: boolean; queued?: boolean; draftId?: string }>(user.id, key);
    if (cached) return Response.json(cached);
  }
  try {
    const future = input.sendAt && new Date(input.sendAt).getTime() > Date.now() + 1_000;
    const response = future
      ? (() => {
          const draft = saveDraft(user.id, input, {
            state: "queued",
            idempotencyKey: key,
          });
          return { queued: true, draftId: draft.id, sendAt: input.sendAt };
        })()
      : await (async () => {
          await sendComposedMessage(input);
          return { sent: true };
        })();
    if (key) saveMailMutation(user.id, key, response);
    return Response.json(response);
  } catch (error) {
    return Response.json(
      { error: error instanceof Error ? error.message : "Message failed." },
      { status: 502 },
    );
  }
}
