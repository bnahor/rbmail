import { randomBytes } from "node:crypto";

import { Composio } from "@composio/core";

import {
  composioEnabled,
  composioToolkit,
  normalizedComposioStatus,
} from "@/lib/mail/composio-core";
import type { Provider, StoredAccount } from "@/lib/mail/types";
import {
  deleteComposioState,
  getComposioState,
  saveComposioAccount,
  saveComposioState,
} from "@/lib/server/db";

type ProxyMethod = "GET" | "POST" | "PUT" | "PATCH" | "DELETE";

type ComposioHolder = {
  rbmailComposio?: Composio;
};

const globalComposio = globalThis as typeof globalThis & ComposioHolder;

function apiKey() {
  if (
    !composioEnabled(
      process.env.COMPOSIO_ENABLED,
      process.env.COMPOSIO_API_KEY,
    )
  ) {
    throw new Error("Composio is not enabled on this deployment.");
  }
  const value = process.env.COMPOSIO_API_KEY?.trim();
  if (!value) throw new Error("Composio is not configured.");
  return value;
}

function appUrl() {
  return (process.env.APP_URL?.trim() || "http://localhost:3000").replace(
    /\/$/,
    "",
  );
}

function client() {
  if (!globalComposio.rbmailComposio) {
    globalComposio.rbmailComposio = new Composio({ apiKey: apiKey() });
  }
  return globalComposio.rbmailComposio;
}

export function composioConfigured() {
  return composioEnabled(
    process.env.COMPOSIO_ENABLED,
    process.env.COMPOSIO_API_KEY,
  );
}

export async function startComposioConnection(
  provider: Provider,
  userId: string,
  native = false,
) {
  const state = randomBytes(32).toString("base64url");
  const toolkit = composioToolkit(provider);
  const session = await client().sessions.create(userId, {
    toolkits: [toolkit],
    manageConnections: false,
    sandbox: { enable: false },
    multiAccount: {
      enable: true,
      maxAccountsPerToolkit: 10,
      requireExplicitSelection: true,
    },
  });
  const request = await session.authorize(toolkit, {
    callbackUrl: `${appUrl()}/api/composio/callback?state=${encodeURIComponent(state)}${native ? "&native=1" : ""}`,
  });
  if (!request.redirectUrl) {
    throw new Error(`Composio did not return a ${toolkit} connection link.`);
  }
  saveComposioState({
    state,
    userId,
    provider,
    connectedAccountId: request.id,
  });
  return request.redirectUrl;
}

function requestBody(body: BodyInit | null | undefined): unknown {
  if (body === undefined || body === null) return undefined;
  if (typeof body === "string") {
    try {
      return JSON.parse(body) as unknown;
    } catch {
      return body;
    }
  }
  throw new Error("Composio proxy requests currently require a JSON body.");
}

function requestParameters(headers: HeadersInit | undefined) {
  if (!headers) return undefined;
  const parameters: Array<{
    in: "header";
    name: string;
    value: string;
  }> = [];
  const normalized = new Headers(headers);
  normalized.forEach((value, name) => {
    if (name === "authorization" || name === "content-type") return;
    parameters.push({ in: "header", name, value });
  });
  return parameters.length ? parameters : undefined;
}

function providerErrorMessage(data: unknown, fallback: string) {
  if (!data || typeof data !== "object") return fallback;
  const value = data as {
    error?: string | { message?: string };
    error_description?: string;
    message?: string;
  };
  if (typeof value.error === "string") return value.error;
  return (
    value.error?.message || value.error_description || value.message || fallback
  );
}

export async function composioProxyFetch<T>(
  account: StoredAccount,
  endpoint: string,
  init?: RequestInit,
): Promise<T> {
  if (account.authBackend !== "composio" || !account.connectedAccountId) {
    throw new Error("This account is not connected through Composio.");
  }
  const method = (init?.method || "GET").toUpperCase() as ProxyMethod;
  try {
    const response = await client().tools.proxyExecute({
      endpoint,
      method,
      connectedAccountId: account.connectedAccountId,
      body: requestBody(init?.body),
      parameters: requestParameters(init?.headers),
    });
    if (response.status < 200 || response.status >= 300) {
      const status = normalizedComposioStatus(response.status);
      throw Object.assign(
        new Error(
          providerErrorMessage(
            response.data,
            `Composio provider request failed (${response.status}).`,
          ),
        ),
        {
          status,
          code: status === 401 ? "reauth_required" : "provider_error",
        },
      );
    }
    return response.data as T;
  } catch (error) {
    if ((error as { status?: number }).status) throw error;
    const sdkStatus =
      (error as { cause?: { status?: number }; status?: number }).status ||
      (error as { cause?: { status?: number } }).cause?.status;
    throw Object.assign(
      new Error(
        error instanceof Error
          ? error.message
          : "Composio provider request failed.",
      ),
      {
        status: sdkStatus === 401 || sdkStatus === 403 ? 401 : sdkStatus || 502,
        code:
          sdkStatus === 401 || sdkStatus === 403
            ? "reauth_required"
            : "provider_error",
      },
    );
  }
}

export async function completeComposioConnection(
  state: string,
  userId: string,
) {
  const pending = getComposioState(state, userId);
  if (!pending) throw new Error("Composio connection state is invalid or expired.");
  const connected = await client().connectedAccounts.waitForConnection(
    pending.connectedAccountId,
    15_000,
  );
  const expectedToolkit = composioToolkit(pending.provider);
  if (
    connected.status !== "ACTIVE" ||
    connected.toolkit.slug.toLowerCase() !== expectedToolkit
  ) {
    throw new Error(`The ${expectedToolkit} connection did not complete.`);
  }

  const base = {
    id: pending.connectedAccountId,
    userId,
    provider: pending.provider,
    providerAccountId: pending.connectedAccountId,
    email: pending.connectedAccountId,
    displayName: expectedToolkit,
    authBackend: "composio" as const,
    connectedAccountId: pending.connectedAccountId,
    token: {
      accessToken: "",
      refreshToken: "",
      expiresAt: Number.MAX_SAFE_INTEGER,
    },
    syncCursor: null,
    status: "connected" as const,
    lastSyncAt: null,
  } satisfies StoredAccount;

  if (pending.provider === "google") {
    const profile = await composioProxyFetch<{ emailAddress: string }>(
      base,
      "https://gmail.googleapis.com/gmail/v1/users/me/profile",
    );
    const account = saveComposioAccount({
      userId,
      provider: "google",
      connectedAccountId: pending.connectedAccountId,
      providerAccountId: profile.emailAddress.toLowerCase(),
      email: profile.emailAddress,
      displayName: profile.emailAddress.split("@")[0],
    });
    deleteComposioState(state);
    return account;
  }

  const profile = await composioProxyFetch<{
    id: string;
    displayName?: string;
    mail?: string;
    userPrincipalName?: string;
  }>(
    base,
    "https://graph.microsoft.com/v1.0/me?$select=id,displayName,mail,userPrincipalName",
  );
  const email = profile.mail || profile.userPrincipalName || profile.id;
  const account = saveComposioAccount({
    userId,
    provider: "microsoft",
    connectedAccountId: pending.connectedAccountId,
    providerAccountId: profile.id,
    email,
    displayName: profile.displayName || email.split("@")[0],
  });
  deleteComposioState(state);
  return account;
}

export async function deleteComposioConnection(connectedAccountId: string) {
  await client().connectedAccounts.delete(connectedAccountId);
}
