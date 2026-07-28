import type { StoredToken } from "./types";

export type SocialProviderToken = {
  accessToken?: string;
  refreshToken?: string;
  accessTokenExpiresAt?: Date | string | null;
  scope?: string | null;
};

export function storedTokenFromSocial(
  token: SocialProviderToken,
  now = Date.now(),
): StoredToken {
  if (!token.accessToken) {
    throw new Error("The provider did not return an access token.");
  }
  if (!token.refreshToken) {
    throw new Error(
      "The provider did not return offline access. Please reconnect and approve access.",
    );
  }
  const expiry = token.accessTokenExpiresAt
    ? new Date(token.accessTokenExpiresAt).getTime()
    : now + 60 * 60 * 1000;
  return {
    accessToken: token.accessToken,
    refreshToken: token.refreshToken,
    expiresAt: Number.isFinite(expiry) ? expiry : now + 60 * 60 * 1000,
    scope: token.scope?.replaceAll(",", " ").replace(/\s+/g, " ").trim(),
    tokenType: "Bearer",
  };
}
