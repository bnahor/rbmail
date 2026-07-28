import { requireUser, unauthorized } from "@/lib/server/auth";
import { listCalendarSources } from "@/lib/server/db";

export const runtime = "nodejs";

export async function GET(request: Request) {
  const user = await requireUser(request);
  if (!user) return unauthorized();
  const url = new URL(request.url);
  return Response.json({
    sources: listCalendarSources(
      user.id,
      url.searchParams.get("accountId") || undefined,
    ),
  });
}
