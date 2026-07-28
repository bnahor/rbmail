import { requireUser, unauthorized } from "@/lib/server/auth";
import { getAuthorizationUrl } from "@/lib/server/oauth";

export const runtime = "nodejs";

export async function GET(request: Request) {
  const user = await requireUser(request);
  if (!user) return unauthorized();
  try {
    return Response.redirect(getAuthorizationUrl("microsoft", user.id));
  } catch (error) {
    return Response.json(
      {
        error:
          error instanceof Error ? error.message : "Microsoft OAuth failed.",
      },
      { status: 503 },
    );
  }
}
