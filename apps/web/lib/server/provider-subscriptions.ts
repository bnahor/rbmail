import { randomBytes } from "node:crypto";

import type { StoredAccount } from "@/lib/mail/types";
import { getAccountSubscription, upsertProviderSubscription } from "./db";
import { watchGoogleInbox } from "./google";
import { createMicrosoftMailSubscription } from "./microsoft";

export async function ensureProviderSubscription(account: StoredAccount) {
  const appUrl = process.env.APP_URL?.replace(/\/$/, "");
  if (account.provider === "google") {
    const topic = process.env.GOOGLE_PUBSUB_TOPIC?.trim();
    if (!topic) return null;
    const existing = getAccountSubscription(account.id, "gmail:inbox");
    if (existing?.expiresAt && existing.expiresAt > Date.now() + 24 * 60 * 60 * 1000) return existing;
    const watch = await watchGoogleInbox(account, topic);
    upsertProviderSubscription({
      id: `gmail:${account.id}`,
      accountId: account.id,
      provider: "google",
      resource: "gmail:inbox",
      details: { historyId: watch.historyId, topic },
      expiresAt: Number(watch.expiration),
    });
    return watch;
  }
  const configuredSecret = process.env.MICROSOFT_WEBHOOK_SECRET?.trim();
  if (!appUrl || !configuredSecret) return null;
  const resource = "graph:inbox";
  const existing = getAccountSubscription(account.id, resource);
  if (existing?.expiresAt && existing.expiresAt > Date.now() + 12 * 60 * 60 * 1000) return existing;
  const clientState = `${configuredSecret}.${randomBytes(12).toString("base64url")}`;
  const subscription = await createMicrosoftMailSubscription(
    account,
    `${appUrl}/api/webhooks/microsoft`,
    clientState,
  );
  upsertProviderSubscription({
    id: subscription.id,
    accountId: account.id,
    provider: "microsoft",
    resource,
    details: { clientState },
    expiresAt: Date.parse(subscription.expirationDateTime),
  });
  return subscription;
}
