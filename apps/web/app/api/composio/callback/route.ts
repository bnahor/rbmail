import {
  nativeAuthError,
  nativeSessionRedirect,
  requireUser,
} from "@/lib/server/auth";
import { syncAccountCalendars } from "@/lib/server/calendar";
import { completeComposioConnection } from "@/lib/server/composio";
import { syncAccount } from "@/lib/server/sync";
import { after } from "next/server";

export const runtime = "nodejs";

export async function GET(request: Request) {
  const requestURL = new URL(request.url);
  const native = requestURL.searchParams.get("native") === "1";
  const user = await requireUser(request);
  if (!user) {
    if (native) return nativeAuthError("Sign in to finish connecting.");
    return Response.redirect(
      new URL("/settings?error=Sign+in+to+finish+connecting", request.url),
    );
  }
  const state = requestURL.searchParams.get("state") || "";
  const status = requestURL.searchParams.get("status");
  if (!state || status === "failed") {
    if (native) return nativeAuthError("Provider connection was cancelled.");
    return Response.redirect(
      new URL("/settings?error=Provider+connection+was+cancelled", request.url),
    );
  }
  try {
    const account = await completeComposioConnection(state, user.id);
    after(async () => {
      await Promise.allSettled([
        syncAccount(account.id, 2),
        syncAccountCalendars(account.id),
      ]);
    });
    const destination = `/settings?connected=${account.provider}`;
    if (native) return nativeSessionRedirect(request, destination);
    return Response.redirect(new URL(destination, request.url));
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Provider connection failed.";
    if (native) return nativeAuthError(message);
    return Response.redirect(
      new URL(`/settings?error=${encodeURIComponent(message)}`, request.url),
    );
  }
}
