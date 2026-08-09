import type { MailAction } from "@/lib/mail/types";
import { requireUser, unauthorized } from "@/lib/server/auth";
import { getMailMutation, getThread, saveMailMutation } from "@/lib/server/db";
import { changeThread } from "@/lib/server/mail-actions";

export const runtime = "nodejs";

export async function POST(request: Request) {
  const user = await requireUser(request);
  if (!user) return unauthorized();
  const input = (await request.json()) as {
    threadIds?: string[];
    action?: MailAction;
    snoozedUntil?: string | null;
  };
  if (!input.threadIds?.length || !input.action) {
    return Response.json({ error: "Choose conversations and an action." }, { status: 400 });
  }
  const key = request.headers.get("idempotency-key")?.trim();
  if (key) {
    const cached = getMailMutation<object>(user.id, key);
    if (cached) return Response.json(cached);
  }
  const results = await Promise.all(
    [...new Set(input.threadIds)].slice(0, 100).map(async (id) => {
      if (!getThread(id, user.id)) return { id, ok: false, error: "Thread not found." };
      try {
        await changeThread(id, input.action!, { snoozedUntil: input.snoozedUntil });
        return { id, ok: true };
      } catch (error) {
        return {
          id,
          ok: false,
          error: error instanceof Error ? error.message : "Action failed.",
        };
      }
    }),
  );
  const response = {
    results,
    succeeded: results.filter((result) => result.ok).length,
    failed: results.filter((result) => !result.ok).length,
  };
  if (key) saveMailMutation(user.id, key, response);
  return Response.json(response, { status: response.succeeded ? 200 : 502 });
}
