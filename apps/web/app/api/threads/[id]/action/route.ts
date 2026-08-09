import { requireUser, unauthorized } from "@/lib/server/auth";
import type { MailAction } from "@/lib/mail/types";
import {
  getMailMutation,
  getThread,
  saveMailMutation,
} from "@/lib/server/db";
import { changeThread } from "@/lib/server/mail-actions";

export const runtime = "nodejs";

export async function POST(
  request: Request,
  context: { params: Promise<{ id: string }> },
) {
  const user = await requireUser(request);
  if (!user) return unauthorized();
  const { id } = await context.params;
  if (!getThread(id, user.id)) {
    return Response.json({ error: "Thread not found." }, { status: 404 });
  }
  const input = (await request.json()) as {
    action?: MailAction;
    snoozedUntil?: string | null;
    expectedVersion?: number;
  };
  const actions: MailAction[] = [
    "read", "unread", "flag", "unflag", "archive", "trash", "restore",
    "junk", "not_junk", "mute", "unmute", "vip", "unvip", "snooze", "unsnooze",
  ];
  if (!input.action || !actions.includes(input.action)) {
    return Response.json({ error: "Invalid mail action." }, { status: 400 });
  }
  const thread = getThread(id, user.id)!;
  if (input.expectedVersion && input.expectedVersion !== thread.syncVersion) {
    return Response.json(
      { error: "This conversation changed on another device.", code: "stale_version", thread },
      { status: 409 },
    );
  }
  if (input.action === "snooze" && (!input.snoozedUntil || Number.isNaN(Date.parse(input.snoozedUntil)))) {
    return Response.json({ error: "Choose a valid snooze time." }, { status: 400 });
  }
  const key = request.headers.get("idempotency-key")?.trim();
  if (key) {
    const cached = getMailMutation<{ ok: boolean }>(user.id, key);
    if (cached) return Response.json(cached);
  }
  try {
    await changeThread(id, input.action, { snoozedUntil: input.snoozedUntil });
    const response = { ok: true, thread: getThread(id, user.id) };
    if (key) saveMailMutation(user.id, key, response);
    return Response.json(response);
  } catch (error) {
    return Response.json(
      { error: error instanceof Error ? error.message : "Mail action failed." },
      { status: 502 },
    );
  }
}
