import { requireUser, unauthorized } from "@/lib/server/auth";
import { listThreads } from "@/lib/server/db";

export const runtime = "nodejs";

export async function GET(request: Request) {
  const user = await requireUser(request);
  if (!user) return unauthorized();
  const url = new URL(request.url);
  const limit = Number(url.searchParams.get("limit") || 100);
  return Response.json({ threads: listThreads(user.id, limit) });
}
