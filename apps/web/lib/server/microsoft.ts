import type {
  ComposeMessageInput,
  MailAddress,
  MailAttachment,
  Mailbox,
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
  normalizeContentId,
  sanitizeEmailHtml,
  stripHtml,
} from "@/lib/server/mail-utils";
import { refreshMicrosoftToken } from "@/lib/server/oauth";
import { notifyNewMail } from "@/lib/server/apns";

const folders = ["inbox", "sentitems", "drafts", "archive", "junkemail", "deleteditems"];

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
  flag?: { flagStatus?: string };
  internetMessageId?: string;
  replyTo?: GraphAddress[];
  bccRecipients?: GraphAddress[];
  parentFolderId?: string;
  internetMessageHeaders?: Array<{ name?: string; value?: string }>;
  "@removed"?: { reason?: string };
};

type GraphAttachment = {
  id: string;
  name?: string;
  contentType?: string;
  size?: number;
  isInline?: boolean;
  contentId?: string;
  contentBytes?: string;
  "@odata.type"?: string;
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

export async function changeMicrosoftMessages(
  account: StoredAccount,
  providerMessageIds: string[],
  action:
    | "read"
    | "unread"
    | "flag"
    | "unflag"
    | "archive"
    | "trash"
    | "restore"
    | "junk"
    | "not_junk",
) {
  const destination =
    action === "archive"
      ? "archive"
      : action === "trash"
        ? "deleteditems"
        : action === "restore" || action === "not_junk"
          ? "inbox"
          : action === "junk"
            ? "junkemail"
            : null;
  await Promise.all(
    providerMessageIds.map(async (id) => {
      const path = `/me/messages/${encodeURIComponent(id)}`;
      if (destination) {
        await graphFetch(account, `${path}/move`, {
          method: "POST",
          body: JSON.stringify({ destinationId: destination }),
        });
        return;
      }
      await graphFetch(account, path, {
        method: "PATCH",
        body: JSON.stringify(
          action === "read" || action === "unread"
            ? { isRead: action === "read" }
            : {
                flag: {
                  flagStatus: action === "flag" ? "flagged" : "notFlagged",
                },
              },
        ),
      });
    }),
  );
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

function graphRecipient(value: MailAddress) {
  return {
    emailAddress: {
      address: value.address,
      ...(value.name ? { name: value.name } : {}),
    },
  };
}

export async function sendRichWithMicrosoft(
  account: StoredAccount,
  input: ComposeMessageInput,
) {
  const attachments = (input.attachments ?? []).map((attachment) => ({
    "@odata.type": "#microsoft.graph.fileAttachment",
    name: attachment.filename,
    contentType: attachment.mimeType,
    contentBytes: attachment.contentBase64.replace(/\s+/g, ""),
    isInline: Boolean(attachment.inline),
    ...(attachment.contentId ? { contentId: attachment.contentId } : {}),
  }));
  const message = {
    subject: input.subject,
    body: {
      contentType: input.bodyHtml ? "HTML" : "Text",
      content: input.bodyHtml || input.bodyText,
    },
    toRecipients: input.recipients.to.map(graphRecipient),
    ccRecipients: input.recipients.cc.map(graphRecipient),
    bccRecipients: input.recipients.bcc.map(graphRecipient),
  };
  if (input.replyMode && input.replyToMessageId) {
    const operation = input.replyMode === "replyAll"
      ? "createReplyAll"
      : input.replyMode === "forward"
        ? "createForward"
        : "createReply";
    const draft = await graphFetch<{ id: string }>(
      account,
      `/me/messages/${encodeURIComponent(input.replyToMessageId)}/${operation}`,
      { method: "POST", body: "{}" },
    );
    await graphFetch(account, `/me/messages/${encodeURIComponent(draft.id)}`, {
      method: "PATCH",
      body: JSON.stringify(message),
    });
    for (const attachment of attachments) {
      await graphFetch(
        account,
        `/me/messages/${encodeURIComponent(draft.id)}/attachments`,
        { method: "POST", body: JSON.stringify(attachment) },
      );
    }
    await graphFetch(account, `/me/messages/${encodeURIComponent(draft.id)}/send`, {
      method: "POST",
      body: "{}",
    });
    return;
  }
  await graphFetch(account, "/me/sendMail", {
    method: "POST",
    body: JSON.stringify({
      message: { ...message, attachments },
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
  attachments: MailAttachment[] = [],
): NormalizedMessage {
  const content = message.body?.content || "";
  const isHtml = message.body?.contentType?.toLowerCase() === "html";
  const html = isHtml ? sanitizeEmailHtml(content) : null;
  const bodyText = cleanText(isHtml ? stripHtml(html || "") : content);
  const internetHeader = (name: string) =>
    message.internetMessageHeaders?.find(
      (candidate) => candidate.name?.toLowerCase() === name.toLowerCase(),
    )?.value;
  return {
    id: message.id,
    providerId: message.id,
    providerThreadId: message.conversationId || message.id,
    subject: message.subject || "(no subject)",
    snippet: cleanText(message.bodyPreview || bodyText.slice(0, 240)),
    bodyText,
    bodyHtml: html,
    from: address(message.from),
    to: (message.toRecipients ?? []).map(address),
    cc: (message.ccRecipients ?? []).map(address),
    bcc: (message.bccRecipients ?? []).map(address),
    receivedAt:
      message.receivedDateTime ||
      message.sentDateTime ||
      new Date().toISOString(),
    isRead: Boolean(message.isRead),
    flagged: message.flag?.flagStatus === "flagged",
    hasAttachments: Boolean(message.hasAttachments || attachments.length),
    attachments,
    headers: {
      messageId: message.internetMessageId || null,
      inReplyTo: internetHeader("In-Reply-To") || null,
      references: (internetHeader("References") || "")
        .split(/\s+/)
        .map((value) => value.trim())
        .filter(Boolean),
      replyTo: (message.replyTo ?? []).map(address),
      listUnsubscribe: internetHeader("List-Unsubscribe") || null,
    },
    mimeTree: null,
    labels: message.categories ?? [],
    folder,
  };
}

async function listGraphAttachments(
  account: StoredAccount,
  message: GraphMessage,
): Promise<MailAttachment[]> {
  if (!message.hasAttachments) return [];
  const page = await graphFetch<{ value?: GraphAttachment[] }>(
    account,
    `/me/messages/${encodeURIComponent(message.id)}/attachments?$select=id,name,contentType,size,isInline,contentId`,
  );
  return (page.value ?? []).map((attachment) => ({
    id: attachment.id,
    providerAttachmentId: attachment.id,
    filename: attachment.name || "attachment",
    mimeType: attachment.contentType || "application/octet-stream",
    size: Number(attachment.size || 0),
    contentId: normalizeContentId(attachment.contentId),
    disposition: attachment.isInline ? "inline" : "attachment",
    inline: Boolean(attachment.isInline),
  }));
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
    "flag",
    "internetMessageId",
    "replyTo",
    "bccRecipients",
    "parentFolderId",
    "internetMessageHeaders",
  ].join(",");
  const startUrl =
    cursor.links[folder] ||
    `/me/mailFolders/${folder}/messages/delta?$select=${encodeURIComponent(select)}&$top=100`;
  const shouldNotify = Boolean(cursor.links[folder]) && folder === "inbox";

  try {
    const page = await graphFetch<{
      value: GraphMessage[];
      "@odata.nextLink"?: string;
      "@odata.deltaLink"?: string;
    }>(account, startUrl);
    let processed = 0;
    for (const message of page.value) {
      if (message["@removed"]) {
        deleteProviderMessage(account.id, message.id);
      } else {
        const attachments = await listGraphAttachments(account, message);
        const normalized = normalizeGraphMessage(message, folder, attachments);
        upsertMessage(account, normalized);
        if (shouldNotify) {
          await notifyNewMail(account, normalized).catch(() => []);
        }
        processed += 1;
      }
    }

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

export async function downloadMicrosoftAttachment(
  account: StoredAccount,
  providerMessageId: string,
  providerAttachmentId: string,
): Promise<Buffer> {
  const attachment = await graphFetch<GraphAttachment>(
    account,
    `/me/messages/${encodeURIComponent(providerMessageId)}/attachments/${encodeURIComponent(providerAttachmentId)}`,
  );
  return Buffer.from(attachment.contentBytes || "", "base64");
}

export async function listMicrosoftMailboxes(account: StoredAccount): Promise<Mailbox[]> {
  const result = await graphFetch<{
    value?: Array<{
      id: string;
      displayName?: string;
      unreadItemCount?: number;
      wellKnownName?: string;
      isHidden?: boolean;
    }>;
  }>(account, "/me/mailFolders?$top=100&includeHiddenFolders=false");
  const kind = (folder: { displayName?: string; wellKnownName?: string }): Mailbox["kind"] => {
    const value = `${folder.wellKnownName || ""} ${folder.displayName || ""}`.toLowerCase();
    if (value.includes("inbox")) return "inbox";
    if (value.includes("sent")) return "sent";
    if (value.includes("draft")) return "drafts";
    if (value.includes("archive")) return "archive";
    if (value.includes("junk")) return "junk";
    if (value.includes("deleted") || value.includes("trash")) return "trash";
    return "folder";
  };
  return (result.value ?? [])
    .filter((folder) => !folder.isHidden)
    .map((folder) => ({
      id: folder.id,
      accountId: account.id,
      provider: "microsoft",
      name: folder.displayName || "Mailbox",
      kind: kind(folder),
      unreadCount: Number(folder.unreadItemCount || 0),
      system: kind(folder) !== "folder",
    }));
}

export async function createMicrosoftMailSubscription(
  account: StoredAccount,
  notificationUrl: string,
  clientState: string,
) {
  const expirationDateTime = new Date(Date.now() + 48 * 60 * 60 * 1000).toISOString();
  return graphFetch<{ id: string; resource: string; expirationDateTime: string }>(
    account,
    "/subscriptions",
    {
      method: "POST",
      body: JSON.stringify({
        changeType: "created,updated,deleted",
        notificationUrl,
        resource: "/me/mailFolders('inbox')/messages",
        expirationDateTime,
        clientState,
        latestSupportedTlsVersion: "v1_2",
      }),
    },
  );
}
