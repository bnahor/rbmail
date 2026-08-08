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
    return await auth.api.signInSocial({
      body: {
        provider,
        callbackURL: `${origin}/api/auth/provider-complete/${provider}?native=1`,
        errorCallbackURL: `${origin}/api/auth/native/error`,
      },
      headers: request.headers,
      asResponse: true,
    });
  } catch (error) {
    return nativeAuthError(
      error instanceof Error ? error.message : "Provider sign-in failed.",
    );
  }
}
