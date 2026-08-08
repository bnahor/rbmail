import type {
  MailAddress,
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
import { cleanText, stripHtml } from "@/lib/server/mail-utils";
import { refreshMicrosoftToken } from "@/lib/server/oauth";

const folders = ["inbox", "sentitems", "drafts", "archive"];

type MicrosoftCursor = {
  folderIndex: number;
  links: Record<string, string>;
};

type GraphAddress = {
  emailAddress?: { name?: string; address?: string };
};

type GraphMessage = {
  id: string;
  conversationId?: string;
  subject?: string;
  bodyPreview?: string;
  body?: { contentType?: string; content?: string };
  from?: GraphAddress;
  toRecipients?: GraphAddress[];
  ccRecipients?: GraphAddress[];
  receivedDateTime?: string;
  sentDateTime?: string;
  isRead?: boolean;
  hasAttachments?: boolean;
  categories?: string[];
  "@removed"?: { reason?: string };
};

async function accessToken(account: StoredAccount): Promise<string> {
  if (account.token.expiresAt > Date.now() + 60_000) {
    return account.token.accessToken;
  }
  if (!account.token.refreshToken) {
    throw new Error("Microsoft refresh token missing.");
  }
  const nextToken = await refreshMicrosoftToken(account.token.refreshToken);
  const refreshed = {
    ...nextToken,
    scope: nextToken.scope || account.token.scope,
  };
  updateAccountToken(account.id, refreshed);
  account.token = refreshed;
  return refreshed.accessToken;
}

async function graphFetch<T>(
  account: StoredAccount,
  urlOrPath: string,
  init?: RequestInit,
): Promise<T> {
  const url = urlOrPath.startsWith("https://")
    ? urlOrPath
    : `https://graph.microsoft.com/v1.0${urlOrPath}`;
  if (account.authBackend === "composio") {
    return composioProxyFetch<T>(account, url, {
      ...init,
      headers: {
        prefer: 'outlook.body-content-type="html", odata.maxpagesize=100',
        ...init?.headers,
      },
    });
  }
  const token = await accessToken(account);
  const response = await fetch(url, {
    ...init,
    headers: {
      authorization: `Bearer ${token}`,
      prefer: 'outlook.body-content-type="html", odata.maxpagesize=100',
      "content-type": "application/json",
      ...init?.headers,
    },
    cache: "no-store",
  });
  if (!response.ok) {
    const error = new Error(`Microsoft Graph request failed (${response.status}).`);
    Object.assign(error, { status: response.status });
    throw error;
  }
  if (response.status === 204) return undefined as T;
  return (await response.json()) as T;
}

export async function changeMicrosoftMessage(
  account: StoredAccount,
  providerMessageId: string,
  action: "read" | "unread" | "archive",
) {
  const messagePath = `/me/messages/${encodeURIComponent(providerMessageId)}`;
  if (action === "archive") {
    const archive = await graphFetch<{ id: string }>(
      account,
      "/me/mailFolders/archive?$select=id",
    );
    await graphFetch(account, `${messagePath}/move`, {
      method: "POST",
      body: JSON.stringify({ destinationId: archive.id }),
    });
    return;
  }
  await graphFetch(account, messagePath, {
    method: "PATCH",
    body: JSON.stringify({ isRead: action === "read" }),
  });
}

export async function replyWithMicrosoft(
  account: StoredAccount,
  providerMessageId: string,
  body: string,
) {
  await graphFetch(
    account,
    `/me/messages/${encodeURIComponent(providerMessageId)}/reply`,
    { method: "POST", body: JSON.stringify({ comment: body }) },
  );
}

export async function sendWithMicrosoft(
  account: StoredAccount,
  input: { to: string; subject: string; body: string },
) {
  await graphFetch(account, "/me/sendMail", {
    method: "POST",
    body: JSON.stringify({
      message: {
        subject: input.subject,
        body: { contentType: "Text", content: input.body },
        toRecipients: [
          { emailAddress: { address: input.to } },
        ],
      },
      saveToSentItems: true,
    }),
  });
}

function address(value: GraphAddress | undefined): MailAddress {
  const raw = value?.emailAddress;
  return {
    name: raw?.name || raw?.address || "Unknown",
    address: (raw?.address || "").toLowerCase(),
  };
}

function normalizeGraphMessage(
  message: GraphMessage,
  folder: string,
): NormalizedMessage {
  const content = message.body?.content || "";
  const isHtml = message.body?.contentType?.toLowerCase() === "html";
  const bodyText = cleanText(isHtml ? stripHtml(content) : content);
  return {
    id: message.id,
    providerId: message.id,
    providerThreadId: message.conversationId || message.id,
    subject: message.subject || "(no subject)",
    snippet: cleanText(message.bodyPreview || bodyText.slice(0, 240)),
    bodyText,
    bodyHtml: isHtml ? content : null,
    from: address(message.from),
    to: (message.toRecipients ?? []).map(address),
    cc: (message.ccRecipients ?? []).map(address),
    receivedAt:
      message.receivedDateTime ||
      message.sentDateTime ||
      new Date().toISOString(),
    isRead: Boolean(message.isRead),
    hasAttachments: Boolean(message.hasAttachments),
    labels: message.categories ?? [],
    folder,
  };
}

export async function syncMicrosoftAccount(
  account: StoredAccount,
): Promise<SyncResult> {
  updateAccountSync(account.id, { status: "syncing" });
  const cursor: MicrosoftCursor = account.syncCursor
    ? (JSON.parse(account.syncCursor) as MicrosoftCursor)
    : { folderIndex: 0, links: {} };
  const folderIndex = Math.min(cursor.folderIndex, folders.length - 1);
  const folder = folders[folderIndex];
  const select = [
    "id",
    "conversationId",
    "subject",
    "bodyPreview",
    "body",
    "from",
    "toRecipients",
    "ccRecipients",
    "receivedDateTime",
    "sentDateTime",
    "isRead",
    "hasAttachments",
    "categories",
  ].join(",");
  const startUrl =
    cursor.links[folder] ||
    `/me/mailFolders/${folder}/messages/delta?$select=${encodeURIComponent(select)}&$top=100`;

  try {
    const page = await graphFetch<{
      value: GraphMessage[];
      "@odata.nextLink"?: string;
      "@odata.deltaLink"?: string;
    }>(account, startUrl);
    let processed = 0;
    page.value.forEach((message) => {
      if (message["@removed"]) {
        deleteProviderMessage(account.id, message.id);
      } else {
        upsertMessage(account, normalizeGraphMessage(message, folder));
        processed += 1;
      }
    });

    const nextLinks = { ...cursor.links };
    const nextLink = page["@odata.nextLink"];
    const deltaLink = page["@odata.deltaLink"];
    if (nextLink) nextLinks[folder] = nextLink;
    if (deltaLink) nextLinks[folder] = deltaLink;

    const finishedFolder = Boolean(deltaLink && !nextLink);
    const nextFolderIndex = finishedFolder
      ? (folderIndex + 1) % folders.length
      : folderIndex;
    const nextCursor: MicrosoftCursor = {
      folderIndex: nextFolderIndex,
      links: nextLinks,
    };
    updateAccountSync(account.id, {
      cursor: JSON.stringify(nextCursor),
      status: "connected",
      markSynced: true,
    });
    return {
      accountId: account.id,
      processed,
      hasMore: Boolean(nextLink) || nextFolderIndex !== 0,
      mode: account.syncCursor ? "incremental" : "initial",
    };
  } catch (error) {
    const status = (error as { status?: number }).status;
    if (status === 401) {
      updateAccountSync(account.id, { status: "reauth_required" });
    } else if (status === 404 && folder === "archive") {
      const nextCursor = { ...cursor, folderIndex: 0 };
      updateAccountSync(account.id, {
        cursor: JSON.stringify(nextCursor),
        status: "connected",
      });
      return {
        accountId: account.id,
        processed: 0,
        hasMore: false,
        mode: account.syncCursor ? "incremental" : "initial",
      };
    } else {
      updateAccountSync(account.id, { status: "error" });
    }
    throw error;
  }
}
