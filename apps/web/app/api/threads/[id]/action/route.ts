import { requireUser, unauthorized } from "@/lib/server/auth";
import { getThread } from "@/lib/server/db";
import { changeThread } from "@/lib/server/mail-actions";

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
  const input = (await request.json()) as {
    action?: "read" | "unread" | "archive";
  };
  if (!input.action || !["read", "unread", "archive"].includes(input.action)) {
    return Response.json({ error: "Invalid mail action." }, { status: 400 });
  }
  try {
    await changeThread(id, input.action);
    return Response.json({ ok: true });
  } catch (error) {
    return Response.json(
      { error: error instanceof Error ? error.message : "Mail action failed." },
      { status: 502 },
    );
  }
}
