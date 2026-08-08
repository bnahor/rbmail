"use client";

import {
  ArrowLeft,
  CalendarDays,
  Check,
  Clock3,
  Edit3,
  ExternalLink,
  MapPin,
  Menu,
  RefreshCw,
  Trash2,
  Users,
  Video,
  X,
} from "lucide-react";
import {
  type CSSProperties,
  type FormEvent,
  Fragment,
  useEffect,
  useMemo,
  useState,
} from "react";

import type {
  CalendarEventDetail,
  CalendarEventSummary,
  CalendarSource,
  EventResponse,
  Provider,
} from "@/lib/mail/types";

export type ScheduleSeed = {
  threadId?: string;
  title: string;
  attendeeEmails: string[];
  accountId?: string;
};

type CalendarAccount = {
  id: string;
  provider: Provider;
  label: string;
  email: string;
  color: string;
};

type ComposerState = {
  id: string | null;
  etag: string | null;
  sourceId: string;
  title: string;
  start: string;
  end: string;
  allDay: boolean;
  attendees: string;
  location: string;
  description: string;
  onlineMeeting: boolean;
  sourceThreadId?: string;
};

function localDateTime(value: Date) {
  const offset = value.getTimezoneOffset() * 60_000;
  return new Date(value.getTime() - offset).toISOString().slice(0, 16);
}

function defaultTimes() {
  const start = new Date();
  start.setMinutes(start.getMinutes() < 30 ? 30 : 60, 0, 0);
  const end = new Date(start.getTime() + 30 * 60_000);
  return { start: localDateTime(start), end: localDateTime(end) };
}

function emptyComposer(sourceId = ""): ComposerState {
  const times = defaultTimes();
  return {
    id: null,
    etag: null,
    sourceId,
    title: "",
    start: times.start,
    end: times.end,
    allDay: false,
    attendees: "",
    location: "",
    description: "",
    onlineMeeting: true,
  };
}

function eventDay(value: string) {
  const date = new Date(value);
  const today = new Date();
  const tomorrow = new Date(today);
  tomorrow.setDate(today.getDate() + 1);
  if (date.toDateString() === today.toDateString()) return "Today";
  if (date.toDateString() === tomorrow.toDateString()) return "Tomorrow";
  return date.toLocaleDateString([], {
    weekday: "long",
    month: "long",
    day: "numeric",
  });
}

function eventTime(event: Pick<CalendarEventSummary, "start" | "end" | "allDay">) {
  if (event.allDay) return "All day";
  const start = new Date(event.start).toLocaleTimeString([], {
    hour: "numeric",
    minute: "2-digit",
  });
  const end = new Date(event.end).toLocaleTimeString([], {
    hour: "numeric",
    minute: "2-digit",
  });
  return `${start}–${end}`;
}

function plainText(value: string) {
  return value
    .replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, "")
    .replace(/<[^>]+>/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function eventSummary(event: CalendarEventDetail): CalendarEventSummary {
  const {
    description: _description,
    organizer: _organizer,
    attendees: _attendees,
    recurring: _recurring,
    htmlLink: _htmlLink,
    ...summary
  } = event;
  return summary;
}

export function CalendarWorkspace({
  accountFilter,
  accounts,
  scheduleSeed,
  initialEventId,
  onScheduleHandled,
  onOpenMenu,
  onBack,
}: {
  accountFilter: string;
  accounts: CalendarAccount[];
  scheduleSeed: ScheduleSeed | null;
  initialEventId?: string | null;
  onScheduleHandled: () => void;
  onOpenMenu: () => void;
  onBack: () => void;
}) {
  const [sources, setSources] = useState<CalendarSource[]>([]);
  const [events, setEvents] = useState<CalendarEventSummary[]>([]);
  const [selectedId, setSelectedId] = useState("");
  const [selected, setSelected] = useState<CalendarEventDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [syncing, setSyncing] = useState(false);
  const [error, setError] = useState("");
  const [composerOpen, setComposerOpen] = useState(false);
  const [composer, setComposer] = useState<ComposerState>(emptyComposer());
  const [composerBusy, setComposerBusy] = useState(false);
  const [composerError, setComposerError] = useState("");
  const [mobileDetailOpen, setMobileDetailOpen] = useState(false);

  async function loadAgenda(sync = false) {
    if (sync) setSyncing(true);
    setError("");
    try {
      if (sync) {
        const syncResponse = await fetch("/api/calendar/sync", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: "{}",
        });
        if (!syncResponse.ok) {
          const payload = await syncResponse.json();
          throw new Error(payload.error || "Calendar sync failed.");
        }
      }
      const from = new Date();
      from.setHours(0, 0, 0, 0);
      const to = new Date();
      to.setMonth(to.getMonth() + 6);
      const [sourceResponse, eventResponse] = await Promise.all([
        fetch("/api/calendar/sources"),
        fetch(
          `/api/calendar/events?from=${encodeURIComponent(
            from.toISOString(),
          )}&to=${encodeURIComponent(to.toISOString())}`,
        ),
      ]);
      if (!sourceResponse.ok || !eventResponse.ok) {
        throw new Error("Could not load your calendars.");
      }
      const sourcePayload = (await sourceResponse.json()) as {
        sources: CalendarSource[];
      };
      const eventPayload = (await eventResponse.json()) as {
        events: CalendarEventSummary[];
      };
      setSources(sourcePayload.sources);
      setEvents(eventPayload.events);
      setSelectedId((current) => {
        if (current && eventPayload.events.some((event) => event.id === current)) {
          return current;
        }
        return eventPayload.events[0]?.id || "";
      });
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Calendar sync failed.");
    } finally {
      setLoading(false);
      setSyncing(false);
    }
  }

  useEffect(() => {
    void loadAgenda(false);
  }, []);

  useEffect(() => {
    if (
      initialEventId &&
      events.some((event) => event.id === initialEventId)
    ) {
      setSelectedId(initialEventId);
      if (window.innerWidth < 700) setMobileDetailOpen(true);
    }
  }, [events, initialEventId]);

  useEffect(() => {
    if (!selectedId) {
      setSelected(null);
      return;
    }
    let cancelled = false;
    fetch(`/api/calendar/events/${encodeURIComponent(selectedId)}`)
      .then(async (response) => {
        if (!response.ok) throw new Error("Could not load this event.");
        return (await response.json()) as { event: CalendarEventDetail };
      })
      .then((payload) => {
        if (!cancelled) setSelected(payload.event);
      })
      .catch((reason) => {
        if (!cancelled) setError(reason.message);
      });
    return () => {
      cancelled = true;
    };
  }, [selectedId]);

  useEffect(() => {
    if (!scheduleSeed || !sources.length) return;
    const preferred =
      sources.find(
        (source) => source.accountId === scheduleSeed.accountId && source.primary,
      ) ||
      sources.find((source) => source.accountId === scheduleSeed.accountId) ||
      sources.find((source) => source.primary) ||
      sources[0];
    const next = emptyComposer(preferred?.id);
    setComposer({
      ...next,
      title: scheduleSeed.title,
      attendees: scheduleSeed.attendeeEmails.join(", "),
      sourceThreadId: scheduleSeed.threadId,
    });
    setComposerError("");
    setComposerOpen(true);
    onScheduleHandled();
  }, [onScheduleHandled, scheduleSeed, sources]);

  const visibleEvents = useMemo(
    () =>
      events.filter(
        (event) =>
          accountFilter === "all" || event.accountId === accountFilter,
      ),
    [accountFilter, events],
  );

  const grouped = useMemo(() => {
    const groups = new Map<string, CalendarEventSummary[]>();
    for (const event of visibleEvents) {
      const label = eventDay(event.start);
      groups.set(label, [...(groups.get(label) || []), event]);
    }
    return [...groups.entries()];
  }, [visibleEvents]);

  function openNewEvent() {
    const preferred =
      sources.find(
        (source) =>
          (accountFilter === "all" || source.accountId === accountFilter) &&
          source.primary,
      ) ||
      sources.find(
        (source) => accountFilter === "all" || source.accountId === accountFilter,
      ) ||
      sources[0];
    setComposer(emptyComposer(preferred?.id));
    setComposerError("");
    setComposerOpen(true);
  }

  function editEvent() {
    if (!selected) return;
    setComposer({
      id: selected.id,
      etag: selected.etag,
      sourceId: selected.sourceId,
      title: selected.title,
      start: selected.allDay
        ? selected.start.slice(0, 10)
        : localDateTime(new Date(selected.start)),
      end: selected.allDay
        ? selected.end.slice(0, 10)
        : localDateTime(new Date(selected.end)),
      allDay: selected.allDay,
      attendees: selected.attendees.map((attendee) => attendee.address).join(", "),
      location: selected.location,
      description: plainText(selected.description),
      onlineMeeting: Boolean(selected.joinUrl),
    });
    setComposerError("");
    setComposerOpen(true);
  }

  async function saveEvent(event: FormEvent) {
    event.preventDefault();
    if (!composer.sourceId || !composer.title.trim()) return;
    setComposerBusy(true);
    setComposerError("");
    const allDay = composer.allDay;
    const start = allDay
      ? `${composer.start.slice(0, 10)}T00:00:00.000Z`
      : new Date(composer.start).toISOString();
    let end = allDay
      ? `${composer.end.slice(0, 10)}T00:00:00.000Z`
      : new Date(composer.end).toISOString();
    if (allDay && new Date(end) <= new Date(start)) {
      end = new Date(new Date(start).getTime() + 24 * 60 * 60 * 1000).toISOString();
    }
    const body = {
      sourceId: composer.sourceId,
      title: composer.title.trim(),
      start,
      end,
      allDay,
      timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone,
      attendeeEmails: composer.attendees
        .split(/[,\n]/)
        .map((email) => email.trim())
        .filter(Boolean),
      location: composer.location.trim(),
      description: composer.description.trim(),
      onlineMeeting: composer.onlineMeeting,
      sourceThreadId: composer.sourceThreadId,
      etag: composer.etag,
    };
    const response = await fetch(
      composer.id
        ? `/api/calendar/events/${encodeURIComponent(composer.id)}`
        : "/api/calendar/events",
      {
        method: composer.id ? "PATCH" : "POST",
        headers: {
          "content-type": "application/json",
          "idempotency-key": crypto.randomUUID(),
        },
        body: JSON.stringify(body),
      },
    );
    setComposerBusy(false);
    const payload = await response.json();
    if (!response.ok) {
      setComposerError(
        payload.code === "conflict"
          ? "This event changed elsewhere. Sync and try again."
          : payload.error || "Could not save this event.",
      );
      return;
    }
    const saved = payload.event as CalendarEventDetail;
    setEvents((current) => {
      const summary = eventSummary(saved);
      const without = current.filter((candidate) => candidate.id !== saved.id);
      return [...without, summary].sort((a, b) => a.start.localeCompare(b.start));
    });
    setSelectedId(saved.id);
    setSelected(saved);
    setComposerOpen(false);
  }

  async function rsvp(response: EventResponse) {
    if (!selected) return;
    setError("");
    const request = await fetch(
      `/api/calendar/events/${encodeURIComponent(selected.id)}/rsvp`,
      {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "idempotency-key": crypto.randomUUID(),
        },
        body: JSON.stringify({ response }),
      },
    );
    const payload = await request.json();
    if (!request.ok) {
      setError(payload.error || "Could not update your response.");
      return;
    }
    setSelected(payload.event);
    setEvents((current) =>
      current.map((event) =>
        event.id === payload.event.id ? eventSummary(payload.event) : event,
      ),
    );
  }

  async function removeEvent() {
    if (!selected || !window.confirm(`Delete “${selected.title}”?`)) return;
    const response = await fetch(
      `/api/calendar/events/${encodeURIComponent(selected.id)}?etag=${encodeURIComponent(
        selected.etag || "",
      )}`,
      {
        method: "DELETE",
        headers: { "idempotency-key": crypto.randomUUID() },
      },
    );
    const payload = await response.json();
    if (!response.ok) {
      setError(payload.error || "Could not delete this event.");
      return;
    }
    const remaining = events.filter((event) => event.id !== selected.id);
    setEvents(remaining);
    setSelectedId(remaining[0]?.id || "");
    setSelected(null);
  }

  const selectedSource = sources.find(
    (source) => source.id === composer.sourceId,
  );

  return (
    <Fragment>
      <section className="inbox-panel calendar-agenda-panel">
        <header className="inbox-header calendar-agenda-header">
          <div className="inbox-title-row">
            <button
              className="icon-button mobile-only"
              type="button"
              aria-label="Open menu"
              onClick={onOpenMenu}
            >
              <Menu size={20} />
            </button>
            <div>
              <span className="today-label">
                {new Date().toLocaleDateString([], {
                  weekday: "long",
                  month: "long",
                  day: "numeric",
                })}
              </span>
              <h1>Today</h1>
            </div>
            <button
              className="calendar-new-button"
              type="button"
              onClick={openNewEvent}
              disabled={!sources.length}
            >
              <CalendarDays size={15} />
              New event
            </button>
          </div>
          <div className="calendar-sync-line">
            <span>
              {sources.length
                ? `${sources.length} writable calendar${
                    sources.length === 1 ? "" : "s"
                  }`
                : "Connect calendar access"}
            </span>
            <button
              type="button"
              onClick={() => void loadAgenda(true)}
              disabled={syncing}
            >
              <RefreshCw className={syncing ? "spin" : ""} size={14} />
              {syncing ? "Syncing" : "Sync"}
            </button>
          </div>
        </header>

        {error ? <div className="calendar-error">{error}</div> : null}

        <div className="calendar-event-list" aria-label="Upcoming events">
          {loading ? (
            <div className="calendar-empty">
              <Clock3 className="spin" size={24} />
              <p>Opening your agenda…</p>
            </div>
          ) : grouped.length ? (
            grouped.map(([day, dayEvents]) => (
              <section className="calendar-day-group" key={day}>
                <header>
                  <span>{day}</span>
                  <em>{dayEvents.length}</em>
                </header>
                {dayEvents.map((event) => (
                  <button
                    className={`calendar-event-row ${
                      selectedId === event.id ? "selected" : ""
                    }`}
                    type="button"
                    key={event.id}
                    onClick={() => {
                      setSelectedId(event.id);
                      if (window.innerWidth < 700) setMobileDetailOpen(true);
                    }}
                  >
                    <i
                      className="calendar-color"
                      style={{ background: event.calendarColor }}
                    />
                    <span className="calendar-event-time">{eventTime(event)}</span>
                    <span className="calendar-event-copy">
                      <strong>{event.title}</strong>
                      <small>
                        {event.calendarName} ·{" "}
                        {event.provider === "google" ? "Google" : "Outlook"}
                      </small>
                    </span>
                    {event.joinUrl ? <Video size={14} /> : null}
                  </button>
                ))}
              </section>
            ))
          ) : (
            <div className="calendar-empty">
              <CalendarDays size={28} />
              <h2>{sources.length ? "Your time is clear" : "Calendar is one reconnect away"}</h2>
              <p>
                {sources.length
                  ? "No events in this account view."
                  : "Reconnect Gmail or Outlook in Settings to grant calendar access."}
              </p>
              {!sources.length ? (
                <button
                  className="empty-connect"
                  type="button"
                  onClick={() => window.location.assign("/settings")}
                >
                  Open account settings
                </button>
              ) : null}
            </div>
          )}
        </div>
      </section>

      {selected ? (
        <section
          className={`thread-panel calendar-detail-panel ${
            mobileDetailOpen ? "calendar-detail-open" : ""
          }`}
        >
          <header className="thread-header calendar-detail-header">
            <button
              className="icon-button mobile-only"
              type="button"
              aria-label="Back to agenda"
              onClick={() => {
                setMobileDetailOpen(false);
                onBack();
              }}
            >
              <ArrowLeft size={20} />
            </button>
            <div className="thread-heading">
              <span className="conversation-kicker">
                <i
                  className="calendar-source-dot"
                  style={{ background: selected.calendarColor }}
                />
                {selected.calendarName}
                <span aria-hidden="true">·</span>
                {selected.accountEmail}
              </span>
              <h2>{selected.title}</h2>
            </div>
            <div className="thread-actions">
              {selected.editable ? (
                <>
                  <button
                    className="icon-button"
                    type="button"
                    title="Edit event"
                    aria-label="Edit event"
                    onClick={editEvent}
                  >
                    <Edit3 size={17} />
                  </button>
                  <button
                    className="icon-button calendar-delete"
                    type="button"
                    title="Delete event"
                    aria-label="Delete event"
                    onClick={() => void removeEvent()}
                  >
                    <Trash2 size={17} />
                  </button>
                </>
              ) : null}
            </div>
          </header>

          <div className="calendar-detail-scroll">
            <div className="calendar-hero-time">
              <span>{eventDay(selected.start)}</span>
              <strong>{eventTime(selected)}</strong>
              <small>
                {selected.provider === "google" ? "Google Calendar" : "Outlook Calendar"}
              </small>
            </div>

            {selected.joinUrl ? (
              <button
                className="calendar-join"
                type="button"
                onClick={() =>
                  window.open(selected.joinUrl!, "_blank", "noopener,noreferrer")
                }
              >
                <Video size={17} />
                Join {selected.conferenceProvider === "teams" ? "Teams" : "Google Meet"}
                <ExternalLink size={14} />
              </button>
            ) : null}

            <dl className="calendar-facts">
              {selected.location ? (
                <div>
                  <dt>
                    <MapPin size={15} />
                    Where
                  </dt>
                  <dd>{selected.location}</dd>
                </div>
              ) : null}
              <div>
                <dt>
                  <Users size={15} />
                  People
                </dt>
                <dd>
                  <strong>{selected.organizer.name}</strong>
                  <span>{selected.organizer.address}</span>
                  {selected.attendees.map((attendee) => (
                    <span key={attendee.address}>
                      {attendee.name || attendee.address} ·{" "}
                      {attendee.responseStatus === "needsAction"
                        ? "awaiting reply"
                        : attendee.responseStatus}
                    </span>
                  ))}
                </dd>
              </div>
            </dl>

            {plainText(selected.description) ? (
              <section className="calendar-description">
                <span>Notes</span>
                <p>{plainText(selected.description)}</p>
              </section>
            ) : null}

            <div className="calendar-rsvp">
              <span>Your response</span>
              <div>
                {(
                  [
                    ["accepted", "Going"],
                    ["tentative", "Maybe"],
                    ["declined", "Can’t go"],
                  ] as Array<[EventResponse, string]>
                ).map(([value, label]) => (
                  <button
                    className={selected.responseStatus === value ? "active" : ""}
                    type="button"
                    key={value}
                    onClick={() => void rsvp(value)}
                  >
                    {selected.responseStatus === value ? <Check size={14} /> : null}
                    {label}
                  </button>
                ))}
              </div>
            </div>
          </div>
        </section>
      ) : (
        <section className="thread-panel no-selection calendar-no-selection">
          <CalendarDays size={28} />
          <p>Choose an event</p>
        </section>
      )}

      {composerOpen ? (
        <div
          className="compose-layer calendar-compose-layer"
          role="dialog"
          aria-modal="true"
          aria-label={composer.id ? "Edit event" : "New event"}
        >
          <button
            className="search-scrim"
            aria-label="Close event composer"
            type="button"
            onClick={() => setComposerOpen(false)}
          />
          <form className="compose-modal calendar-compose" onSubmit={saveEvent}>
            <header>
              <div>
                <span>{composer.id ? "Update the plan" : "Make time"}</span>
                <h2>{composer.id ? "Edit event" : "New event"}</h2>
              </div>
              <button
                className="icon-button"
                type="button"
                aria-label="Close event composer"
                onClick={() => setComposerOpen(false)}
              >
                <X size={18} />
              </button>
            </header>

            <label>
              Calendar
              <select
                value={composer.sourceId}
                disabled={Boolean(composer.id)}
                onChange={(event) =>
                  setComposer((current) => ({
                    ...current,
                    sourceId: event.target.value,
                  }))
                }
              >
                {sources.map((source) => (
                  <option key={source.id} value={source.id}>
                    {source.name} · {source.accountEmail}
                  </option>
                ))}
              </select>
            </label>

            <label>
              Title
              <input
                autoFocus
                value={composer.title}
                placeholder="What are you making time for?"
                onChange={(event) =>
                  setComposer((current) => ({
                    ...current,
                    title: event.target.value,
                  }))
                }
              />
            </label>

            <div className="calendar-compose-grid">
              <label>
                Starts
                <input
                  type={composer.allDay ? "date" : "datetime-local"}
                  value={composer.start}
                  onChange={(event) =>
                    setComposer((current) => ({
                      ...current,
                      start: event.target.value,
                    }))
                  }
                />
              </label>
              <label>
                Ends
                <input
                  type={composer.allDay ? "date" : "datetime-local"}
                  value={composer.end}
                  onChange={(event) =>
                    setComposer((current) => ({
                      ...current,
                      end: event.target.value,
                    }))
                  }
                />
              </label>
            </div>

            <label className="calendar-check">
              <input
                type="checkbox"
                checked={composer.allDay}
                onChange={(event) =>
                  setComposer((current) => ({
                    ...current,
                    allDay: event.target.checked,
                    start: event.target.checked
                      ? current.start.slice(0, 10)
                      : `${current.start.slice(0, 10)}T09:00`,
                    end: event.target.checked
                      ? current.end.slice(0, 10)
                      : `${current.end.slice(0, 10)}T09:30`,
                  }))
                }
              />
              All day
            </label>

            <label>
              Guests
              <input
                value={composer.attendees}
                placeholder="name@example.com, teammate@company.com"
                onChange={(event) =>
                  setComposer((current) => ({
                    ...current,
                    attendees: event.target.value,
                  }))
                }
              />
            </label>

            <label>
              Location
              <input
                value={composer.location}
                placeholder="Optional"
                onChange={(event) =>
                  setComposer((current) => ({
                    ...current,
                    location: event.target.value,
                  }))
                }
              />
            </label>

            <label>
              Notes
              <textarea
                value={composer.description}
                placeholder="Add context for everyone."
                onChange={(event) =>
                  setComposer((current) => ({
                    ...current,
                    description: event.target.value,
                  }))
                }
              />
            </label>

            {!composer.id ? (
              <label className="calendar-check calendar-video-check">
                <input
                  type="checkbox"
                  checked={composer.onlineMeeting}
                  onChange={(event) =>
                    setComposer((current) => ({
                      ...current,
                      onlineMeeting: event.target.checked,
                    }))
                  }
                />
                <Video size={15} />
                Add{" "}
                {selectedSource?.provider === "microsoft"
                  ? "Microsoft Teams"
                  : "Google Meet"}
              </label>
            ) : null}

            {composerError ? (
              <div className="settings-error">{composerError}</div>
            ) : null}

            <footer>
              <span>
                Times display in{" "}
                {Intl.DateTimeFormat().resolvedOptions().timeZone}
              </span>
              <button
                className="settings-primary"
                type="submit"
                disabled={
                  composerBusy ||
                  !composer.sourceId ||
                  !composer.title.trim() ||
                  !composer.start ||
                  !composer.end
                }
              >
                {composerBusy ? <Clock3 size={16} /> : <CalendarDays size={16} />}
                {composerBusy
                  ? "Saving"
                  : composer.id
                    ? "Save changes"
                    : "Create event"}
              </button>
            </footer>
          </form>
        </div>
      ) : null}
    </Fragment>
  );
}
