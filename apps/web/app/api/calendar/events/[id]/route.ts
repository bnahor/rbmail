import { randomUUID } from "node:crypto";

import type { UpdateCalendarEventInput } from "@/lib/mail/types";
import { requireUser, unauthorized } from "@/lib/server/auth";
import { calendarError, validDate } from "@/lib/server/calendar-api";
import {
  deleteCalendarEvent,
  updateCalendarEvent,
} from "@/lib/server/calendar";
import {
  getCalendarEvent,
  getCalendarMutation,
  saveCalendarMutation,
} from "@/lib/server/db";

export const runtime = "nodejs";

export async function GET(
  request: Request,
  context: { params: Promise<{ id: string }> },
) {
  const user = await requireUser(request);
  if (!user) return unauthorized();
  const { id } = await context.params;
  const event = getCalendarEvent(decodeURIComponent(id), user.id);
  return event
    ? Response.json({ event })
    : Response.json({ error: "Event not found." }, { status: 404 });
}

export async function PATCH(
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
  const input = (await request.json().catch(() => ({}))) as UpdateCalendarEventInput;
  if (
    (input.start !== undefined && !validDate(input.start)) ||
    (input.end !== undefined && !validDate(input.end)) ||
    (input.start &&
      input.end &&
      new Date(input.start) >= new Date(input.end))
  ) {
    return Response.json({ error: "Event times are invalid." }, { status: 400 });
  }
  const key = request.headers.get("idempotency-key")?.trim() || randomUUID();
  const mutationKey = `${user.id}:update:${eventId}:${key}`;
  const previous = getCalendarMutation<unknown>(mutationKey);
  if (previous) return Response.json(previous);
  try {
    const event = await updateCalendarEvent(eventId, input);
    const response = { event };
    saveCalendarMutation(mutationKey, response);
    return Response.json(response);
  } catch (error) {
    return calendarError(error);
  }
}

export async function DELETE(
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
  const url = new URL(request.url);
  const key = request.headers.get("idempotency-key")?.trim() || randomUUID();
  const mutationKey = `${user.id}:delete:${eventId}:${key}`;
  const previous = getCalendarMutation<unknown>(mutationKey);
  if (previous) return Response.json(previous);
  try {
    const response = await deleteCalendarEvent(
      eventId,
      url.searchParams.get("etag"),
    );
    saveCalendarMutation(mutationKey, response);
    return Response.json(response);
  } catch (error) {
    return calendarError(error);
  }
}
