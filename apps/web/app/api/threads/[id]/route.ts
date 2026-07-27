import { isAuthorized, unauthorized } from "@/lib/server/auth";
import { getThread } from "@/lib/server/db";

export const runtime = "nodejs";

export async function GET(
  request: Request,
  context: { params: Promise<{ id: string }> },
) {
  if (!isAuthorized(request)) return unauthorized();
  const { id } = await context.params;
  const thread = getThread(id);
  if (!thread) {
    return Response.json({ error: "Thread not found." }, { status: 404 });
  }
  return Response.json({ thread });
}
