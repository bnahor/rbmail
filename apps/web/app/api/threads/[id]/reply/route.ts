import { requireUser, unauthorized } from "@/lib/server/auth";
import { getThread } from "@/lib/server/db";
import { replyToThread } from "@/lib/server/mail-actions";

export const runtime = "nodejs";

export async function POST(
  request: Request,
  context: { params: Promise<{ id: string }> },
) {
  const user = await requireUser(request);
  if (!user) return unauthorized();
  const { id } = await context.params;
  if (!getThread(id, user.id)) {
    return Response.json({ error: "Thread not found." }, { status: 404 });
  }
  const input = (await request.json()) as { body?: string };
  const body = input.body?.trim();
  if (!body) {
    return Response.json({ error: "Reply cannot be empty." }, { status: 400 });
  }
  try {
    await replyToThread(id, body);
    return Response.json({ sent: true });
  } catch (error) {
    return Response.json(
      { error: error instanceof Error ? error.message : "Reply failed." },
      { status: 502 },
    );
  }
}
