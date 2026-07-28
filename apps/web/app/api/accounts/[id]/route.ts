import { requireUser, unauthorized } from "@/lib/server/auth";
import { deleteAccount, getAccount } from "@/lib/server/db";

export const runtime = "nodejs";

export async function DELETE(
  request: Request,
  context: { params: Promise<{ id: string }> },
) {
  const user = await requireUser(request);
  if (!user) return unauthorized();
  const { id } = await context.params;
  if (!getAccount(id, user.id)) {
    return Response.json({ error: "Account not found." }, { status: 404 });
  }
  deleteAccount(id, user.id);
  return Response.json({ deleted: true });
}
