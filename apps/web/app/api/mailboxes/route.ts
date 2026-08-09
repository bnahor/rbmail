import { requireUser, unauthorized } from "@/lib/server/auth";
import { getAccounts } from "@/lib/server/db";
import { listGoogleMailboxes } from "@/lib/server/google";
import { listMicrosoftMailboxes } from "@/lib/server/microsoft";

export const runtime = "nodejs";

export async function GET(request: Request) {
  const user = await requireUser(request);
  if (!user) return unauthorized();
  const results = await Promise.allSettled(
    getAccounts(user.id).map((account) =>
      account.provider === "google"
        ? listGoogleMailboxes(account)
        : listMicrosoftMailboxes(account),
    ),
  );
  return Response.json({
    mailboxes: results.flatMap((result) =>
      result.status === "fulfilled" ? result.value : [],
    ),
    errors: results.flatMap((result) =>
      result.status === "rejected"
        ? [result.reason instanceof Error ? result.reason.message : "Mailbox listing failed."]
        : [],
    ),
  });
}
