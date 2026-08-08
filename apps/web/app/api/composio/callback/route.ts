import { requireUser } from "@/lib/server/auth";
import { syncAccountCalendars } from "@/lib/server/calendar";
import { completeComposioConnection } from "@/lib/server/composio";
import { syncAccount } from "@/lib/server/sync";

export const runtime = "nodejs";

export async function GET(request: Request) {
  const user = await requireUser(request);
  if (!user) {
    return Response.redirect(
      new URL("/settings?error=Sign+in+to+finish+connecting", request.url),
    );
  }
  const url = new URL(request.url);
  const state = url.searchParams.get("state") || "";
  const status = url.searchParams.get("status");
  if (!state || status === "failed") {
    return Response.redirect(
      new URL("/settings?error=Provider+connection+was+cancelled", request.url),
    );
  }
  try {
    const account = await completeComposioConnection(state, user.id);
    await Promise.allSettled([
      syncAccount(account.id, 2),
      syncAccountCalendars(account.id),
    ]);
    return Response.redirect(
      new URL(`/settings?connected=${account.provider}`, request.url),
    );
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Provider connection failed.";
    return Response.redirect(
      new URL(`/settings?error=${encodeURIComponent(message)}`, request.url),
    );
  }
}
