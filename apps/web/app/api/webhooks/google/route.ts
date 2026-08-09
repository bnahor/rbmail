import { createRemoteJWKSet, jwtVerify } from "jose";

import { getAccounts } from "@/lib/server/db";
import { syncAccount } from "@/lib/server/sync";

export const runtime = "nodejs";
export const maxDuration = 60;

const googleKeys = createRemoteJWKSet(new URL("https://www.googleapis.com/oauth2/v3/certs"));

async function authorize(request: Request) {
  const audience = process.env.GOOGLE_PUBSUB_AUDIENCE?.trim();
  const expectedEmail = process.env.GOOGLE_PUBSUB_SERVICE_ACCOUNT?.trim().toLowerCase();
  const authorization = request.headers.get("authorization") || "";
  const token = authorization.startsWith("Bearer ") ? authorization.slice(7) : "";
  if (!audience || !token) return false;
  try {
    const { payload } = await jwtVerify(token, googleKeys, {
      audience,
      issuer: ["https://accounts.google.com", "accounts.google.com"],
    });
    if (expectedEmail && String(payload.email || "").toLowerCase() !== expectedEmail) return false;
    return payload.email_verified !== false;
  } catch {
    return false;
  }
}

export async function POST(request: Request) {
  if (!(await authorize(request))) return new Response(null, { status: 401 });
  const envelope = (await request.json().catch(() => null)) as {
    message?: { data?: string; messageId?: string };
  } | null;
  if (!envelope?.message?.data) return new Response(null, { status: 204 });
  let payload: { emailAddress?: string; historyId?: string };
  try {
    payload = JSON.parse(Buffer.from(envelope.message.data, "base64").toString("utf8"));
  } catch {
    return Response.json({ error: "Malformed Pub/Sub payload." }, { status: 400 });
  }
  const account = getAccounts().find(
    (candidate) => candidate.provider === "google" &&
      candidate.email.toLowerCase() === payload.emailAddress?.toLowerCase(),
  );
  if (!account) return new Response(null, { status: 204 });
  try {
    await syncAccount(account.id, 3);
    return new Response(null, { status: 204 });
  } catch {
    return new Response(null, { status: 503, headers: { "retry-after": "30" } });
  }
}
