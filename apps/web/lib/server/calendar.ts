import { createHash, randomUUID } from "node:crypto";

import {
  accountCapabilities,
  calendarCacheNeedsRebase,
  calendarCacheWindow,
  googleCalendarDate,
  microsoftCalendarDate,
  microsoftCalendarResponse,
} from "@/lib/mail/calendar-core";
import type {
  CalendarAttendee,
  CalendarEventDetail,
  CalendarSource,
  CalendarSyncResult,
  CreateCalendarEventInput,
  EventResponse,
  StoredAccount,
  StoredCalendarSource,
  UpdateCalendarEventInput,
} from "@/lib/mail/types";
import {
  clearCalendarSourceEvents,
  deleteCalendarEvent as deleteStoredCalendarEvent,
  deleteProviderCalendarEvent,
  getAccount,
  getAccounts,
  getCalendarEvent,
  getCalendarSource,
  listStoredCalendarSources,
  saveCalendarSource,
  updateAccountToken,
  updateCalendarSourceSync,
  upsertCalendarEvent,
} from "@/lib/server/db";
import {
  refreshGoogleToken,
  refreshMicrosoftToken,
} from "@/lib/server/oauth";

const GOOGLE_CALENDAR_BASE = "https://www.googleapis.com/calendar/v3";
const MICROSOFT_GRAPH_BASE = "https://graph.microsoft.com/v1.0";

type ProviderError = Error & {
  status?: number;
  code?: string;
};

function hasCalendarScope(account: StoredAccount) {
  return accountCapabilities(account.provider, account.token.scope).calendar;
}

async function accessToken(account: StoredAccount) {
  if (account.token.expiresAt > Date.now() + 60_000) {
    return account.token.accessToken;
  }
  if (!account.token.refreshToken) {
    throw Object.assign(new Error("Provider refresh token missing."), {
      status: 401,
      code: "reauth_required",
    });
  }
  const next =
    account.provider === "google"
      ? await refreshGoogleToken(account.token.refreshToken)
      : await refreshMicrosoftToken(account.token.refreshToken);
  const refreshed = {
    ...next,
    scope: next.scope || account.token.scope,
  };
  updateAccountToken(account.id, refreshed);
  account.token = refreshed;
  return refreshed.accessToken;
}

async function providerFetch<T>(
  account: StoredAccount,
  url: string,
  init?: RequestInit,
): Promise<T> {
  const token = await accessToken(account);
  const response = await fetch(url, {
    ...init,
    headers: {
      authorization: `Bearer ${token}`,
      "content-type": "application/json",
      ...(account.provider === "microsoft"
        ? { prefer: 'outlook.timezone="UTC"' }
        : {}),
      ...init?.headers,
    },
    cache: "no-store",
  });
  if (!response.ok) {
    const payload = (await response.json().catch(() => ({}))) as {
      error?: { code?: string; message?: string } | string;
      error_description?: string;
    };
    const providerMessage =
      typeof payload.error === "object"
        ? payload.error.message
        : payload.error_description || payload.error;
    const status =
      response.status === 401 || response.status === 403
        ? 401
        : response.status === 409 || response.status === 412
          ? 409
          : response.status;
    throw Object.assign(
      new Error(providerMessage || `Calendar request failed (${response.status}).`),
      {
        status,
        code:
          status === 401
            ? "reauth_required"
            : status === 409
              ? "conflict"
              : "provider_error",
      },
    ) satisfies ProviderError;
  }
  if (response.status === 204 || response.status === 202) {
    return undefined as T;
  }
  return (await response.json()) as T;
}

type GoogleCalendarListEntry = {
  id: string;
  summary?: string;
  backgroundColor?: string;
  accessRole?: string;
  primary?: boolean;
  timeZone?: string;
  deleted?: boolean;
};

type GoogleEvent = {
  id: string;
  etag?: string;
  status?: "confirmed" | "tentative" | "cancelled";
  summary?: string;
  description?: string;
  location?: string;
  htmlLink?: string;
  locked?: boolean;
  creator?: { email?: string; displayName?: string; self?: boolean };
  organizer?: { email?: string; displayName?: string; self?: boolean };
  attendees?: Array<{
    email?: string;
    displayName?: string;
    optional?: boolean;
    responseStatus?: CalendarAttendee["responseStatus"];
    self?: boolean;
  }>;
  start?: { date?: string; dateTime?: string; timeZone?: string };
  end?: { date?: string; dateTime?: string; timeZone?: string };
  recurringEventId?: string;
  recurrence?: string[];
  hangoutLink?: string;
  conferenceData?: {
    conferenceSolution?: { key?: { type?: string } };
    entryPoints?: Array<{ entryPointType?: string; uri?: string }>;
  };
};

type MicrosoftCalendar = {
  id: string;
  name?: string;
  color?: string;
  canEdit?: boolean;
  isDefaultCalendar?: boolean;
};

type MicrosoftEvent = {
  id: string;
  "@odata.etag"?: string;
  subject?: string;
  body?: { content?: string; contentType?: string };
  bodyPreview?: string;
  location?: { displayName?: string };
  organizer?: {
    emailAddress?: { name?: string; address?: string };
  };
  attendees?: Array<{
    type?: "required" | "optional" | "resource";
    status?: { response?: string };
    emailAddress?: { name?: string; address?: string };
  }>;
  start?: { dateTime?: string; timeZone?: string };
  end?: { dateTime?: string; timeZone?: string };
  isAllDay?: boolean;
  isCancelled?: boolean;
  isOnlineMeeting?: boolean;
  onlineMeeting?: { joinUrl?: string };
  onlineMeetingUrl?: string;
  onlineMeetingProvider?: string;
  responseStatus?: { response?: string };
  type?: string;
  seriesMasterId?: string;
  webLink?: string;
  "@removed"?: { reason?: string };
};

function googleEvent(
  source: StoredCalendarSource,
  event: GoogleEvent,
): CalendarEventDetail {
  const now = new Date().toISOString();
  const attendees: CalendarAttendee[] = (event.attendees || [])
    .filter((attendee) => attendee.email)
    .map((attendee) => ({
      name: attendee.displayName || attendee.email || "Guest",
      address: (attendee.email || "").toLowerCase(),
      optional: Boolean(attendee.optional),
      responseStatus: attendee.responseStatus || "needsAction",
      self: attendee.self,
    }));
  const self = attendees.find((attendee) => attendee.self);
  const joinUrl =
    event.hangoutLink ||
    event.conferenceData?.entryPoints?.find(
      (entry) => entry.entryPointType === "video",
    )?.uri ||
    null;
  return {
    id: `${source.id}:${event.id}`,
    sourceId: source.id,
    accountId: source.accountId,
    provider: "google",
    accountEmail: source.accountEmail,
    calendarName: source.name,
    calendarColor: source.color,
    providerEventId: event.id,
    title: event.summary || "(untitled event)",
    description: event.description || "",
    location: event.location || "",
    organizer: {
      name:
        event.organizer?.displayName ||
        event.organizer?.email ||
        source.accountEmail,
      address: (event.organizer?.email || source.accountEmail).toLowerCase(),
    },
    attendees,
    start: googleCalendarDate(event.start, now),
    end: googleCalendarDate(event.end, now),
    allDay: Boolean(event.start?.date),
    status: event.status || "confirmed",
    responseStatus: self?.responseStatus || "needsAction",
    joinUrl,
    conferenceProvider: joinUrl ? "meet" : null,
    editable:
      !event.locked &&
      (source.accessRole === "writer" || source.accessRole === "owner"),
    etag: event.etag || null,
    recurring: Boolean(event.recurringEventId || event.recurrence?.length),
    htmlLink: event.htmlLink || null,
  };
}

function microsoftEvent(
  source: StoredCalendarSource,
  event: MicrosoftEvent,
): CalendarEventDetail {
  const now = new Date().toISOString();
  const attendees: CalendarAttendee[] = (event.attendees || [])
    .filter((attendee) => attendee.emailAddress?.address)
    .map((attendee) => ({
      name:
        attendee.emailAddress?.name ||
        attendee.emailAddress?.address ||
        "Guest",
      address: (attendee.emailAddress?.address || "").toLowerCase(),
      optional: attendee.type === "optional",
      responseStatus: microsoftCalendarResponse(attendee.status?.response),
      self:
        attendee.emailAddress?.address?.toLowerCase() ===
        source.accountEmail.toLowerCase(),
    }));
  const joinUrl =
    event.onlineMeeting?.joinUrl || event.onlineMeetingUrl || null;
  return {
    id: `${source.id}:${event.id}`,
    sourceId: source.id,
    accountId: source.accountId,
    provider: "microsoft",
    accountEmail: source.accountEmail,
    calendarName: source.name,
    calendarColor: source.color,
    providerEventId: event.id,
    title: event.subject || "(untitled event)",
    description: event.body?.content || event.bodyPreview || "",
    location: event.location?.displayName || "",
    organizer: {
      name:
        event.organizer?.emailAddress?.name ||
        event.organizer?.emailAddress?.address ||
        source.accountEmail,
      address: (
        event.organizer?.emailAddress?.address || source.accountEmail
      ).toLowerCase(),
    },
    attendees,
    start: microsoftCalendarDate(event.start?.dateTime, now),
    end: microsoftCalendarDate(event.end?.dateTime, now),
    allDay: Boolean(event.isAllDay),
    status: event.isCancelled ? "cancelled" : "confirmed",
    responseStatus: microsoftCalendarResponse(event.responseStatus?.response),
    joinUrl,
    conferenceProvider:
      joinUrl || event.onlineMeetingProvider === "teamsForBusiness"
        ? "teams"
        : null,
    editable:
      !event.isCancelled &&
      (source.accessRole === "writer" || source.accessRole === "owner"),
    etag: event["@odata.etag"] || null,
    recurring:
      Boolean(event.seriesMasterId) ||
      Boolean(event.type && event.type !== "singleInstance"),
    htmlLink: event.webLink || null,
  };
}

export async function discoverCalendarSources(accountId?: string) {
  const accounts = accountId
    ? [getAccount(accountId)].filter(Boolean) as StoredAccount[]
    : getAccounts();
  const discovered: CalendarSource[] = [];
  for (const account of accounts) {
    if (!hasCalendarScope(account)) continue;
    if (account.provider === "google") {
      let pageToken = "";
      do {
        const params = new URLSearchParams({
          minAccessRole: "writer",
          showDeleted: "false",
          showHidden: "false",
          maxResults: "250",
        });
        if (pageToken) params.set("pageToken", pageToken);
        const page = await providerFetch<{
          items?: GoogleCalendarListEntry[];
          nextPageToken?: string;
        }>(
          account,
          `${GOOGLE_CALENDAR_BASE}/users/me/calendarList?${params}`,
        );
        for (const entry of page.items || []) {
          if (entry.deleted || !entry.id) continue;
          const source = saveCalendarSource(account, {
            providerCalendarId: entry.id,
            name: entry.summary || entry.id,
            color: entry.backgroundColor,
            timeZone: entry.timeZone,
            accessRole: entry.accessRole === "owner" ? "owner" : "writer",
            primary: entry.primary,
          });
          const { syncCursor: _cursor, windowStart: _start, windowEnd: _end, ...item } =
            source;
          discovered.push(item);
        }
        pageToken = page.nextPageToken || "";
      } while (pageToken);
      continue;
    }

    let url =
      `${MICROSOFT_GRAPH_BASE}/me/calendars` +
      "?$select=id,name,color,canEdit,isDefaultCalendar&$top=100";
    while (url) {
      const page = await providerFetch<{
        value?: MicrosoftCalendar[];
        "@odata.nextLink"?: string;
      }>(account, url);
      for (const entry of page.value || []) {
        if (!entry.id || entry.canEdit === false) continue;
        const source = saveCalendarSource(account, {
          providerCalendarId: entry.id,
          name: entry.name || "Calendar",
          color: entry.color,
          timeZone: "UTC",
          accessRole: "writer",
          primary: entry.isDefaultCalendar,
        });
        const { syncCursor: _cursor, windowStart: _start, windowEnd: _end, ...item } =
          source;
        discovered.push(item);
      }
      url = page["@odata.nextLink"] || "";
    }
  }
  return discovered;
}

async function syncGoogleCalendar(
  account: StoredAccount,
  source: StoredCalendarSource,
): Promise<CalendarSyncResult> {
  const rebase = calendarCacheNeedsRebase(source);
  const window = rebase
    ? calendarCacheWindow()
    : { start: source.windowStart!, end: source.windowEnd! };
  if (rebase) {
    clearCalendarSourceEvents(source.id);
    updateCalendarSourceSync(source.id, {
      cursor: null,
      windowStart: window.start,
      windowEnd: window.end,
      status: "syncing",
    });
  } else {
    updateCalendarSourceSync(source.id, { status: "syncing" });
  }

  let pageToken = "";
  let nextSyncToken = source.syncCursor || "";
  let processed = 0;
  try {
    do {
      const params = new URLSearchParams({
        singleEvents: "true",
        showDeleted: "true",
        maxResults: "2500",
      });
      if (rebase) {
        params.set("timeMin", window.start);
        params.set("timeMax", window.end);
      } else {
        params.set("syncToken", source.syncCursor!);
      }
      if (pageToken) params.set("pageToken", pageToken);
      const page = await providerFetch<{
        items?: GoogleEvent[];
        nextPageToken?: string;
        nextSyncToken?: string;
      }>(
        account,
        `${GOOGLE_CALENDAR_BASE}/calendars/${encodeURIComponent(
          source.providerCalendarId,
        )}/events?${params}`,
      );
      for (const item of page.items || []) {
        if (item.status === "cancelled") {
          deleteProviderCalendarEvent(source.id, item.id);
        } else {
          upsertCalendarEvent(googleEvent(source, item));
          processed += 1;
        }
      }
      pageToken = page.nextPageToken || "";
      nextSyncToken = page.nextSyncToken || nextSyncToken;
    } while (pageToken);
  } catch (error) {
    const providerError = error as ProviderError;
    if (!rebase && providerError.status === 410) {
      clearCalendarSourceEvents(source.id);
      updateCalendarSourceSync(source.id, { cursor: null });
      return syncGoogleCalendar(account, {
        ...source,
        syncCursor: null,
        windowStart: null,
        windowEnd: null,
      });
    }
    updateCalendarSourceSync(source.id, {
      status:
        providerError.code === "reauth_required"
          ? "reauth_required"
          : "error",
    });
    throw error;
  }

  updateCalendarSourceSync(source.id, {
    cursor: nextSyncToken,
    windowStart: window.start,
    windowEnd: window.end,
    status: "connected",
    markSynced: true,
  });
  return { sourceId: source.id, processed, mode: rebase ? "initial" : "incremental" };
}

async function syncMicrosoftCalendar(
  account: StoredAccount,
  source: StoredCalendarSource,
): Promise<CalendarSyncResult> {
  const rebase = calendarCacheNeedsRebase(source);
  const window = rebase
    ? calendarCacheWindow()
    : { start: source.windowStart!, end: source.windowEnd! };
  if (rebase) {
    clearCalendarSourceEvents(source.id);
    updateCalendarSourceSync(source.id, {
      cursor: null,
      windowStart: window.start,
      windowEnd: window.end,
      status: "syncing",
    });
  } else {
    updateCalendarSourceSync(source.id, { status: "syncing" });
  }

  let url = rebase
    ? `${MICROSOFT_GRAPH_BASE}/me/calendars/${encodeURIComponent(
        source.providerCalendarId,
      )}/calendarView/delta?startDateTime=${encodeURIComponent(
        window.start,
      )}&endDateTime=${encodeURIComponent(window.end)}`
    : source.syncCursor!;
  let deltaLink = source.syncCursor || "";
  let processed = 0;
  try {
    while (url) {
      const page = await providerFetch<{
        value?: MicrosoftEvent[];
        "@odata.nextLink"?: string;
        "@odata.deltaLink"?: string;
      }>(account, url);
      for (const item of page.value || []) {
        if (item["@removed"] || item.isCancelled) {
          deleteProviderCalendarEvent(source.id, item.id);
        } else {
          upsertCalendarEvent(microsoftEvent(source, item));
          processed += 1;
        }
      }
      deltaLink = page["@odata.deltaLink"] || deltaLink;
      url = page["@odata.nextLink"] || "";
    }
  } catch (error) {
    const providerError = error as ProviderError;
    if (!rebase && (providerError.status === 404 || providerError.status === 410)) {
      clearCalendarSourceEvents(source.id);
      updateCalendarSourceSync(source.id, { cursor: null });
      return syncMicrosoftCalendar(account, {
        ...source,
        syncCursor: null,
        windowStart: null,
        windowEnd: null,
      });
    }
    updateCalendarSourceSync(source.id, {
      status:
        providerError.code === "reauth_required"
          ? "reauth_required"
          : "error",
    });
    throw error;
  }

  updateCalendarSourceSync(source.id, {
    cursor: deltaLink,
    windowStart: window.start,
    windowEnd: window.end,
    status: "connected",
    markSynced: true,
  });
  return { sourceId: source.id, processed, mode: rebase ? "initial" : "incremental" };
}

export async function syncCalendarSource(sourceId: string) {
  const source = getCalendarSource(sourceId);
  if (!source) throw new Error("Calendar not found.");
  const account = getAccount(source.accountId);
  if (!account) throw new Error("Calendar account not found.");
  return account.provider === "google"
    ? syncGoogleCalendar(account, source)
    : syncMicrosoftCalendar(account, source);
}

export async function syncAccountCalendars(accountId: string) {
  await discoverCalendarSources(accountId);
  const results: CalendarSyncResult[] = [];
  for (const source of listStoredCalendarSources(accountId)) {
    if (!source.selected) continue;
    try {
      results.push(await syncCalendarSource(source.id));
    } catch {
      // Each source records its own failure and does not block other calendars.
    }
  }
  return results;
}

export async function syncAllCalendars() {
  const results: CalendarSyncResult[] = [];
  for (const account of getAccounts()) {
    if (!hasCalendarScope(account)) continue;
    results.push(...(await syncAccountCalendars(account.id)));
  }
  return results;
}

function googleEventBody(
  source: StoredCalendarSource,
  input: CreateCalendarEventInput | UpdateCalendarEventInput,
  idempotencyKey?: string,
) {
  const allDay = Boolean(input.allDay);
  const body: Record<string, unknown> = {};
  if (input.title !== undefined) body.summary = input.title;
  if (input.description !== undefined) body.description = input.description;
  if (input.location !== undefined) body.location = input.location;
  if (input.start !== undefined) {
    body.start = allDay
      ? { date: input.start.slice(0, 10) }
      : {
          dateTime: new Date(input.start).toISOString(),
          timeZone: input.timeZone || source.timeZone || "UTC",
        };
  }
  if (input.end !== undefined) {
    body.end = allDay
      ? { date: input.end.slice(0, 10) }
      : {
          dateTime: new Date(input.end).toISOString(),
          timeZone: input.timeZone || source.timeZone || "UTC",
        };
  }
  if (input.attendeeEmails !== undefined) {
    body.attendees = input.attendeeEmails.map((email) => ({ email }));
  }
  if (input.onlineMeeting) {
    body.conferenceData = {
      createRequest: {
        requestId: idempotencyKey || randomUUID(),
        conferenceSolutionKey: { type: "hangoutsMeet" },
      },
    };
  }
  return body;
}

function microsoftEventBody(
  input: CreateCalendarEventInput | UpdateCalendarEventInput,
  idempotencyKey?: string,
) {
  const body: Record<string, unknown> = {};
  if (input.title !== undefined) body.subject = input.title;
  if (input.description !== undefined) {
    body.body = { contentType: "Text", content: input.description };
  }
  if (input.location !== undefined) {
    body.location = { displayName: input.location };
  }
  if (input.start !== undefined) {
    body.start = {
      dateTime: new Date(input.start).toISOString().replace(/Z$/, ""),
      timeZone: "UTC",
    };
  }
  if (input.end !== undefined) {
    body.end = {
      dateTime: new Date(input.end).toISOString().replace(/Z$/, ""),
      timeZone: "UTC",
    };
  }
  if (input.allDay !== undefined) body.isAllDay = input.allDay;
  if (input.attendeeEmails !== undefined) {
    body.attendees = input.attendeeEmails.map((address) => ({
      emailAddress: { address },
      type: "required",
    }));
  }
  if (input.onlineMeeting) {
    body.isOnlineMeeting = true;
    body.onlineMeetingProvider = "teamsForBusiness";
  }
  if (idempotencyKey) body.transactionId = idempotencyKey;
  return body;
}

async function fetchProviderEvent(
  account: StoredAccount,
  source: StoredCalendarSource,
  providerEventId: string,
) {
  if (account.provider === "google") {
    const item = await providerFetch<GoogleEvent>(
      account,
      `${GOOGLE_CALENDAR_BASE}/calendars/${encodeURIComponent(
        source.providerCalendarId,
      )}/events/${encodeURIComponent(providerEventId)}`,
    );
    return googleEvent(source, item);
  }
  const item = await providerFetch<MicrosoftEvent>(
    account,
    `${MICROSOFT_GRAPH_BASE}/me/calendars/${encodeURIComponent(
      source.providerCalendarId,
    )}/events/${encodeURIComponent(providerEventId)}`,
  );
  return microsoftEvent(source, item);
}

export async function createCalendarEvent(
  input: CreateCalendarEventInput,
  idempotencyKey: string,
) {
  const source = getCalendarSource(input.sourceId);
  if (!source) throw Object.assign(new Error("Calendar not found."), { status: 404 });
  const account = getAccount(source.accountId);
  if (!account) throw Object.assign(new Error("Calendar account not found."), { status: 404 });
  let event: CalendarEventDetail;
  if (account.provider === "google") {
    const providerId = createHash("sha256")
      .update(idempotencyKey)
      .digest("hex")
      .slice(0, 32);
    const body = {
      ...googleEventBody(source, input, idempotencyKey),
      id: providerId,
      extendedProperties: {
        private: {
          rubidiumMutation: idempotencyKey,
          ...(input.sourceThreadId
            ? { rubidiumThread: input.sourceThreadId }
            : {}),
        },
      },
    };
    const item = await providerFetch<GoogleEvent>(
      account,
      `${GOOGLE_CALENDAR_BASE}/calendars/${encodeURIComponent(
        source.providerCalendarId,
      )}/events?conferenceDataVersion=1&sendUpdates=all`,
      { method: "POST", body: JSON.stringify(body) },
    );
    event = googleEvent(source, item);
  } else {
    const body = microsoftEventBody(input, idempotencyKey);
    const item = await providerFetch<MicrosoftEvent>(
      account,
      `${MICROSOFT_GRAPH_BASE}/me/calendars/${encodeURIComponent(
        source.providerCalendarId,
      )}/events`,
      { method: "POST", body: JSON.stringify(body) },
    );
    event = microsoftEvent(source, item);
  }
  upsertCalendarEvent(event);
  return event;
}

export async function updateCalendarEvent(
  id: string,
  input: UpdateCalendarEventInput,
) {
  const existing = getCalendarEvent(id);
  if (!existing) throw Object.assign(new Error("Event not found."), { status: 404 });
  const source = getCalendarSource(existing.sourceId);
  const account = source ? getAccount(source.accountId) : null;
  if (!source || !account) {
    throw Object.assign(new Error("Calendar account not found."), { status: 404 });
  }
  const body =
    account.provider === "google"
      ? googleEventBody(source, input)
      : microsoftEventBody(input);
  const url =
    account.provider === "google"
      ? `${GOOGLE_CALENDAR_BASE}/calendars/${encodeURIComponent(
          source.providerCalendarId,
        )}/events/${encodeURIComponent(
          existing.providerEventId,
        )}?conferenceDataVersion=1&sendUpdates=all`
      : `${MICROSOFT_GRAPH_BASE}/me/calendars/${encodeURIComponent(
          source.providerCalendarId,
        )}/events/${encodeURIComponent(existing.providerEventId)}`;
  const item = await providerFetch<GoogleEvent | MicrosoftEvent>(account, url, {
    method: "PATCH",
    headers: input.etag ? { "if-match": input.etag } : undefined,
    body: JSON.stringify(body),
  });
  const event =
    account.provider === "google"
      ? googleEvent(source, item as GoogleEvent)
      : microsoftEvent(source, item as MicrosoftEvent);
  upsertCalendarEvent(event);
  return event;
}

export async function deleteCalendarEvent(id: string, etag?: string | null) {
  const existing = getCalendarEvent(id);
  if (!existing) throw Object.assign(new Error("Event not found."), { status: 404 });
  const source = getCalendarSource(existing.sourceId);
  const account = source ? getAccount(source.accountId) : null;
  if (!source || !account) {
    throw Object.assign(new Error("Calendar account not found."), { status: 404 });
  }
  const url =
    account.provider === "google"
      ? `${GOOGLE_CALENDAR_BASE}/calendars/${encodeURIComponent(
          source.providerCalendarId,
        )}/events/${encodeURIComponent(existing.providerEventId)}?sendUpdates=all`
      : `${MICROSOFT_GRAPH_BASE}/me/calendars/${encodeURIComponent(
          source.providerCalendarId,
        )}/events/${encodeURIComponent(existing.providerEventId)}`;
  await providerFetch(account, url, {
    method: "DELETE",
    headers: etag ? { "if-match": etag } : undefined,
  });
  deleteStoredCalendarEvent(id);
  return { deleted: true };
}

export async function respondToCalendarEvent(
  id: string,
  response: EventResponse,
) {
  const existing = getCalendarEvent(id);
  if (!existing) throw Object.assign(new Error("Event not found."), { status: 404 });
  const source = getCalendarSource(existing.sourceId);
  const account = source ? getAccount(source.accountId) : null;
  if (!source || !account) {
    throw Object.assign(new Error("Calendar account not found."), { status: 404 });
  }
  if (account.provider === "google") {
    const current = await providerFetch<GoogleEvent>(
      account,
      `${GOOGLE_CALENDAR_BASE}/calendars/${encodeURIComponent(
        source.providerCalendarId,
      )}/events/${encodeURIComponent(existing.providerEventId)}`,
    );
    const attendees = [...(current.attendees || [])];
    const selfIndex = attendees.findIndex(
      (attendee) =>
        attendee.self ||
        attendee.email?.toLowerCase() === source.accountEmail.toLowerCase(),
    );
    if (selfIndex < 0) {
      attendees.push({
        email: source.accountEmail,
        self: true,
        responseStatus: response,
      });
    } else {
      attendees[selfIndex] = {
        ...attendees[selfIndex],
        responseStatus: response,
      };
    }
    const updated = await providerFetch<GoogleEvent>(
      account,
      `${GOOGLE_CALENDAR_BASE}/calendars/${encodeURIComponent(
        source.providerCalendarId,
      )}/events/${encodeURIComponent(
        existing.providerEventId,
      )}?sendUpdates=all`,
      {
        method: "PATCH",
        headers: existing.etag ? { "if-match": existing.etag } : undefined,
        body: JSON.stringify({ attendees }),
      },
    );
    const event = googleEvent(source, updated);
    upsertCalendarEvent(event);
    return event;
  }

  const action =
    response === "accepted"
      ? "accept"
      : response === "tentative"
        ? "tentativelyAccept"
        : "decline";
  await providerFetch(
    account,
    `${MICROSOFT_GRAPH_BASE}/me/calendars/${encodeURIComponent(
      source.providerCalendarId,
    )}/events/${encodeURIComponent(existing.providerEventId)}/${action}`,
    {
      method: "POST",
      body: JSON.stringify({ sendResponse: true }),
    },
  );
  const event = await fetchProviderEvent(
    account,
    source,
    existing.providerEventId,
  );
  upsertCalendarEvent(event);
  return event;
}
