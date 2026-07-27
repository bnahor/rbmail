import { isAuthorized, unauthorized } from "@/lib/server/auth";
import { listCalendarSources } from "@/lib/server/db";

export const runtime = "nodejs";

export function GET(request: Request) {
  if (!isAuthorized(request)) return unauthorized();
  const url = new URL(request.url);
  return Response.json({
    sources: listCalendarSources(url.searchParams.get("accountId") || undefined),
  });
}
