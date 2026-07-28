import { requireUser, unauthorized } from "@/lib/server/auth";
import { calendarError } from "@/lib/server/calendar-api";
import {
  syncAccountCalendars,
  syncAllCalendars,
} from "@/lib/server/calendar";
import { getAccount } from "@/lib/server/db";

export const runtime = "nodejs";
export const maxDuration = 300;

export async function POST(request: Request) {
  const user = await requireUser(request);
  if (!user) return unauthorized();
  const input = (await request.json().catch(() => ({}))) as {
    accountId?: string;
  };
  if (input.accountId && !getAccount(input.accountId, user.id)) {
    return Response.json({ error: "Account not found." }, { status: 404 });
  }
  try {
    const results = input.accountId
      ? await syncAccountCalendars(input.accountId)
      : await syncAllCalendars(user.id);
    return Response.json({ results });
  } catch (error) {
    return calendarError(error);
  }
}
