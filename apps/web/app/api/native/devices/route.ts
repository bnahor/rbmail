import { requireUser, unauthorized } from "@/lib/server/auth";
import { registerNativeDevice } from "@/lib/server/db";

export const runtime = "nodejs";

export async function PUT(request: Request) {
  const user = await requireUser(request);
  if (!user) return unauthorized();
  const input = (await request.json()) as {
    token?: string;
    environment?: "sandbox" | "production";
    locale?: string;
  };
  if (!input.token || !/^[0-9a-f]{32,256}$/i.test(input.token)) {
    return Response.json({ error: "Invalid APNs device token." }, { status: 400 });
  }
  return Response.json({
    device: registerNativeDevice({
      userId: user.id,
      token: input.token.toLowerCase(),
      environment: input.environment === "production" ? "production" : "sandbox",
      locale: input.locale,
    }),
  });
}
