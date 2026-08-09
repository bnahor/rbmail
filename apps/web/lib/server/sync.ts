import type { SyncResult } from "@/lib/mail/types";
import { getAccount, getAccounts } from "@/lib/server/db";
import { syncGoogleAccount } from "@/lib/server/google";
import { syncMicrosoftAccount } from "@/lib/server/microsoft";
import { ensureProviderSubscription } from "@/lib/server/provider-subscriptions";

export async function syncAccount(
  accountId: string,
  pages = 1,
): Promise<SyncResult[]> {
  const account = getAccount(accountId);
  if (!account) throw new Error("Mail account not found.");
  const results: SyncResult[] = [];
  for (let index = 0; index < Math.max(1, Math.min(pages, 10)); index += 1) {
    const latest = getAccount(accountId);
    if (!latest) break;
    const result =
      latest.provider === "google"
        ? await syncGoogleAccount(latest)
        : await syncMicrosoftAccount(latest);
    results.push(result);
    if (!result.hasMore) break;
  }
  const refreshed = getAccount(accountId);
  if (refreshed) await ensureProviderSubscription(refreshed).catch(() => null);
  return results;
}

export async function syncAllAccounts(pagesPerAccount = 1, userId?: string) {
  const results: SyncResult[] = [];
  for (const account of getAccounts(userId)) {
    try {
      results.push(...(await syncAccount(account.id, pagesPerAccount)));
    } catch {
      // The account status records the failure without preventing other accounts.
    }
  }
  return results;
}
