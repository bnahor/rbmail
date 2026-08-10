import assert from "node:assert/strict";
import test from "node:test";

import { rankRecipientSuggestions } from "./recipient-suggestions.ts";

const candidates = [
  { name: "Ada Lovelace", address: "ada@example.com", lastMessageAt: "2026-08-08T10:00:00Z" },
  { name: "Ada Lovelace", address: "ADA@example.com", lastMessageAt: "2026-08-09T10:00:00Z" },
  { name: "Alan Turing", address: "alan@example.com", lastMessageAt: "2026-08-10T10:00:00Z" },
  { name: "Rubidium Owner", address: "owner@example.com", lastMessageAt: "2026-08-10T11:00:00Z" },
];

test("deduplicates mailbox participants and excludes connected account addresses", () => {
  assert.deepEqual(rankRecipientSuggestions(candidates, ["owner@example.com"]), [
    { name: "Ada Lovelace", address: "ada@example.com" },
    { name: "Alan Turing", address: "alan@example.com" },
  ]);
});

test("matches names and addresses while favoring a prefix match", () => {
  assert.deepEqual(rankRecipientSuggestions(candidates, [], "alan"), [
    { name: "Alan Turing", address: "alan@example.com" },
  ]);
  assert.deepEqual(rankRecipientSuggestions(candidates, [], "lovelace"), [
    { name: "Ada Lovelace", address: "ada@example.com" },
  ]);
});

test("caps the result set for a compact native suggestion surface", () => {
  assert.equal(rankRecipientSuggestions(candidates, [], "", 1).length, 1);
});
