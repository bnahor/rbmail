import { randomUUID } from "node:crypto";

import type { EventResponse } from "@/lib/mail/types";
import { requireUser, unauthorized } from "@/lib/server/auth";
import { calendarError } from "@/lib/server/calendar-api";
import { respondToCalendarEvent } from "@/lib/server/calendar";
import {
  getCalendarMutation,
  getCalendarEvent,
  saveCalendarMutation,
} from "@/lib/server/db";

export const runtime = "nodejs";

export async function POST(
  request: Request,
  context: { params: Promise<{ id: string }> },
) {
  const user = await requireUser(request);
  if (!user) return unauthorized();
  const { id } = await context.params;
  const eventId = decodeURIComponent(id);
  if (!getCalendarEvent(eventId, user.id)) {
    return Response.json({ error: "Event not found." }, { status: 404 });
  }
  const input = (await request.json().catch(() => ({}))) as {
    response?: EventResponse;
  };
  if (!input.response || !["accepted", "tentative", "declined"].includes(input.response)) {
    return Response.json({ error: "A valid RSVP response is required." }, { status: 400 });
  }
  const key = request.headers.get("idempotency-key")?.trim() || randomUUID();
  const mutationKey = `${user.id}:rsvp:${eventId}:${input.response}:${key}`;
  const previous = getCalendarMutation<unknown>(mutationKey);
  if (previous) return Response.json(previous);
  try {
    const event = await respondToCalendarEvent(eventId, input.response);
    const response = { event };
    saveCalendarMutation(mutationKey, response);
    return Response.json(response);
  } catch (error) {
    return calendarError(error);
  }
}
