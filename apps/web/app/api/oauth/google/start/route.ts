import { requireUser, unauthorized } from "@/lib/server/auth";
import { getAuthorizationUrl } from "@/lib/server/oauth";

export const runtime = "nodejs";

export async function GET(request: Request) {
  const user = await requireUser(request);
  if (!user) return unauthorized();
  try {
    const native = new URL(request.url).searchParams.get("native") === "1";
    return Response.redirect(getAuthorizationUrl("google", user.id, native));
  } catch (error) {
    return Response.json(
      { error: error instanceof Error ? error.message : "Google OAuth failed." },
      { status: 503 },
    );
  }
}
