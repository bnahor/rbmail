import { isAuthorized, unauthorized } from "@/lib/server/auth";
import { listThreads } from "@/lib/server/db";

export const runtime = "nodejs";

export function GET(request: Request) {
  if (!isAuthorized(request)) return unauthorized();
  const url = new URL(request.url);
  const limit = Number(url.searchParams.get("limit") || 100);
  return Response.json({ threads: listThreads(limit) });
}
