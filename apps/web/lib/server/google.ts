import type {
  ComposeMessageInput,
  MailAttachment,
  Mailbox,
  MIMEPart,
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
  normalizeContentId,
  parseAddress,
  parseAddressList,
  safeMailHeader,
  sanitizeEmailHtml,
  stripHtml,
} from "@/lib/server/mail-utils";
import { refreshGoogleToken } from "@/lib/server/oauth";
import { notifyNewMail } from "@/lib/server/apns";

type GmailPart = {
  partId?: string;
  mimeType?: string;
  filename?: string;
  headers?: Array<{ name: string; value: string }>;
  body?: { data?: string; attachmentId?: string; size?: number };
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

export async function changeGoogleThread(
  account: StoredAccount,
  providerThreadId: string,
  action:
    | "read"
    | "unread"
    | "flag"
    | "unflag"
    | "archive"
    | "junk"
    | "not_junk",
) {
  const addLabelIds: string[] = [];
  const removeLabelIds: string[] = [];
  if (action === "read") removeLabelIds.push("UNREAD");
  if (action === "unread") addLabelIds.push("UNREAD");
  if (action === "flag") addLabelIds.push("STARRED");
  if (action === "unflag") removeLabelIds.push("STARRED");
  if (action === "archive") removeLabelIds.push("INBOX");
  if (action === "junk") addLabelIds.push("SPAM");
  if (action === "junk") removeLabelIds.push("INBOX");
  if (action === "not_junk") removeLabelIds.push("SPAM");
  if (action === "not_junk") addLabelIds.push("INBOX");
  await gmailFetch(
    account,
    `/users/me/threads/${encodeURIComponent(providerThreadId)}/modify`,
    { method: "POST", body: JSON.stringify({ addLabelIds, removeLabelIds }) },
  );
}

export async function trashGoogleThread(
  account: StoredAccount,
  providerThreadId: string,
  restore = false,
) {
  await gmailFetch(
    account,
    `/users/me/threads/${encodeURIComponent(providerThreadId)}/${restore ? "untrash" : "trash"}`,
    { method: "POST", body: "{}" },
  );
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
    `From: ${safeMailHeader(account.email)}`,
    `To: ${safeMailHeader(input.to)}`,
    `Subject: ${safeMailHeader(subject)}`,
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
    `From: ${safeMailHeader(account.email)}`,
    `To: ${safeMailHeader(input.to)}`,
    `Subject: ${safeMailHeader(input.subject)}`,
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

function encodedWord(value: string) {
  return `=?UTF-8?B?${Buffer.from(value, "utf8").toString("base64")}?=`;
}

function addressHeader(values: ComposeMessageInput["recipients"]["to"]) {
  return values
    .map((value) =>
      value.name && value.name.toLowerCase() !== value.address.toLowerCase()
        ? `${encodedWord(value.name)} <${safeMailHeader(value.address)}>`
        : safeMailHeader(value.address),
    )
    .join(", ");
}

function buildGoogleMIME(input: ComposeMessageInput, from: string) {
  const mixedBoundary = `rubidium-mixed-${crypto.randomUUID()}`;
  const alternativeBoundary = `rubidium-alt-${crypto.randomUUID()}`;
  const headers = [
    `From: ${safeMailHeader(from)}`,
    `To: ${addressHeader(input.recipients.to)}`,
    ...(input.recipients.cc.length ? [`Cc: ${addressHeader(input.recipients.cc)}`] : []),
    ...(input.recipients.bcc.length ? [`Bcc: ${addressHeader(input.recipients.bcc)}`] : []),
    `Subject: ${encodedWord(input.subject)}`,
    ...(input.inReplyTo ? [`In-Reply-To: ${safeMailHeader(input.inReplyTo)}`] : []),
    ...(input.references?.length ? [`References: ${input.references.map(safeMailHeader).join(" ")}`] : []),
    "MIME-Version: 1.0",
    `Content-Type: multipart/mixed; boundary=\"${mixedBoundary}\"`,
    "",
    `--${mixedBoundary}`,
    `Content-Type: multipart/alternative; boundary=\"${alternativeBoundary}\"`,
    "",
    `--${alternativeBoundary}`,
    'Content-Type: text/plain; charset="UTF-8"',
    "Content-Transfer-Encoding: base64",
    "",
    Buffer.from(input.bodyText, "utf8").toString("base64"),
    `--${alternativeBoundary}`,
    'Content-Type: text/html; charset="UTF-8"',
    "Content-Transfer-Encoding: base64",
    "",
    Buffer.from(input.bodyHtml || `<p>${input.bodyText.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/\n/g, "<br>")}</p>`, "utf8").toString("base64"),
    `--${alternativeBoundary}--`,
  ];
  for (const attachment of input.attachments ?? []) {
    headers.push(
      `--${mixedBoundary}`,
      `Content-Type: ${safeMailHeader(attachment.mimeType)}; name=\"${encodedWord(attachment.filename)}\"`,
      "Content-Transfer-Encoding: base64",
      `Content-Disposition: ${attachment.inline ? "inline" : "attachment"}; filename=\"${encodedWord(attachment.filename)}\"`,
      ...(attachment.contentId ? [`Content-ID: <${safeMailHeader(attachment.contentId)}>`] : []),
      "",
      attachment.contentBase64.replace(/\s+/g, ""),
    );
  }
  headers.push(`--${mixedBoundary}--`, "");
  return headers.join("\r\n");
}

export async function sendRichWithGoogle(
  account: StoredAccount,
  input: ComposeMessageInput,
) {
  const raw = buildGoogleMIME(input, account.email);
  await gmailFetch(account, "/users/me/messages/send", {
    method: "POST",
    body: JSON.stringify({
      ...(input.threadId && input.replyMode !== "forward" ? { threadId: input.threadId } : {}),
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
  attachments: MailAttachment[];
  mimeTree: MIMEPart | null;
} {
  const result = {
    plain: [] as string[],
    html: [] as string[],
    attachments: [] as MailAttachment[],
    mimeTree: null as MIMEPart | null,
  };
  const partCharset = (candidate: GmailPart | undefined) =>
    header(candidate, "Content-Type")
      ?.match(/\bcharset\s*=\s*(?:"([^"]+)"|'([^']+)'|([^;\s]+))/i)
      ?.slice(1)
      .find(Boolean) || "utf-8";
  function visit(candidate: GmailPart | undefined, path: string): MIMEPart | null {
    if (!candidate) return null;
    const contentId = normalizeContentId(header(candidate, "Content-ID"));
    const dispositionHeader = header(candidate, "Content-Disposition")?.toLowerCase() || "";
    const filename = candidate.filename || "";
    const attachmentId = candidate.body?.attachmentId || "";
    const isBody = candidate.mimeType === "text/plain" || candidate.mimeType === "text/html";
    const isAttachment = Boolean(filename || attachmentId || (contentId && !isBody));
    const charset = partCharset(candidate);
    const transferEncoding = header(candidate, "Content-Transfer-Encoding") || null;
    const data = decodeBase64Url(candidate.body?.data, charset);
    if (data && candidate.mimeType === "text/plain") result.plain.push(data);
    if (data && candidate.mimeType === "text/html") result.html.push(data);
    if (isAttachment) {
      const inline = dispositionHeader.includes("inline") || Boolean(contentId);
      result.attachments.push({
        id: candidate.partId || path,
        providerAttachmentId: attachmentId || candidate.partId || path,
        filename: filename || (inline ? "inline-image" : "attachment"),
        mimeType: candidate.mimeType || "application/octet-stream",
        size: Number(candidate.body?.size || 0),
        contentId,
        disposition: inline ? "inline" : "attachment",
        inline,
        ...(candidate.body?.data
          ? {
              contentBase64: Buffer.from(
                candidate.body.data.replace(/-/g, "+").replace(/_/g, "/"),
                "base64",
              ).toString("base64"),
            }
          : {}),
      });
    }
    const children = (candidate.parts ?? [])
      .map((child, index) => visit(child, `${path}.${index}`))
      .filter((child): child is MIMEPart => Boolean(child));
    return {
      id: candidate.partId || path,
      mimeType: candidate.mimeType || "application/octet-stream",
      filename,
      disposition: isAttachment
        ? dispositionHeader.includes("inline") || contentId
          ? "inline"
          : "attachment"
        : null,
      contentId,
      size: Number(candidate.body?.size || 0),
      providerAttachmentId: attachmentId || null,
      charset: charset || null,
      transferEncoding,
      children,
    };
  }
  result.mimeTree = visit(part, "0");
  return result;
}

function normalizeGmailMessage(message: GmailMessage): NormalizedMessage {
  const bodies = collectBodies(message.payload);
  const rawHtml = bodies.html.join("\n");
  const html = rawHtml ? sanitizeEmailHtml(rawHtml) : "";
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
    bcc: parseAddressList(header(message.payload, "Bcc")),
    receivedAt,
    isRead: !message.labelIds?.includes("UNREAD"),
    flagged: Boolean(message.labelIds?.includes("STARRED")),
    hasAttachments: bodies.attachments.length > 0,
    attachments: bodies.attachments,
    headers: {
      messageId: header(message.payload, "Message-ID") || null,
      inReplyTo: header(message.payload, "In-Reply-To") || null,
      references: (header(message.payload, "References") || "").split(/\s+/).filter(Boolean),
      replyTo: parseAddressList(header(message.payload, "Reply-To")),
      listUnsubscribe: header(message.payload, "List-Unsubscribe") || null,
    },
    mimeTree: bodies.mimeTree,
    labels: message.labelIds ?? [],
  };
}

export async function downloadGoogleAttachment(
  account: StoredAccount,
  providerMessageId: string,
  providerAttachmentId: string,
): Promise<Buffer> {
  const result = await gmailFetch<{ data?: string }>(
    account,
    `/users/me/messages/${encodeURIComponent(providerMessageId)}/attachments/${encodeURIComponent(providerAttachmentId)}`,
  );
  return Buffer.from((result.data || "").replace(/-/g, "+").replace(/_/g, "/"), "base64");
}

export async function listGoogleMailboxes(account: StoredAccount): Promise<Mailbox[]> {
  const result = await gmailFetch<{
    labels?: Array<{
      id: string;
      name?: string;
      type?: string;
      messagesUnread?: number;
    }>;
  }>(account, "/users/me/labels");
  const kinds: Record<string, Mailbox["kind"]> = {
    INBOX: "inbox",
    SENT: "sent",
    DRAFT: "drafts",
    SPAM: "junk",
    TRASH: "trash",
  };
  return (result.labels ?? [])
    .filter((label) => !["UNREAD", "STARRED", "IMPORTANT", "CHAT"].includes(label.id))
    .map((label) => ({
      id: label.id,
      accountId: account.id,
      provider: "google",
      name: label.name || label.id,
      kind: kinds[label.id] || "label",
      unreadCount: Number(label.messagesUnread || 0),
      system: label.type === "system",
    }));
}

export async function watchGoogleInbox(account: StoredAccount, topicName: string) {
  return gmailFetch<{ historyId: string; expiration: string }>(account, "/users/me/watch", {
    method: "POST",
    body: JSON.stringify({ topicName, labelIds: ["INBOX"], labelFilterBehavior: "include" }),
  });
}

async function fetchAndStore(
  account: StoredAccount,
  ids: string[],
  notify = false,
) {
  let processed = 0;
  for (let index = 0; index < ids.length; index += 20) {
    const batch = ids.slice(index, index + 20);
    const messages = await Promise.all(
      batch.map((id) =>
        gmailFetch<GmailMessage>(
          account,
          `/users/me/messages/${encodeURIComponent(id)}?format=full`,
        ),
      ),
    );
    for (const message of messages) {
      const normalized = normalizeGmailMessage(message);
      upsertMessage(account, normalized);
      if (notify && normalized.labels.includes("INBOX")) {
        await notifyNewMail(account, normalized).catch(() => []);
      }
      processed += 1;
    }
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
    const processed = await fetchAndStore(account, [...touched], true);
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
