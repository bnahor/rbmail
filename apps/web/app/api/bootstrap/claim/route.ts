import {
  requireUser,
  unauthorized,
  verifyLegacyPasscode,
} from "@/lib/server/auth";
import {
  claimUnownedAccounts,
  countUnownedAccounts,
} from "@/lib/server/db";

export const runtime = "nodejs";

export async function GET(request: Request) {
  const user = await requireUser(request);
  if (!user) return unauthorized();
  return Response.json({ unownedAccounts: countUnownedAccounts() });
}

export async function POST(request: Request) {
  const user = await requireUser(request);
  if (!user) return unauthorized();
  const input = (await request.json().catch(() => ({}))) as {
    passcode?: string;
  };
  if (!verifyLegacyPasscode(input.passcode || "")) {
    return Response.json(
      { error: "The migration passcode is incorrect." },
      { status: 401 },
    );
  }
  const claimedAccounts = claimUnownedAccounts(user.id);
  return Response.json({ claimedAccounts });
}
