import { requireUser, unauthorized } from "@/lib/server/auth";
import {
  syncAccountCalendars,
  syncAllCalendars,
} from "@/lib/server/calendar";
import { syncAccount, syncAllAccounts } from "@/lib/server/sync";
import { getAccount } from "@/lib/server/db";
import { processOutboundQueue } from "@/lib/server/outbox";

export const runtime = "nodejs";
export const maxDuration = 300;

export async function POST(request: Request) {
  const user = await requireUser(request);
  if (!user) return unauthorized();
  const input = (await request.json().catch(() => ({}))) as {
    accountId?: string;
    pages?: number;
  };
  if (input.accountId && !getAccount(input.accountId, user.id)) {
    return Response.json({ error: "Account not found." }, { status: 404 });
  }
  try {
    const [mailResults, calendarResults] = await Promise.all([
      input.accountId
        ? syncAccount(input.accountId, input.pages ?? 1)
        : syncAllAccounts(input.pages ?? 1, user.id),
      input.accountId
        ? syncAccountCalendars(input.accountId)
        : syncAllCalendars(user.id),
    ]);
    return Response.json({ results: mailResults, calendarResults });
  } catch (error) {
    return Response.json(
      { error: error instanceof Error ? error.message : "Sync failed." },
      { status: 502 },
    );
  }
}

export async function GET(request: Request) {
  const configured = process.env.CRON_SECRET;
  const authorization = request.headers.get("authorization");
  if (!configured || authorization !== `Bearer ${configured}`) {
    return unauthorized();
  }
  const [results, calendarResults, outboundResults] = await Promise.all([
    syncAllAccounts(1),
    syncAllCalendars(),
    processOutboundQueue(),
  ]);
  return Response.json({ results, calendarResults, outboundResults });
}
