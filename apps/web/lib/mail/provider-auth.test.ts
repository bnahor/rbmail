import assert from "node:assert/strict";
import test from "node:test";

import { storedTokenFromSocial } from "./provider-auth.ts";

test("normalizes Better Auth provider tokens for the encrypted mail store", () => {
  assert.deepEqual(
    storedTokenFromSocial(
      {
        accessToken: "access",
        refreshToken: "refresh",
        accessTokenExpiresAt: "2026-07-29T00:00:00.000Z",
        scope: "openid,email,https://www.googleapis.com/auth/gmail.modify",
      },
      Date.parse("2026-07-28T00:00:00.000Z"),
    ),
    {
      accessToken: "access",
      refreshToken: "refresh",
      expiresAt: Date.parse("2026-07-29T00:00:00.000Z"),
      scope: "openid email https://www.googleapis.com/auth/gmail.modify",
      tokenType: "Bearer",
    },
  );
});

test("rejects grants that cannot support background mailbox sync", () => {
  assert.throws(
    () =>
      storedTokenFromSocial({
        accessToken: "access",
      }),
    /offline access/i,
  );
});
