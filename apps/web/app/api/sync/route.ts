import { isAuthorized, unauthorized } from "@/lib/server/auth";
import { syncAccount, syncAllAccounts } from "@/lib/server/sync";

export const runtime = "nodejs";
export const maxDuration = 300;

export async function POST(request: Request) {
  if (!isAuthorized(request)) return unauthorized();
  const input = (await request.json().catch(() => ({}))) as {
    accountId?: string;
    pages?: number;
  };
  try {
    const results = input.accountId
      ? await syncAccount(input.accountId, input.pages ?? 1)
      : await syncAllAccounts(input.pages ?? 1);
    return Response.json({ results });
  } catch (error) {
    return Response.json(
      { error: error instanceof Error ? error.message : "Sync failed." },
      { status: 502 },
    );
  }
}

export async function GET(request: Request) {
  const configured = process.env.CRON_SECRET;
  const authorization = request.headers.get("authorization");
  if (!configured || authorization !== `Bearer ${configured}`) {
    return unauthorized();
  }
  return Response.json({ results: await syncAllAccounts(1) });
}
