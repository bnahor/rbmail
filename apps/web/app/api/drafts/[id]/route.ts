import type { ComposeMessageInput } from "@/lib/mail/types";
import { requireUser, unauthorized } from "@/lib/server/auth";
import { deleteDraft, getAccount, getDraft, saveDraft } from "@/lib/server/db";

export const runtime = "nodejs";

export async function GET(request: Request, context: { params: Promise<{ id: string }> }) {
  const user = await requireUser(request);
  if (!user) return unauthorized();
  const { id } = await context.params;
  const draft = getDraft(user.id, id);
  return draft
    ? Response.json({ draft })
    : Response.json({ error: "Draft not found." }, { status: 404 });
}

export async function PATCH(request: Request, context: { params: Promise<{ id: string }> }) {
  const user = await requireUser(request);
  if (!user) return unauthorized();
  const { id } = await context.params;
  if (!getDraft(user.id, id)) return Response.json({ error: "Draft not found." }, { status: 404 });
  const input = (await request.json()) as ComposeMessageInput;
  if (!getAccount(input.accountId, user.id)) return Response.json({ error: "Account not found." }, { status: 404 });
  return Response.json({ draft: saveDraft(user.id, input, { id }) });
}

export async function DELETE(request: Request, context: { params: Promise<{ id: string }> }) {
  const user = await requireUser(request);
  if (!user) return unauthorized();
  const { id } = await context.params;
  return deleteDraft(user.id, id)
    ? new Response(null, { status: 204 })
    : Response.json({ error: "Draft not found." }, { status: 404 });
}
