import { requireUser, unauthorized } from "@/lib/server/auth";
import { listRecipientSuggestions } from "@/lib/server/db";

export const runtime = "nodejs";

export async function GET(request: Request) {
  const user = await requireUser(request);
  if (!user) return unauthorized();

  const url = new URL(request.url);
  const query = (url.searchParams.get("q") || "").slice(0, 200);
  const requestedLimit = Number(url.searchParams.get("limit") || 50);
  const limit = Number.isFinite(requestedLimit)
    ? Math.max(1, Math.min(Math.trunc(requestedLimit), 100))
    : 50;
  return Response.json({
    suggestions: listRecipientSuggestions(user.id, query, limit),
  });
}
