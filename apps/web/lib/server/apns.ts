import { connect, constants } from "node:http2";
import { importPKCS8, SignJWT } from "jose";

import type { NormalizedMessage, StoredAccount } from "@/lib/mail/types";
import {
  claimNotificationDelivery,
  getNotificationPreferences,
  listNativeDevices,
  unreadCount,
} from "./db";

let cachedAuthorization: { value: string; expiresAt: number } | null = null;

async function authorizationToken() {
  if (cachedAuthorization && cachedAuthorization.expiresAt > Date.now() + 60_000) {
    return cachedAuthorization.value;
  }
  const keyId = process.env.APNS_KEY_ID?.trim();
  const teamId = process.env.APPLE_TEAM_ID?.trim();
  const configuredKey = process.env.APNS_AUTH_KEY?.trim();
  if (!keyId || !teamId || !configuredKey) return null;
  const pem = configuredKey.includes("BEGIN PRIVATE KEY")
    ? configuredKey.replace(/\\n/g, "\n")
    : Buffer.from(configuredKey, "base64").toString("utf8");
  const key = await importPKCS8(pem, "ES256");
  const value = await new SignJWT({})
    .setProtectedHeader({ alg: "ES256", kid: keyId })
    .setIssuer(teamId)
    .setIssuedAt()
    .sign(key);
  cachedAuthorization = { value, expiresAt: Date.now() + 50 * 60 * 1000 };
  return value;
}

async function postAPNs(
  device: { token: string; environment: "sandbox" | "production" },
  payload: object,
  collapseId: string,
) {
  const authorization = await authorizationToken();
  const topic = process.env.APNS_TOPIC?.trim() || "dev.bnahor.rubidium";
  if (!authorization) return { delivered: false, reason: "not_configured" };
  const origin =
    device.environment === "production"
      ? "https://api.push.apple.com"
      : "https://api.sandbox.push.apple.com";
  return new Promise<{ delivered: boolean; reason?: string }>((resolve) => {
    const client = connect(origin);
    client.once("error", (error) => resolve({ delivered: false, reason: error.message }));
    const request = client.request({
      [constants.HTTP2_HEADER_METHOD]: "POST",
      [constants.HTTP2_HEADER_PATH]: `/3/device/${device.token}`,
      authorization: `bearer ${authorization}`,
      "apns-topic": topic,
      "apns-push-type": "alert",
      "apns-priority": "10",
      "apns-collapse-id": collapseId.slice(0, 64),
    });
    let status = 0;
    let response = "";
    request.setEncoding("utf8");
    request.on("response", (headers) => {
      status = Number(headers[constants.HTTP2_HEADER_STATUS] || 0);
    });
    request.on("data", (chunk) => { response += chunk; });
    request.on("end", () => {
      client.close();
      resolve({
        delivered: status === 200,
        ...(status === 200 ? {} : { reason: response || `APNs ${status}` }),
      });
    });
    request.end(JSON.stringify(payload));
  });
}

export async function notifyNewMail(account: StoredAccount, message: NormalizedMessage) {
  if (!account.userId || message.from.address.toLowerCase() === account.email.toLowerCase()) {
    return [];
  }
  if (!process.env.APNS_KEY_ID || !process.env.APPLE_TEAM_ID || !process.env.APNS_AUTH_KEY) {
    return [];
  }
  if (!claimNotificationDelivery({
    userId: account.userId,
    accountId: account.id,
    providerMessageId: message.providerId,
  })) return [];
  const preferences = getNotificationPreferences(account.userId);
  if (!preferences.enabled) return [];
  if (preferences.scope === "custom" && !preferences.accountIds.includes(account.id)) return [];
  const sender = message.from.name || message.from.address || "New message";
  const title = preferences.showSender ? sender : "New mail";
  const subtitle = preferences.showSubject ? message.subject : undefined;
  const body = preferences.showBody ? message.snippet : "Open Rubidium to read this message.";
  const payload = {
    aps: {
      alert: { title, ...(subtitle ? { subtitle } : {}), body },
      ...(preferences.sound ? { sound: "default" } : {}),
      ...(preferences.badge ? { badge: unreadCount(account.userId) } : {}),
      category: "RUBIDIUM_NEW_MAIL",
      "thread-id": message.providerThreadId,
      "mutable-content": 0,
      "content-available": 1,
    },
    route: { type: "thread", threadId: `${account.id}:${message.providerThreadId}` },
    accountId: account.id,
  };
  return Promise.all(
    listNativeDevices(account.userId).map((device) =>
      postAPNs(device, payload, message.providerThreadId),
    ),
  );
}
