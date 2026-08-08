import assert from "node:assert/strict";
import test from "node:test";

import {
  composioEnabled,
  composioToolkit,
  normalizedComposioStatus,
} from "./composio-core.ts";

test("maps Rubidium providers to Composio managed toolkits", () => {
  assert.equal(composioToolkit("google"), "gmail");
  assert.equal(composioToolkit("microsoft"), "outlook");
});

test("requires an explicit feature flag and project key", () => {
  assert.equal(
    composioEnabled("true", "ak_test"),
    true,
  );
  assert.equal(composioEnabled(undefined, "ak_test"), false);
  assert.equal(composioEnabled("true"), false);
});

test("normalizes expired provider grants without hiding other errors", () => {
  assert.equal(normalizedComposioStatus(403), 401);
  assert.equal(normalizedComposioStatus(429), 429);
  assert.equal(normalizedComposioStatus(502), 502);
});
