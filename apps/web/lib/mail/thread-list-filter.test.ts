import assert from "node:assert/strict";
import test from "node:test";

import { providerLabelId, threadListViewFilter } from "./thread-list-filter.ts";

const now = "2026-08-10T12:00:00.000Z";

test("maps every native mailbox destination to a distinct server filter", () => {
  const expected = new Map<string, string>([
    ["attention", "t.unread = 1"],
    ["sent", "t.mailbox_kind = 'sent'"],
    ["drafts", "t.mailbox_kind = 'drafts'"],
    ["junk", "t.mailbox_kind = 'junk'"],
    ["archive", "t.mailbox_kind = 'archive'"],
    ["trash", "t.mailbox_kind = 'trash'"],
    ["flagged", "t.flagged = 1"],
    ["vip", "t.vip = 1"],
    ["snoozed", "t.snoozed_until IS NOT NULL"],
  ]);

  for (const [view, clause] of expected) {
    assert.ok(threadListViewFilter(view, now, false).clauses.includes(clause), view);
  }
});

test("needs attention stays inside the active, unsnoozed inbox", () => {
  const filter = threadListViewFilter("attention", now, false);
  assert.deepEqual(filter.clauses, [
    "t.mailbox_kind = 'inbox'",
    "t.archived = 0",
    "t.unread = 1",
    "(t.snoozed_until IS NULL OR t.snoozed_until <= ?)",
  ]);
  assert.deepEqual(filter.values, [now]);
});

test("search spans mailbox history while the default view remains the active inbox", () => {
  assert.deepEqual(threadListViewFilter(undefined, now, true), { clauses: [], values: [] });
  assert.ok(
    threadListViewFilter(undefined, now, false).clauses.includes("t.mailbox_kind = 'inbox'"),
  );
});

test("custom Gmail labels are filtered after encrypted labels are decoded", () => {
  assert.equal(providerLabelId("label:Label_42"), "Label_42");
  assert.deepEqual(threadListViewFilter("label:Label_42", now, false), {
    clauses: [],
    values: [],
  });
  assert.equal(providerLabelId("label:"), null);
});
