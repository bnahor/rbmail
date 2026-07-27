import type { SyncResult } from "@/lib/mail/types";
import { getAccount, getAccounts } from "@/lib/server/db";
import { syncGoogleAccount } from "@/lib/server/google";
import { syncMicrosoftAccount } from "@/lib/server/microsoft";

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
  return results;
}

export async function syncAllAccounts(pagesPerAccount = 1) {
  const results: SyncResult[] = [];
  for (const account of getAccounts()) {
    try {
      results.push(...(await syncAccount(account.id, pagesPerAccount)));
    } catch {
      // The account status records the failure without preventing other accounts.
    }
  }
  return results;
}
