import { getAuthSession } from "@/lib/server/auth";

export const runtime = "nodejs";

export async function GET(request: Request) {
  const session = await getAuthSession(request);
  return Response.json({
    authenticated: Boolean(session),
    user: session?.user ?? null,
  });
}
