import type { Provider } from "@/lib/mail/types";
import { requireUser } from "@/lib/server/auth";
import { startComposioConnection } from "@/lib/server/composio";

export const runtime = "nodejs";

const providers = new Set<Provider>(["google", "microsoft"]);

export async function GET(
  request: Request,
  context: { params: Promise<{ provider: string }> },
) {
  const user = await requireUser(request);
  if (!user) {
    return Response.redirect(new URL("/settings", request.url));
  }
  const { provider: candidate } = await context.params;
  if (!providers.has(candidate as Provider)) {
    return Response.redirect(
      new URL("/settings?error=Unsupported+provider", request.url),
    );
  }
  try {
    const url = await startComposioConnection(
      candidate as Provider,
      user.id,
    );
    return Response.redirect(url);
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Composio connection failed.";
    return Response.redirect(
      new URL(`/settings?error=${encodeURIComponent(message)}`, request.url),
    );
  }
}
