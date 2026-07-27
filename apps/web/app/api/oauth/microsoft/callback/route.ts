import { appUrl, completeMicrosoftOauth } from "@/lib/server/oauth";
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
    return Response.redirect(
      new URL(`/settings?error=${encodeURIComponent(message)}`, publicOrigin),
    );
  }
  try {
    const account = await completeMicrosoftOauth(code, state);
    await syncAccount(account.id, 1);
    return Response.redirect(
      new URL(`/settings?connected=microsoft`, publicOrigin),
    );
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Microsoft OAuth failed.";
    return Response.redirect(
      new URL(`/settings?error=${encodeURIComponent(message)}`, publicOrigin),
    );
  }
}
