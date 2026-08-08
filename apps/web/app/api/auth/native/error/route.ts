import { nativeAuthError } from "@/lib/server/auth";

export function GET(request: Request) {
  const message =
    new URL(request.url).searchParams.get("error_description") ||
    new URL(request.url).searchParams.get("error") ||
    "Provider sign-in failed.";
  return nativeAuthError(message);
}
