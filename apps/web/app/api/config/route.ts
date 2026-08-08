import { composioEnabled } from "@/lib/mail/composio-core";

export const runtime = "nodejs";

export async function GET() {
  const composio = composioEnabled(
    process.env.COMPOSIO_ENABLED,
    process.env.COMPOSIO_API_KEY,
  );
  const google = Boolean(
    process.env.GOOGLE_CLIENT_ID && process.env.GOOGLE_CLIENT_SECRET,
  );
  const microsoft = Boolean(
    process.env.MICROSOFT_CLIENT_ID && process.env.MICROSOFT_CLIENT_SECRET,
  );
  return Response.json({
    providers: {
      google,
      microsoft,
    },
    integrations: {
      composio,
      google: composio || google,
      microsoft: composio || microsoft,
    },
    appUrl: process.env.APP_URL || "http://localhost:3000",
  });
}
