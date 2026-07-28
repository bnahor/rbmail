export const runtime = "nodejs";

export async function GET() {
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
