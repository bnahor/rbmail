import { randomUUID } from "node:crypto";

import type { CreateCalendarEventInput } from "@/lib/mail/types";
import { isAuthorized, unauthorized } from "@/lib/server/auth";
import { calendarError, validDate } from "@/lib/server/calendar-api";
import { createCalendarEvent } from "@/lib/server/calendar";
import {
  getCalendarMutation,
  listCalendarEvents,
  saveCalendarMutation,
} from "@/lib/server/db";

export const runtime = "nodejs";

export function GET(request: Request) {
  if (!isAuthorized(request)) return unauthorized();
  const url = new URL(request.url);
  const now = new Date();
  const later = new Date(now);
  later.setUTCDate(later.getUTCDate() + 30);
  const from = url.searchParams.get("from") || now.toISOString();
  const to = url.searchParams.get("to") || later.toISOString();
  if (!validDate(from) || !validDate(to) || new Date(from) >= new Date(to)) {
    return Response.json({ error: "A valid event range is required." }, { status: 400 });
  }
  return Response.json({
    events: listCalendarEvents({
      from,
      to,
      accountId: url.searchParams.get("accountId") || undefined,
      sourceId: url.searchParams.get("calendarId") || undefined,
      query: url.searchParams.get("q") || undefined,
    }),
  });
}

export async function POST(request: Request) {
  if (!isAuthorized(request)) return unauthorized();
  const input = (await request.json().catch(() => ({}))) as Partial<CreateCalendarEventInput>;
  if (
    !input.sourceId ||
    !input.title?.trim() ||
    !validDate(input.start) ||
    !validDate(input.end) ||
    new Date(input.start) >= new Date(input.end)
  ) {
    return Response.json(
      { error: "Calendar, title, start, and end are required." },
      { status: 400 },
    );
  }
  const idempotencyKey =
    request.headers.get("idempotency-key")?.trim() || randomUUID();
  const mutationKey = `create:${idempotencyKey}`;
  const previous = getCalendarMutation<unknown>(mutationKey);
  if (previous) return Response.json(previous);
  try {
    const event = await createCalendarEvent(
      {
        ...input,
        sourceId: input.sourceId,
        title: input.title.trim(),
        start: input.start,
        end: input.end,
        attendeeEmails: (input.attendeeEmails || [])
          .map((email) => email.trim().toLowerCase())
          .filter(Boolean),
      },
      idempotencyKey,
    );
    const response = { event };
    saveCalendarMutation(mutationKey, response);
    return Response.json(response, { status: 201 });
  } catch (error) {
    return calendarError(error);
  }
}
