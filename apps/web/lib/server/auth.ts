import { createHmac, timingSafeEqual } from "node:crypto";

import { getMasterKey } from "@/lib/server/crypto";

const COOKIE_NAME = "rbmail_owner";

function configuredPassword() {
  return process.env.RBMAIL_ACCESS_PASSWORD?.trim() || "";
}

function sessionValue() {
  return createHmac("sha256", getMasterKey())
    .update(`rbmail-owner:${configuredPassword()}`)
    .digest("base64url");
}

function cookieValue(request: Request): string | null {
  const cookie = request.headers.get("cookie") || "";
  const pair = cookie
    .split(";")
    .map((entry) => entry.trim())
    .find((entry) => entry.startsWith(`${COOKIE_NAME}=`));
  return pair ? decodeURIComponent(pair.slice(COOKIE_NAME.length + 1)) : null;
}

export function isAuthorized(request: Request): boolean {
  const password = configuredPassword();
  if (!password) return process.env.NODE_ENV !== "production";
  const candidate = cookieValue(request);
  if (!candidate) return false;
  const expected = sessionValue();
  const left = Buffer.from(candidate);
  const right = Buffer.from(expected);
  return left.length === right.length && timingSafeEqual(left, right);
}

export function verifyPassword(candidate: string): boolean {
  const expected = configuredPassword();
  if (!expected) return process.env.NODE_ENV !== "production";
  const left = Buffer.from(candidate);
  const right = Buffer.from(expected);
  return left.length === right.length && timingSafeEqual(left, right);
}

export function ownerCookie() {
  return {
    name: COOKIE_NAME,
    value: sessionValue(),
    options: {
      httpOnly: true,
      sameSite: "lax" as const,
      secure: process.env.NODE_ENV === "production",
      path: "/",
      maxAge: 60 * 60 * 24 * 30,
    },
  };
}

export function unauthorized() {
  return Response.json({ error: "Authentication required." }, { status: 401 });
}
