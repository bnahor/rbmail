import { createHash, timingSafeEqual } from "node:crypto";

import { betterAuth } from "better-auth";

import {
  GOOGLE_SCOPES,
  MICROSOFT_SCOPES,
} from "@/lib/mail/calendar-core";
import { getMasterKey } from "@/lib/server/crypto";
import { getDatabase } from "@/lib/server/db";

function appUrl() {
  return process.env.APP_URL?.replace(/\/$/, "") || "http://localhost:3000";
}

function authSecret() {
  const configured = process.env.BETTER_AUTH_SECRET?.trim();
  if (configured) return configured;
  return createHash("sha256")
    .update(getMasterKey())
    .update("rubidium:better-auth")
    .digest("base64url");
}

export const auth = betterAuth({
  appName: "Rubidium",
  baseURL: appUrl(),
  secret: authSecret(),
  database: getDatabase(),
  trustedOrigins: [appUrl()],
  socialProviders: {
    ...(process.env.GOOGLE_CLIENT_ID && process.env.GOOGLE_CLIENT_SECRET
      ? {
          google: {
            clientId: process.env.GOOGLE_CLIENT_ID,
            clientSecret: process.env.GOOGLE_CLIENT_SECRET,
            accessType: "offline" as const,
            prompt: "select_account consent" as const,
            scope: [...GOOGLE_SCOPES],
          },
        }
      : {}),
    ...(process.env.MICROSOFT_CLIENT_ID &&
    process.env.MICROSOFT_CLIENT_SECRET
      ? {
          microsoft: {
            clientId: process.env.MICROSOFT_CLIENT_ID,
            clientSecret: process.env.MICROSOFT_CLIENT_SECRET,
            tenantId: process.env.MICROSOFT_TENANT?.trim() || "common",
            prompt: "select_account" as const,
            scope: [...MICROSOFT_SCOPES],
            disableProfilePhoto: true,
          },
        }
      : {}),
  },
  emailAndPassword: {
    enabled: true,
    disableSignUp: false,
    minPasswordLength: 8,
    maxPasswordLength: 128,
  },
  account: {
    encryptOAuthTokens: true,
    updateAccountOnSignIn: true,
    accountLinking: {
      enabled: true,
      trustedProviders: ["google", "microsoft"],
      // A verified provider may reclaim and link a matching password account.
      // Mailbox OAuth remains a separate Composio connection, so identity and
      // provider permissions can evolve independently.
      requireLocalEmailVerified: true,
      updateUserInfoOnLink: true,
    },
  },
  session: {
    expiresIn: 60 * 60 * 24 * 30,
    updateAge: 60 * 60 * 24,
  },
  rateLimit: {
    enabled: true,
    storage: "database",
    window: 60,
    max: 100,
    customRules: {
      "/sign-in/email": { window: 60, max: 10 },
      "/sign-up/email": { window: 60, max: 5 },
    },
  },
});

let migrationPromise: Promise<void> | null = null;

export function ensureAuthSchema() {
  if (!migrationPromise) {
    migrationPromise = auth.$context.then(async (context) => {
      await context.runMigrations();
    });
  }
  return migrationPromise;
}

export async function getAuthSession(request: Request) {
  await ensureAuthSchema();
  return auth.api.getSession({ headers: request.headers });
}

export async function requireUser(request: Request) {
  const session = await getAuthSession(request);
  return session?.user ?? null;
}

export function verifyLegacyPasscode(candidate: string): boolean {
  const expected = process.env.RBMAIL_ACCESS_PASSWORD?.trim() || "";
  if (!expected) return process.env.NODE_ENV !== "production";
  const left = Buffer.from(candidate);
  const right = Buffer.from(expected);
  return left.length === right.length && timingSafeEqual(left, right);
}

export function unauthorized() {
  return Response.json({ error: "Authentication required." }, { status: 401 });
}
