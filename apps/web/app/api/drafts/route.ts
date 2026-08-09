import type { ComposeMessageInput } from "@/lib/mail/types";
import { requireUser, unauthorized } from "@/lib/server/auth";
import { getAccount, listDrafts, saveDraft } from "@/lib/server/db";

export const runtime = "nodejs";

export async function GET(request: Request) {
  const user = await requireUser(request);
  if (!user) return unauthorized();
  return Response.json({ drafts: listDrafts(user.id) });
}

export async function POST(request: Request) {
  const user = await requireUser(request);
  if (!user) return unauthorized();
  const input = (await request.json()) as ComposeMessageInput;
  if (!input.accountId || !getAccount(input.accountId, user.id)) {
    return Response.json({ error: "Account not found." }, { status: 404 });
  }
  return Response.json({ draft: saveDraft(user.id, input) }, { status: 201 });
}
