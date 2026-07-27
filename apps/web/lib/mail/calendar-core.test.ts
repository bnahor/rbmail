import assert from "node:assert/strict";
import test from "node:test";

import {
  accountCapabilities,
  calendarCacheNeedsRebase,
  calendarCacheWindow,
  googleCalendarDate,
  microsoftCalendarDate,
  microsoftCalendarResponse,
  GOOGLE_SCOPES,
  MICROSOFT_SCOPES,
} from "./calendar-core.ts";

test("requests only mail, calendar, and identity OAuth scopes", () => {
  assert.ok(GOOGLE_SCOPES.includes("https://www.googleapis.com/auth/calendar.events"));
  assert.ok(
    GOOGLE_SCOPES.includes(
      "https://www.googleapis.com/auth/calendar.calendarlist.readonly",
    ),
  );
  assert.ok(MICROSOFT_SCOPES.includes("Calendars.ReadWrite"));
  assert.ok(MICROSOFT_SCOPES.includes("Calendars.ReadWrite.Shared"));
  assert.equal(GOOGLE_SCOPES.some((scope) => scope.includes("meetings")), false);
  assert.equal(
    MICROSOFT_SCOPES.some((scope) => scope.includes("OnlineMeetings")),
    false,
  );
});

test("detects calendar capabilities from exact granted scopes", () => {
  assert.deepEqual(
    accountCapabilities(
      "google",
      "openid https://www.googleapis.com/auth/gmail.modify https://www.googleapis.com/auth/calendar.events",
    ),
    { mail: true, calendar: true },
  );
  assert.deepEqual(
    accountCapabilities("microsoft", "Mail.ReadWrite Calendars.ReadWrite.Shared"),
    { mail: true, calendar: true },
  );
  assert.equal(accountCapabilities("google", "openid email").calendar, false);
});

test("builds the rolling cache and rebases with less than four months ahead", () => {
  const now = new Date("2026-07-28T00:00:00.000Z");
  assert.deepEqual(calendarCacheWindow(now), {
    start: "2026-06-28T00:00:00.000Z",
    end: "2027-01-28T00:00:00.000Z",
  });
  assert.equal(
    calendarCacheNeedsRebase(
      {
        syncCursor: "cursor",
        windowEnd: "2026-11-27T23:59:59.000Z",
      },
      now,
    ),
    true,
  );
  assert.equal(
    calendarCacheNeedsRebase(
      {
        syncCursor: "cursor",
        windowEnd: "2026-12-01T00:00:00.000Z",
      },
      now,
    ),
    false,
  );
});

test("retains all-day date semantics and normalizes provider timestamps", () => {
  const fallback = "2026-07-28T00:00:00.000Z";
  assert.equal(
    googleCalendarDate({ date: "2026-08-03" }, fallback),
    "2026-08-03T00:00:00.000Z",
  );
  assert.equal(
    googleCalendarDate(
      { dateTime: "2026-08-03T09:30:00+08:00" },
      fallback,
    ),
    "2026-08-03T01:30:00.000Z",
  );
  assert.equal(
    microsoftCalendarDate("2026-08-03T01:30:00.0000000", fallback),
    "2026-08-03T01:30:00.000Z",
  );
});

test("maps Microsoft RSVP states into provider-neutral responses", () => {
  assert.equal(microsoftCalendarResponse("tentativelyAccepted"), "tentative");
  assert.equal(microsoftCalendarResponse("declined"), "declined");
  assert.equal(microsoftCalendarResponse("notResponded"), "needsAction");
});
