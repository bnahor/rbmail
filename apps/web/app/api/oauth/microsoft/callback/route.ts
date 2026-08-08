import { appUrl, completeMicrosoftOauth } from "@/lib/server/oauth";
import { nativeAuthError, nativeSessionRedirect } from "@/lib/server/auth";
import { consumeOauthState } from "@/lib/server/db";
import { syncAccountCalendars } from "@/lib/server/calendar";
import { syncAccount } from "@/lib/server/sync";

export const runtime = "nodejs";

export async function GET(request: Request) {
  const url = new URL(request.url);
  const publicOrigin = appUrl();
  const code = url.searchParams.get("code");
  const state = url.searchParams.get("state");
  const providerError = url.searchParams.get("error");
  if (providerError || !code || !state) {
    const message = providerError || "Missing OAuth code or state.";
    const native = state
      ? Boolean(consumeOauthState(state, "microsoft")?.native)
      : false;
    if (native) return nativeAuthError(message);
    return Response.redirect(
      new URL(`/settings?error=${encodeURIComponent(message)}`, publicOrigin),
    );
  }
  let native = false;
  try {
    const result = await completeMicrosoftOauth(code, state);
    const { account } = result;
    native = result.native;
    await Promise.allSettled([
      syncAccount(account.id, 1),
      syncAccountCalendars(account.id),
    ]);
    const destination = "/?connected=microsoft";
    if (native) return nativeSessionRedirect(request, destination);
    return Response.redirect(new URL(destination, publicOrigin));
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Microsoft OAuth failed.";
    if (native || Boolean((error as { native?: boolean }).native)) {
      return nativeAuthError(message);
    }
    return Response.redirect(
      new URL(`/settings?error=${encodeURIComponent(message)}`, publicOrigin),
    );
  }
}
