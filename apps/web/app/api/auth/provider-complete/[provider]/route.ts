import { storedTokenFromSocial } from "@/lib/mail/provider-auth";
import type { Provider } from "@/lib/mail/types";
import {
  auth,
  nativeAuthError,
  nativeSessionRedirect,
  requireUser,
} from "@/lib/server/auth";
import { syncAccountCalendars } from "@/lib/server/calendar";
import { composioConfigured } from "@/lib/server/composio";
import { saveProviderAccountFromToken } from "@/lib/server/oauth";
import { syncAccount } from "@/lib/server/sync";

export const runtime = "nodejs";

const providers = new Set<Provider>(["google", "microsoft"]);

export async function GET(
  request: Request,
  context: { params: Promise<{ provider: string }> },
) {
  const { provider: candidate } = await context.params;
  if (!providers.has(candidate as Provider)) {
    return Response.redirect(
      new URL("/settings?error=Unsupported+provider", request.url),
    );
  }
  const provider = candidate as Provider;
  const native = new URL(request.url).searchParams.get("native") === "1";
  const user = await requireUser(request);
  if (!user) {
    if (native) return nativeAuthError("Provider sign-in did not complete.");
    return Response.redirect(
      new URL("/settings?error=Provider+sign-in+did+not+complete", request.url),
    );
  }

  try {
    if (composioConfigured()) {
      return Response.redirect(
        new URL(
          `/api/composio/connect/${provider}${native ? "?native=1" : ""}`,
          request.url,
        ),
      );
    }
    const grant = await auth.api.refreshToken({
      body: { providerId: provider },
      headers: request.headers,
    });
    const account = await saveProviderAccountFromToken(
      provider,
      user.id,
      storedTokenFromSocial(grant),
    );
    await Promise.allSettled([
      syncAccount(account.id, 2),
      syncAccountCalendars(account.id),
    ]);
    const destination = `/?connected=${encodeURIComponent(provider)}`;
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
