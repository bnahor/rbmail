import { timingSafeEqual } from "node:crypto";

import { getProviderSubscription } from "@/lib/server/db";
import { syncAccount } from "@/lib/server/sync";

export const runtime = "nodejs";
export const maxDuration = 60;

function equal(left: string, right: string) {
  const a = Buffer.from(left);
  const b = Buffer.from(right);
  return a.length === b.length && timingSafeEqual(a, b);
}

export async function POST(request: Request) {
  const validationToken = new URL(request.url).searchParams.get("validationToken");
  if (validationToken) {
    return new Response(validationToken, {
      headers: { "content-type": "text/plain; charset=utf-8" },
    });
  }
  const input = (await request.json().catch(() => null)) as {
    value?: Array<{ subscriptionId?: string; clientState?: string }>;
  } | null;
  const accountIds = new Set<string>();
  for (const notification of input?.value ?? []) {
    if (!notification.subscriptionId || !notification.clientState) continue;
    const subscription = getProviderSubscription(notification.subscriptionId);
    const expected = String(subscription?.details.clientState || "");
    if (subscription?.provider === "microsoft" && expected && equal(expected, notification.clientState)) {
      accountIds.add(subscription.accountId);
    }
  }
  if (!accountIds.size && input?.value?.length) return new Response(null, { status: 401 });
  try {
    await Promise.all([...accountIds].map((id) => syncAccount(id, 3)));
    return new Response(null, { status: 202 });
  } catch {
    return new Response(null, { status: 503, headers: { "retry-after": "30" } });
  }
}
