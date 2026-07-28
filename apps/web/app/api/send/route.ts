import { requireUser, unauthorized } from "@/lib/server/auth";
import { getAccount } from "@/lib/server/db";
import { sendMessage } from "@/lib/server/mail-actions";

export const runtime = "nodejs";

export async function POST(request: Request) {
  const user = await requireUser(request);
  if (!user) return unauthorized();
  const input = (await request.json()) as {
    accountId?: string;
    to?: string;
    subject?: string;
    body?: string;
  };
  if (!input.accountId || !input.to?.trim() || !input.subject?.trim() || !input.body?.trim()) {
    return Response.json(
      { error: "Account, recipient, subject, and message are required." },
      { status: 400 },
    );
  }
  if (!getAccount(input.accountId, user.id)) {
    return Response.json({ error: "Account not found." }, { status: 404 });
  }
  try {
    await sendMessage(input.accountId, {
      to: input.to.trim(),
      subject: input.subject.trim(),
      body: input.body.trim(),
    });
    return Response.json({ sent: true });
  } catch (error) {
    return Response.json(
      { error: error instanceof Error ? error.message : "Message failed." },
      { status: 502 },
    );
  }
}
