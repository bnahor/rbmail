const DAY = 24 * 60 * 60 * 1000;

export const GOOGLE_SCOPES = [
  "openid",
  "email",
  "profile",
  "https://www.googleapis.com/auth/gmail.modify",
  "https://www.googleapis.com/auth/gmail.send",
  "https://www.googleapis.com/auth/calendar.events",
  "https://www.googleapis.com/auth/calendar.calendarlist.readonly",
] as const;

export const MICROSOFT_SCOPES = [
  "openid",
  "profile",
  "email",
  "offline_access",
  "User.Read",
  "Mail.ReadWrite",
  "Mail.Send",
  "Calendars.ReadWrite",
  "Calendars.ReadWrite.Shared",
] as const;

export function calendarCacheWindow(now = new Date()) {
  const start = new Date(now.getTime() - 30 * DAY);
  const end = new Date(now);
  end.setUTCMonth(end.getUTCMonth() + 6);
  return { start: start.toISOString(), end: end.toISOString() };
}

export function calendarCacheNeedsRebase(
  source: { syncCursor: string | null; windowEnd: string | null },
  now = new Date(),
) {
  if (!source.syncCursor || !source.windowEnd) return true;
  const threshold = new Date(now);
  threshold.setUTCMonth(threshold.getUTCMonth() + 4);
  return new Date(source.windowEnd) < threshold;
}

export function accountCapabilities(
  provider: "google" | "microsoft",
  scope = "",
) {
  const scopes = new Set(
    scope
      .split(/\s+/)
      .map((item) => item.trim().toLowerCase())
      .filter(Boolean),
  );
  return {
    mail:
      provider === "google"
        ? scopes.has("https://www.googleapis.com/auth/gmail.modify")
        : scopes.has("mail.readwrite"),
    calendar:
      provider === "google"
        ? scopes.has("https://www.googleapis.com/auth/calendar.events")
        : scopes.has("calendars.readwrite") ||
          scopes.has("calendars.readwrite.shared"),
  };
}

export function googleCalendarDate(
  value: { date?: string; dateTime?: string } | undefined,
  fallback: string,
) {
  if (value?.dateTime) return new Date(value.dateTime).toISOString();
  if (value?.date) return `${value.date}T00:00:00.000Z`;
  return fallback;
}

export function microsoftCalendarDate(
  value: string | undefined,
  fallback: string,
) {
  if (!value) return fallback;
  return new Date(value.endsWith("Z") ? value : `${value}Z`).toISOString();
}

export function microsoftCalendarResponse(value?: string) {
  if (value === "accepted") return "accepted" as const;
  if (value === "tentativelyAccepted" || value === "tentative") {
    return "tentative" as const;
  }
  if (value === "declined") return "declined" as const;
  return "needsAction" as const;
}
