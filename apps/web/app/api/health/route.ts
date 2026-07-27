export const runtime = "nodejs";

export function GET() {
  return Response.json({
    status: "ok",
    service: "rbmail",
    timestamp: new Date().toISOString(),
  });
}
