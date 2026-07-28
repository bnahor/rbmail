import { auth, ensureAuthSchema } from "@/lib/server/auth";

export const runtime = "nodejs";

async function handler(request: Request) {
  await ensureAuthSchema();
  return auth.handler(request);
}

export { handler as GET, handler as POST };
