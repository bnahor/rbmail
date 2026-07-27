import { isAuthorized, unauthorized } from "@/lib/server/auth";
import { calendarError } from "@/lib/server/calendar-api";
import {
  syncAccountCalendars,
  syncAllCalendars,
} from "@/lib/server/calendar";

export const runtime = "nodejs";
export const maxDuration = 300;

export async function POST(request: Request) {
  if (!isAuthorized(request)) return unauthorized();
  const input = (await request.json().catch(() => ({}))) as {
    accountId?: string;
  };
  try {
    const results = input.accountId
      ? await syncAccountCalendars(input.accountId)
      : await syncAllCalendars();
    return Response.json({ results });
  } catch (error) {
    return calendarError(error);
  }
}
