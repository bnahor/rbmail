import type { NotificationPreferences } from "@/lib/mail/types";
import { requireUser, unauthorized } from "@/lib/server/auth";
import {
  getNotificationPreferences,
  saveNotificationPreferences,
} from "@/lib/server/db";

export const runtime = "nodejs";

export async function GET(request: Request) {
  const user = await requireUser(request);
  if (!user) return unauthorized();
  return Response.json({ preferences: getNotificationPreferences(user.id) });
}

export async function PATCH(request: Request) {
  const user = await requireUser(request);
  if (!user) return unauthorized();
  const current = getNotificationPreferences(user.id);
  const input = (await request.json()) as Partial<NotificationPreferences>;
  const preferences: NotificationPreferences = {
    ...current,
    ...input,
    accountIds: Array.isArray(input.accountIds) ? input.accountIds : current.accountIds,
  };
  if (!["all", "priority", "custom"].includes(preferences.scope)) {
    return Response.json({ error: "Invalid notification scope." }, { status: 400 });
  }
  return Response.json({ preferences: saveNotificationPreferences(user.id, preferences) });
}
