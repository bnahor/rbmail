import { storedTokenFromSocial } from "@/lib/mail/provider-auth";
import type { Provider } from "@/lib/mail/types";
import {
  auth,
  nativeAuthError,
  nativeSessionRedirect,
  requireUser,
} from "@/lib/server/auth";
import { syncAccountCalendars } from "@/lib/server/calendar";
import { saveProviderAccountFromToken } from "@/lib/server/oauth";
import { syncAccount } from "@/lib/server/sync";
import { after } from "next/server";

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

  let destination: string;
  try {
    const grant = await auth.api.refreshToken({
      body: { providerId: provider },
      headers: request.headers,
    });
    const account = await saveProviderAccountFromToken(
      provider,
      user.id,
      storedTokenFromSocial(grant),
    );
    after(async () => {
      await Promise.allSettled([
        syncAccount(account.id, 2),
        syncAccountCalendars(account.id),
      ]);
    });
    destination = `/?connected=${encodeURIComponent(provider)}`;
  } catch (error) {
    // Identity sign-in has already succeeded. A missing/expired mail grant or
    // provider API failure must not discard that valid session.
    console.error("Provider mailbox connection failed after sign-in", {
      provider,
      errorType: error instanceof Error ? error.name : "unknown",
    });
    const message = `${provider === "google" ? "Gmail" : "Outlook"} sign-in succeeded, but the mailbox could not be connected. Reconnect it here.`;
    destination = `/settings?error=${encodeURIComponent(message)}`;
  }

  try {
    if (native) return await nativeSessionRedirect(request, destination);
    return Response.redirect(new URL(destination, request.url));
  } catch {
    if (native) return nativeAuthError("Sign-in succeeded, but the app session could not be transferred. Please try again.");
    return Response.redirect(
      new URL("/settings?error=Session+handoff+failed", request.url),
    );
  }
}
