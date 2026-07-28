import { requireUser, unauthorized } from "@/lib/server/auth";
import { getPublicAccounts } from "@/lib/server/db";

export const runtime = "nodejs";

export async function GET(request: Request) {
  const user = await requireUser(request);
  if (!user) return unauthorized();
  return Response.json({ accounts: getPublicAccounts(user.id) });
}
