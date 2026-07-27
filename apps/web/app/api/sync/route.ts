import { isAuthorized, unauthorized } from "@/lib/server/auth";
import {
  syncAccountCalendars,
  syncAllCalendars,
} from "@/lib/server/calendar";
import { syncAccount, syncAllAccounts } from "@/lib/server/sync";

export const runtime = "nodejs";
export const maxDuration = 300;

export async function POST(request: Request) {
  if (!isAuthorized(request)) return unauthorized();
  const input = (await request.json().catch(() => ({}))) as {
    accountId?: string;
    pages?: number;
  };
  try {
    const [mailResults, calendarResults] = await Promise.all([
      input.accountId
        ? syncAccount(input.accountId, input.pages ?? 1)
        : syncAllAccounts(input.pages ?? 1),
      input.accountId
        ? syncAccountCalendars(input.accountId)
        : syncAllCalendars(),
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
  const [results, calendarResults] = await Promise.all([
    syncAllAccounts(1),
    syncAllCalendars(),
  ]);
  return Response.json({ results, calendarResults });
}
