import type { Provider } from "@/lib/mail/types";
import { auth, nativeAuthError } from "@/lib/server/auth";

export const runtime = "nodejs";

const providers = new Set<Provider>(["google", "microsoft"]);

export async function GET(
  request: Request,
  context: { params: Promise<{ provider: string }> },
) {
  const { provider: candidate } = await context.params;
  if (!providers.has(candidate as Provider)) {
    return nativeAuthError("Unsupported provider.");
  }
  const provider = candidate as Provider;
  const origin = new URL(request.url).origin;
  try {
    const response = await auth.api.signInSocial({
      body: {
        provider,
        callbackURL: `${origin}/api/auth/provider-complete/${provider}?native=1`,
        errorCallbackURL: `${origin}/api/auth/native/error`,
      },
      headers: request.headers,
      asResponse: true,
    });
    if (!response.ok) {
      const payload = (await response.clone().json().catch(() => null)) as {
        message?: string;
      } | null;
      throw new Error(
        payload?.message || `Provider sign-in failed (${response.status}).`,
      );
    }

    const location = response.headers.get("location");
    if (!location) {
      throw new Error("Provider sign-in did not return an authorization URL.");
    }

    // Better Auth's server API returns the authorization URL as JSON with a
    // Location header. ASWebAuthenticationSession needs an actual redirect,
    // while the OAuth state cookie still has to be forwarded unchanged.
    const headers = new Headers(response.headers);
    headers.delete("content-length");
    headers.delete("content-type");
    return new Response(null, { status: 302, headers });
  } catch (error) {
    return nativeAuthError(
      error instanceof Error ? error.message : "Provider sign-in failed.",
    );
  }
}
