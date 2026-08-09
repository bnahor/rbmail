import { requireUser, unauthorized } from "@/lib/server/auth";
import { listThreads } from "@/lib/server/db";

export const runtime = "nodejs";

export async function GET(request: Request) {
  const user = await requireUser(request);
  if (!user) return unauthorized();
  const url = new URL(request.url);
  const limit = Number(url.searchParams.get("limit") || 100);
  const threads = listThreads(user.id, {
    limit,
    cursor: url.searchParams.get("cursor") || undefined,
    accountId: url.searchParams.get("accountId") || undefined,
    view: url.searchParams.get("view") || undefined,
    query: url.searchParams.get("q") || undefined,
  });
  const last = threads.at(-1);
  const nextCursor = last
    ? Buffer.from(`${last.lastMessageAt}\u0000${last.id}`, "utf8").toString("base64url")
    : null;
  return Response.json({ threads, nextCursor });
}
