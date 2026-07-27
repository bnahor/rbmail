import { isAuthorized, unauthorized } from "@/lib/server/auth";
import { deleteAccount, getAccount } from "@/lib/server/db";

export const runtime = "nodejs";

export async function DELETE(
  request: Request,
  context: { params: Promise<{ id: string }> },
) {
  if (!isAuthorized(request)) return unauthorized();
  const { id } = await context.params;
  if (!getAccount(id)) {
    return Response.json({ error: "Account not found." }, { status: 404 });
  }
  deleteAccount(id);
  return Response.json({ deleted: true });
}
