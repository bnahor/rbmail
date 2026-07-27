import { isAuthorized, unauthorized } from "@/lib/server/auth";
import { getPublicAccounts } from "@/lib/server/db";

export const runtime = "nodejs";

export function GET(request: Request) {
  if (!isAuthorized(request)) return unauthorized();
  return Response.json({ accounts: getPublicAccounts() });
}
