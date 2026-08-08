import { createHash, randomBytes } from "node:crypto";

import {
  GOOGLE_SCOPES,
  MICROSOFT_SCOPES,
} from "@/lib/mail/calendar-core";
import type { Provider, StoredToken } from "@/lib/mail/types";
import {
  consumeOauthState,
  saveAccount,
  saveOauthState,
} from "@/lib/server/db";

function required(name: string): string {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`${name} is not configured.`);
  return value;
}

export function appUrl(): string {
  return (process.env.APP_URL?.trim() || "http://localhost:3000").replace(
    /\/$/,
    "",
  );
}

function verifierAndChallenge() {
  const verifier = randomBytes(48).toString("base64url");
  const challenge = createHash("sha256").update(verifier).digest("base64url");
  return { verifier, challenge };
}

export function getAuthorizationUrl(
  provider: Provider,
  userId: string,
  native = false,
): string {
  const state = randomBytes(32).toString("base64url");
  const { verifier, challenge } = verifierAndChallenge();
  saveOauthState(state, userId, provider, verifier, native);

  if (provider === "google") {
    const params = new URLSearchParams({
      client_id: required("GOOGLE_CLIENT_ID"),
      redirect_uri: `${appUrl()}/api/oauth/google/callback`,
      response_type: "code",
      access_type: "offline",
      include_granted_scopes: "true",
      prompt: "consent select_account",
      state,
      code_challenge: challenge,
      code_challenge_method: "S256",
      scope: GOOGLE_SCOPES.join(" "),
    });
    return `https://accounts.google.com/o/oauth2/v2/auth?${params}`;
  }

  const tenant = process.env.MICROSOFT_TENANT?.trim() || "common";
  const params = new URLSearchParams({
    client_id: required("MICROSOFT_CLIENT_ID"),
    redirect_uri: `${appUrl()}/api/oauth/microsoft/callback`,
    response_type: "code",
    response_mode: "query",
    state,
    code_challenge: challenge,
    code_challenge_method: "S256",
    scope: MICROSOFT_SCOPES.join(" "),
  });
  return `https://login.microsoftonline.com/${tenant}/oauth2/v2.0/authorize?${params}`;
}

async function tokenRequest(
  url: string,
  values: Record<string, string>,
): Promise<Record<string, unknown>> {
  const response = await fetch(url, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams(values),
    cache: "no-store",
  });
  const payload = (await response.json()) as Record<string, unknown>;
  if (!response.ok) {
    throw new Error(
      `OAuth token exchange failed (${response.status}): ${String(
        payload.error_description ?? payload.error ?? "unknown error",
      )}`,
    );
  }
  return payload;
}

function normalizeToken(payload: Record<string, unknown>): StoredToken {
  return {
    accessToken: String(payload.access_token ?? ""),
    refreshToken: String(payload.refresh_token ?? ""),
    expiresAt: Date.now() + Number(payload.expires_in ?? 3600) * 1000,
    scope: payload.scope ? String(payload.scope) : undefined,
    tokenType: payload.token_type ? String(payload.token_type) : "Bearer",
  };
}

export async function completeGoogleOauth(code: string, state: string) {
  const oauthState = consumeOauthState(state, "google");
  if (!oauthState) throw new Error("Google OAuth state is invalid or expired.");
  try {
    const payload = await tokenRequest("https://oauth2.googleapis.com/token", {
      client_id: required("GOOGLE_CLIENT_ID"),
      client_secret: required("GOOGLE_CLIENT_SECRET"),
      redirect_uri: `${appUrl()}/api/oauth/google/callback`,
      grant_type: "authorization_code",
      code,
      code_verifier: oauthState.verifier,
    });
    const token = normalizeToken(payload);
    return {
      account: await saveProviderAccountFromToken(
        "google",
        oauthState.userId,
        token,
      ),
      native: oauthState.native,
    };
  } catch (error) {
    throw Object.assign(
      error instanceof Error ? error : new Error("Google OAuth failed."),
      { native: oauthState.native },
    );
  }
}

export async function saveProviderAccountFromToken(
  provider: Provider,
  userId: string,
  token: StoredToken,
) {
  if (provider === "google") {
    const profileResponse = await fetch(
      "https://gmail.googleapis.com/gmail/v1/users/me/profile",
      {
        headers: { authorization: `Bearer ${token.accessToken}` },
        cache: "no-store",
      },
    );
    if (!profileResponse.ok) {
      throw new Error(
        `Unable to read Gmail profile (${profileResponse.status}).`,
      );
    }
    const profile = (await profileResponse.json()) as {
      emailAddress: string;
    };
    return saveAccount({
      userId,
      provider: "google",
      providerAccountId: profile.emailAddress.toLowerCase(),
      email: profile.emailAddress,
      displayName: profile.emailAddress.split("@")[0],
      token,
    });
  }

  const profileResponse = await fetch(
    "https://graph.microsoft.com/v1.0/me?$select=id,displayName,mail,userPrincipalName",
    {
      headers: { authorization: `Bearer ${token.accessToken}` },
      cache: "no-store",
    },
  );
  if (!profileResponse.ok) {
    throw new Error(
      `Unable to read Microsoft profile (${profileResponse.status}).`,
    );
  }
  const profile = (await profileResponse.json()) as {
    id: string;
    displayName?: string;
    mail?: string;
    userPrincipalName?: string;
  };
  const email = profile.mail || profile.userPrincipalName || profile.id;
  return saveAccount({
    userId,
    provider: "microsoft",
    providerAccountId: profile.id,
    email,
    displayName: profile.displayName || email.split("@")[0],
    token,
  });
}

export async function completeMicrosoftOauth(code: string, state: string) {
  const oauthState = consumeOauthState(state, "microsoft");
  if (!oauthState) throw new Error("Microsoft OAuth state is invalid or expired.");
  try {
    const tenant = process.env.MICROSOFT_TENANT?.trim() || "common";
    const payload = await tokenRequest(
      `https://login.microsoftonline.com/${tenant}/oauth2/v2.0/token`,
      {
        client_id: required("MICROSOFT_CLIENT_ID"),
        client_secret: required("MICROSOFT_CLIENT_SECRET"),
        redirect_uri: `${appUrl()}/api/oauth/microsoft/callback`,
        grant_type: "authorization_code",
        code,
        code_verifier: oauthState.verifier,
        scope: MICROSOFT_SCOPES.join(" "),
      },
    );
    const token = normalizeToken(payload);
    return {
      account: await saveProviderAccountFromToken(
        "microsoft",
        oauthState.userId,
        token,
      ),
      native: oauthState.native,
    };
  } catch (error) {
    throw Object.assign(
      error instanceof Error ? error : new Error("Microsoft OAuth failed."),
      { native: oauthState.native },
    );
  }
}

export async function refreshGoogleToken(refreshToken: string) {
  const payload = await tokenRequest("https://oauth2.googleapis.com/token", {
    client_id: required("GOOGLE_CLIENT_ID"),
    client_secret: required("GOOGLE_CLIENT_SECRET"),
    grant_type: "refresh_token",
    refresh_token: refreshToken,
  });
  return normalizeToken({ ...payload, refresh_token: refreshToken });
}

export async function refreshMicrosoftToken(refreshToken: string) {
  const tenant = process.env.MICROSOFT_TENANT?.trim() || "common";
  const payload = await tokenRequest(
    `https://login.microsoftonline.com/${tenant}/oauth2/v2.0/token`,
    {
      client_id: required("MICROSOFT_CLIENT_ID"),
      client_secret: required("MICROSOFT_CLIENT_SECRET"),
      grant_type: "refresh_token",
      refresh_token: refreshToken,
      scope: MICROSOFT_SCOPES.join(" "),
    },
  );
  return normalizeToken({
    ...payload,
    refresh_token: payload.refresh_token || refreshToken,
  });
}
