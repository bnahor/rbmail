import { isAuthorized, unauthorized } from "@/lib/server/auth";

export const runtime = "nodejs";

export function GET(request: Request) {
  if (!isAuthorized(request)) return unauthorized();
  return Response.json({
    providers: {
      google: Boolean(
        process.env.GOOGLE_CLIENT_ID && process.env.GOOGLE_CLIENT_SECRET,
      ),
      microsoft: Boolean(
        process.env.MICROSOFT_CLIENT_ID && process.env.MICROSOFT_CLIENT_SECRET,
      ),
    },
    appUrl: process.env.APP_URL || "http://localhost:3000",
  });
}
