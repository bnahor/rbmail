import { requireUser, unauthorized } from "@/lib/server/auth";
import { deleteComposioConnection } from "@/lib/server/composio";
import { deleteAccount, getAccount } from "@/lib/server/db";

export const runtime = "nodejs";

export async function DELETE(
  request: Request,
  context: { params: Promise<{ id: string }> },
) {
  const user = await requireUser(request);
  if (!user) return unauthorized();
  const { id } = await context.params;
  const account = getAccount(id, user.id);
  if (!account) {
    return Response.json({ error: "Account not found." }, { status: 404 });
  }
  if (account.authBackend === "composio" && account.connectedAccountId) {
    try {
      await deleteComposioConnection(account.connectedAccountId);
    } catch (error) {
      return Response.json(
        {
          error:
            error instanceof Error
              ? error.message
              : "Could not revoke the Composio connection.",
        },
        { status: 502 },
      );
    }
  }
  deleteAccount(id, user.id);
  return Response.json({ deleted: true });
}
