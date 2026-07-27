import { cookies } from "next/headers";

import {
  isAuthorized,
  ownerCookie,
  verifyPassword,
} from "@/lib/server/auth";

export const runtime = "nodejs";

export function GET(request: Request) {
  return Response.json({ authenticated: isAuthorized(request) });
}

export async function POST(request: Request) {
  const input = (await request.json()) as { password?: string };
  if (!verifyPassword(input.password || "")) {
    return Response.json({ error: "Incorrect access password." }, { status: 401 });
  }
  const cookie = ownerCookie();
  (await cookies()).set(cookie.name, cookie.value, cookie.options);
  return Response.json({ authenticated: true });
}

export async function DELETE() {
  (await cookies()).delete("rbmail_owner");
  return Response.json({ authenticated: false });
}
