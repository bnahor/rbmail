import { isAuthorized, unauthorized } from "@/lib/server/auth";
import { getAuthorizationUrl } from "@/lib/server/oauth";

export const runtime = "nodejs";

export function GET(request: Request) {
  if (!isAuthorized(request)) return unauthorized();
  try {
    return Response.redirect(getAuthorizationUrl("microsoft"));
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
