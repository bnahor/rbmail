import { storedTokenFromSocial } from "@/lib/mail/provider-auth";
import type { Provider } from "@/lib/mail/types";
import { auth, requireUser } from "@/lib/server/auth";
import { syncAccountCalendars } from "@/lib/server/calendar";
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
  const user = await requireUser(request);
  if (!user) {
    return Response.redirect(
      new URL("/settings?error=Provider+sign-in+did+not+complete", request.url),
    );
  }

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
    await Promise.allSettled([
      syncAccount(account.id, 2),
      syncAccountCalendars(account.id),
    ]);
    return Response.redirect(
      new URL(`/?connected=${encodeURIComponent(provider)}`, request.url),
    );
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Provider connection failed.";
    return Response.redirect(
      new URL(`/settings?error=${encodeURIComponent(message)}`, request.url),
    );
  }
}
