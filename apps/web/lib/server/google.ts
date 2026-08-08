import type {
  NormalizedMessage,
  StoredAccount,
  SyncResult,
} from "@/lib/mail/types";
import {
  deleteProviderMessage,
  updateAccountSync,
  updateAccountToken,
  upsertMessage,
} from "@/lib/server/db";
import { composioProxyFetch } from "@/lib/server/composio";
import {
  cleanText,
  decodeBase64Url,
  parseAddress,
  parseAddressList,
  stripHtml,
} from "@/lib/server/mail-utils";
import { refreshGoogleToken } from "@/lib/server/oauth";

type GmailPart = {
  mimeType?: string;
  filename?: string;
  headers?: Array<{ name: string; value: string }>;
  body?: { data?: string; attachmentId?: string };
  parts?: GmailPart[];
};

type GmailMessage = {
  id: string;
  threadId: string;
  labelIds?: string[];
  snippet?: string;
  internalDate?: string;
  payload?: GmailPart;
};

type GoogleCursor =
  | { phase: "initial"; pageToken?: string; historyId: string }
  | { phase: "incremental"; historyId: string; pageToken?: string };

async function accessToken(account: StoredAccount): Promise<string> {
  if (account.token.expiresAt > Date.now() + 60_000) {
    return account.token.accessToken;
  }
  if (!account.token.refreshToken) throw new Error("Google refresh token missing.");
  const nextToken = await refreshGoogleToken(account.token.refreshToken);
  const refreshed = {
    ...nextToken,
    scope: nextToken.scope || account.token.scope,
  };
  updateAccountToken(account.id, refreshed);
  account.token = refreshed;
  return refreshed.accessToken;
}

async function gmailFetch<T>(
  account: StoredAccount,
  path: string,
  init?: RequestInit,
): Promise<T> {
  if (account.authBackend === "composio") {
    return composioProxyFetch<T>(
      account,
      `https://gmail.googleapis.com/gmail/v1${path}`,
      init,
    );
  }
  const token = await accessToken(account);
  const response = await fetch(`https://gmail.googleapis.com/gmail/v1${path}`, {
    ...init,
    headers: {
      authorization: `Bearer ${token}`,
      "content-type": "application/json",
      ...init?.headers,
    },
    cache: "no-store",
  });
  if (!response.ok) {
    const error = new Error(`Gmail request failed (${response.status}).`);
    Object.assign(error, { status: response.status });
    throw error;
  }
  if (response.status === 204) return undefined as T;
  return (await response.json()) as T;
}

export async function changeGoogleMessage(
  account: StoredAccount,
  providerMessageId: string,
  action: "read" | "unread" | "archive",
) {
  const body =
    action === "archive"
      ? { removeLabelIds: ["INBOX"] }
      : action === "read"
        ? { removeLabelIds: ["UNREAD"] }
        : { addLabelIds: ["UNREAD"] };
  await gmailFetch(
    account,
    `/users/me/messages/${encodeURIComponent(providerMessageId)}/modify`,
    { method: "POST", body: JSON.stringify(body) },
  );
}

function safeHeader(value: string) {
  return value.replace(/[\r\n]+/g, " ").trim();
}

export async function replyWithGoogle(
  account: StoredAccount,
  input: {
    providerThreadId: string;
    to: string;
    subject: string;
    body: string;
  },
) {
  const subject = /^re:/i.test(input.subject)
    ? input.subject
    : `Re: ${input.subject}`;
  const raw = [
    `From: ${safeHeader(account.email)}`,
    `To: ${safeHeader(input.to)}`,
    `Subject: ${safeHeader(subject)}`,
    "MIME-Version: 1.0",
    'Content-Type: text/plain; charset="UTF-8"',
    "Content-Transfer-Encoding: 8bit",
    "",
    input.body,
  ].join("\r\n");
  await gmailFetch(account, "/users/me/messages/send", {
    method: "POST",
    body: JSON.stringify({
      threadId: input.providerThreadId,
      raw: Buffer.from(raw, "utf8").toString("base64url"),
    }),
  });
}

export async function sendWithGoogle(
  account: StoredAccount,
  input: { to: string; subject: string; body: string },
) {
  const raw = [
    `From: ${safeHeader(account.email)}`,
    `To: ${safeHeader(input.to)}`,
    `Subject: ${safeHeader(input.subject)}`,
    "MIME-Version: 1.0",
    'Content-Type: text/plain; charset="UTF-8"',
    "Content-Transfer-Encoding: 8bit",
    "",
    input.body,
  ].join("\r\n");
  await gmailFetch(account, "/users/me/messages/send", {
    method: "POST",
    body: JSON.stringify({
      raw: Buffer.from(raw, "utf8").toString("base64url"),
    }),
  });
}

function header(part: GmailPart | undefined, name: string): string | undefined {
  return part?.headers?.find(
    (candidate) => candidate.name.toLowerCase() === name.toLowerCase(),
  )?.value;
}

function collectBodies(part: GmailPart | undefined): {
  plain: string[];
  html: string[];
  hasAttachments: boolean;
} {
  const result = { plain: [] as string[], html: [] as string[], hasAttachments: false };
  function visit(candidate: GmailPart | undefined) {
    if (!candidate) return;
    if (candidate.filename || candidate.body?.attachmentId) result.hasAttachments = true;
    const data = decodeBase64Url(candidate.body?.data);
    if (data && candidate.mimeType === "text/plain") result.plain.push(data);
    if (data && candidate.mimeType === "text/html") result.html.push(data);
    candidate.parts?.forEach(visit);
  }
  visit(part);
  return result;
}

function normalizeGmailMessage(message: GmailMessage): NormalizedMessage {
  const bodies = collectBodies(message.payload);
  const html = bodies.html.join("\n");
  const text = cleanText(bodies.plain.join("\n") || stripHtml(html));
  const receivedAt = new Date(Number(message.internalDate ?? Date.now())).toISOString();
  return {
    id: message.id,
    providerId: message.id,
    providerThreadId: message.threadId || message.id,
    subject: header(message.payload, "Subject") || "(no subject)",
    snippet: cleanText(message.snippet || text.slice(0, 240)),
    bodyText: text,
    bodyHtml: html || null,
    from: parseAddress(header(message.payload, "From")),
    to: parseAddressList(header(message.payload, "To")),
    cc: parseAddressList(header(message.payload, "Cc")),
    receivedAt,
    isRead: !message.labelIds?.includes("UNREAD"),
    hasAttachments: bodies.hasAttachments,
    labels: message.labelIds ?? [],
  };
}

async function fetchAndStore(account: StoredAccount, ids: string[]) {
  let processed = 0;
  for (let index = 0; index < ids.length; index += 8) {
    const batch = ids.slice(index, index + 8);
    const messages = await Promise.all(
      batch.map((id) =>
        gmailFetch<GmailMessage>(
          account,
          `/users/me/messages/${encodeURIComponent(id)}?format=full`,
        ),
      ),
    );
    messages.forEach((message) => {
      upsertMessage(account, normalizeGmailMessage(message));
      processed += 1;
    });
  }
  return processed;
}

export async function syncGoogleAccount(
  account: StoredAccount,
): Promise<SyncResult> {
  updateAccountSync(account.id, { status: "syncing" });
  let cursor = account.syncCursor
    ? (JSON.parse(account.syncCursor) as GoogleCursor)
    : null;

  try {
    if (!cursor || cursor.phase === "initial") {
      if (!cursor) {
        const profile = await gmailFetch<{ historyId: string }>(
          account,
          "/users/me/profile",
        );
        cursor = { phase: "initial", historyId: profile.historyId };
      }
      const query = new URLSearchParams({ maxResults: "100" });
      if (cursor.pageToken) query.set("pageToken", cursor.pageToken);
      const page = await gmailFetch<{
        messages?: Array<{ id: string }>;
        nextPageToken?: string;
      }>(account, `/users/me/messages?${query}`);
      const processed = await fetchAndStore(
        account,
        (page.messages ?? []).map((message) => message.id),
      );
      const nextCursor: GoogleCursor = page.nextPageToken
        ? {
            phase: "initial",
            historyId: cursor.historyId,
            pageToken: page.nextPageToken,
          }
        : { phase: "incremental", historyId: cursor.historyId };
      updateAccountSync(account.id, {
        cursor: JSON.stringify(nextCursor),
        status: "connected",
        markSynced: true,
      });
      return {
        accountId: account.id,
        processed,
        hasMore: Boolean(page.nextPageToken),
        mode: "initial",
      };
    }

    const query = new URLSearchParams({
      startHistoryId: cursor.historyId,
      maxResults: "500",
    });
    if (cursor.pageToken) query.set("pageToken", cursor.pageToken);
    const page = await gmailFetch<{
      history?: Array<{
        messages?: Array<{ id: string }>;
        messagesAdded?: Array<{ message: { id: string } }>;
        messagesDeleted?: Array<{ message: { id: string } }>;
      }>;
      historyId?: string;
      nextPageToken?: string;
    }>(account, `/users/me/history?${query}`);
    const touched = new Set<string>();
    for (const history of page.history ?? []) {
      history.messages?.forEach((message) => touched.add(message.id));
      history.messagesAdded?.forEach(({ message }) => touched.add(message.id));
      history.messagesDeleted?.forEach(({ message }) => {
        touched.delete(message.id);
        deleteProviderMessage(account.id, message.id);
      });
    }
    const processed = await fetchAndStore(account, [...touched]);
    const nextCursor: GoogleCursor = {
      phase: "incremental",
      historyId: page.historyId ?? cursor.historyId,
      pageToken: page.nextPageToken,
    };
    updateAccountSync(account.id, {
      cursor: JSON.stringify(nextCursor),
      status: "connected",
      markSynced: true,
    });
    return {
      accountId: account.id,
      processed,
      hasMore: Boolean(page.nextPageToken),
      mode: "incremental",
    };
  } catch (error) {
    if ((error as { status?: number }).status === 401) {
      updateAccountSync(account.id, { status: "reauth_required" });
    } else if (
      (error as { status?: number }).status === 404 &&
      cursor?.phase === "incremental"
    ) {
      updateAccountSync(account.id, { cursor: null, status: "connected" });
    } else {
      updateAccountSync(account.id, { status: "error" });
    }
    throw error;
  }
}
