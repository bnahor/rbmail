import { randomUUID } from "node:crypto";
import { mkdirSync } from "node:fs";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";

import type {
  MailAddress,
  NormalizedMessage,
  Provider,
  PublicAccount,
  StoredAccount,
  StoredToken,
  ThreadDetail,
  ThreadSummary,
} from "@/lib/mail/types";
import { decryptJson, decryptString, encryptJson, encryptString } from "./crypto";

type DatabaseHolder = {
  rbmailDatabase?: DatabaseSync;
};

const globalDatabase = globalThis as typeof globalThis & DatabaseHolder;

function databasePath() {
  const directory = path.resolve(
    process.env.RBMAIL_DATA_DIR ?? path.join(process.cwd(), "data"),
  );
  mkdirSync(directory, { recursive: true, mode: 0o700 });
  return path.join(directory, "rbmail.sqlite");
}

function initialize(database: DatabaseSync) {
  database.exec(`
    PRAGMA journal_mode = WAL;
    PRAGMA foreign_keys = ON;
    PRAGMA busy_timeout = 5000;

    CREATE TABLE IF NOT EXISTS mail_accounts (
      id TEXT PRIMARY KEY,
      provider TEXT NOT NULL,
      provider_account_id TEXT NOT NULL,
      email TEXT NOT NULL,
      display_name TEXT NOT NULL,
      token_cipher TEXT NOT NULL,
      sync_cursor TEXT,
      status TEXT NOT NULL DEFAULT 'connected',
      last_sync_at INTEGER,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL,
      UNIQUE(provider, provider_account_id)
    );

    CREATE TABLE IF NOT EXISTS mail_threads (
      id TEXT PRIMARY KEY,
      account_id TEXT NOT NULL REFERENCES mail_accounts(id) ON DELETE CASCADE,
      provider_thread_id TEXT NOT NULL,
      subject_cipher TEXT NOT NULL,
      snippet_cipher TEXT NOT NULL,
      participants_cipher TEXT NOT NULL,
      labels_cipher TEXT NOT NULL,
      last_message_at TEXT NOT NULL,
      unread INTEGER NOT NULL DEFAULT 0,
      archived INTEGER NOT NULL DEFAULT 0,
      updated_at INTEGER NOT NULL,
      UNIQUE(account_id, provider_thread_id)
    );

    CREATE TABLE IF NOT EXISTS mail_messages (
      id TEXT PRIMARY KEY,
      thread_id TEXT NOT NULL REFERENCES mail_threads(id) ON DELETE CASCADE,
      account_id TEXT NOT NULL REFERENCES mail_accounts(id) ON DELETE CASCADE,
      provider_message_id TEXT NOT NULL,
      payload_cipher TEXT NOT NULL,
      received_at TEXT NOT NULL,
      is_read INTEGER NOT NULL DEFAULT 0,
      has_attachments INTEGER NOT NULL DEFAULT 0,
      updated_at INTEGER NOT NULL,
      UNIQUE(account_id, provider_message_id)
    );

    CREATE TABLE IF NOT EXISTS oauth_states (
      state TEXT PRIMARY KEY,
      provider TEXT NOT NULL,
      verifier TEXT NOT NULL,
      created_at INTEGER NOT NULL
    );

    CREATE INDEX IF NOT EXISTS idx_threads_latest
      ON mail_threads(last_message_at DESC);
    CREATE INDEX IF NOT EXISTS idx_messages_thread
      ON mail_messages(thread_id, received_at ASC);
  `);
  try {
    database.exec(
      "ALTER TABLE mail_threads ADD COLUMN archived INTEGER NOT NULL DEFAULT 0",
    );
  } catch {
    // The column already exists.
  }
}

export function getDatabase(): DatabaseSync {
  if (!globalDatabase.rbmailDatabase) {
    const database = new DatabaseSync(databasePath());
    initialize(database);
    globalDatabase.rbmailDatabase = database;
  }
  return globalDatabase.rbmailDatabase;
}

function rowToStoredAccount(row: Record<string, unknown>): StoredAccount {
  return {
    id: String(row.id),
    provider: String(row.provider) as Provider,
    providerAccountId: String(row.provider_account_id),
    email: String(row.email),
    displayName: String(row.display_name),
    token: decryptJson<StoredToken>(String(row.token_cipher)),
    syncCursor: row.sync_cursor ? String(row.sync_cursor) : null,
    status: String(row.status) as StoredAccount["status"],
    lastSyncAt: row.last_sync_at ? Number(row.last_sync_at) : null,
  };
}

export function saveAccount(input: {
  provider: Provider;
  providerAccountId: string;
  email: string;
  displayName: string;
  token: StoredToken;
}): StoredAccount {
  const database = getDatabase();
  const existing = database
    .prepare(
      `SELECT * FROM mail_accounts
       WHERE provider = ? AND provider_account_id = ?`,
    )
    .get(input.provider, input.providerAccountId) as
    | Record<string, unknown>
    | undefined;

  const now = Date.now();
  const id = existing ? String(existing.id) : randomUUID();
  const previousToken = existing
    ? decryptJson<StoredToken>(String(existing.token_cipher))
    : null;
  const token = {
    ...previousToken,
    ...input.token,
    refreshToken: input.token.refreshToken || previousToken?.refreshToken || "",
  };

  database
    .prepare(
      `INSERT INTO mail_accounts (
        id, provider, provider_account_id, email, display_name, token_cipher,
        status, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, 'connected', ?, ?)
      ON CONFLICT(provider, provider_account_id) DO UPDATE SET
        email = excluded.email,
        display_name = excluded.display_name,
        token_cipher = excluded.token_cipher,
        status = 'connected',
        updated_at = excluded.updated_at`,
    )
    .run(
      id,
      input.provider,
      input.providerAccountId,
      input.email,
      input.displayName,
      encryptJson(token),
      now,
      now,
    );

  return getAccount(id)!;
}

export function getAccount(id: string): StoredAccount | null {
  const row = getDatabase()
    .prepare("SELECT * FROM mail_accounts WHERE id = ?")
    .get(id) as Record<string, unknown> | undefined;
  return row ? rowToStoredAccount(row) : null;
}

export function getAccounts(): StoredAccount[] {
  const rows = getDatabase()
    .prepare("SELECT * FROM mail_accounts ORDER BY created_at ASC")
    .all() as Record<string, unknown>[];
  return rows.map(rowToStoredAccount);
}

export function getPublicAccounts(): PublicAccount[] {
  return getAccounts().map(({ token: _token, syncCursor: _cursor, ...account }) => account);
}

export function updateAccountToken(id: string, token: StoredToken) {
  getDatabase()
    .prepare(
      "UPDATE mail_accounts SET token_cipher = ?, updated_at = ? WHERE id = ?",
    )
    .run(encryptJson(token), Date.now(), id);
}

export function updateAccountSync(
  id: string,
  input: {
    cursor?: string | null;
    status?: StoredAccount["status"];
    markSynced?: boolean;
  },
) {
  const account = getAccount(id);
  if (!account) return;
  getDatabase()
    .prepare(
      `UPDATE mail_accounts
       SET sync_cursor = ?, status = ?, last_sync_at = ?, updated_at = ?
       WHERE id = ?`,
    )
    .run(
      input.cursor === undefined ? account.syncCursor : input.cursor,
      input.status ?? account.status,
      input.markSynced ? Date.now() : account.lastSyncAt,
      Date.now(),
      id,
    );
}

export function deleteAccount(id: string) {
  getDatabase().prepare("DELETE FROM mail_accounts WHERE id = ?").run(id);
}

export function saveOauthState(
  state: string,
  provider: Provider,
  verifier: string,
) {
  const database = getDatabase();
  database
    .prepare("DELETE FROM oauth_states WHERE created_at < ?")
    .run(Date.now() - 10 * 60 * 1000);
  database
    .prepare(
      "INSERT INTO oauth_states (state, provider, verifier, created_at) VALUES (?, ?, ?, ?)",
    )
    .run(state, provider, verifier, Date.now());
}

export function consumeOauthState(
  state: string,
  provider: Provider,
): string | null {
  const database = getDatabase();
  const row = database
    .prepare(
      "SELECT verifier, created_at FROM oauth_states WHERE state = ? AND provider = ?",
    )
    .get(state, provider) as
    | { verifier: string; created_at: number }
    | undefined;
  database.prepare("DELETE FROM oauth_states WHERE state = ?").run(state);
  if (!row || row.created_at < Date.now() - 10 * 60 * 1000) return null;
  return row.verifier;
}

export function upsertMessage(account: StoredAccount, message: NormalizedMessage) {
  const database = getDatabase();
  const threadId = `${account.id}:${message.providerThreadId}`;
  const messageId = `${account.id}:${message.providerId}`;
  const participants = [message.from, ...message.to].filter(
    (address, index, all) =>
      all.findIndex((candidate) => candidate.address === address.address) === index,
  );
  const now = Date.now();

  database
    .prepare(
      `INSERT INTO mail_threads (
        id, account_id, provider_thread_id, subject_cipher, snippet_cipher,
        participants_cipher, labels_cipher, last_message_at, unread, archived, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(account_id, provider_thread_id) DO UPDATE SET
        subject_cipher = CASE
          WHEN excluded.last_message_at >= mail_threads.last_message_at
          THEN excluded.subject_cipher ELSE mail_threads.subject_cipher END,
        snippet_cipher = CASE
          WHEN excluded.last_message_at >= mail_threads.last_message_at
          THEN excluded.snippet_cipher ELSE mail_threads.snippet_cipher END,
        participants_cipher = excluded.participants_cipher,
        labels_cipher = excluded.labels_cipher,
        last_message_at = MAX(mail_threads.last_message_at, excluded.last_message_at),
        unread = MAX(mail_threads.unread, excluded.unread),
        archived = CASE
          WHEN excluded.archived = 0 THEN 0 ELSE mail_threads.archived END,
        updated_at = excluded.updated_at`,
    )
    .run(
      threadId,
      account.id,
      message.providerThreadId,
      encryptString(message.subject),
      encryptString(message.snippet),
      encryptJson(participants),
      encryptJson(message.labels),
      message.receivedAt,
      message.isRead ? 0 : 1,
      message.labels.includes("INBOX") || message.folder === "inbox" ? 0 : 1,
      now,
    );

  database
    .prepare(
      `INSERT INTO mail_messages (
        id, thread_id, account_id, provider_message_id, payload_cipher,
        received_at, is_read, has_attachments, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(account_id, provider_message_id) DO UPDATE SET
        thread_id = excluded.thread_id,
        payload_cipher = excluded.payload_cipher,
        received_at = excluded.received_at,
        is_read = excluded.is_read,
        has_attachments = excluded.has_attachments,
        updated_at = excluded.updated_at`,
    )
    .run(
      messageId,
      threadId,
      account.id,
      message.providerId,
      encryptJson(message),
      message.receivedAt,
      message.isRead ? 1 : 0,
      message.hasAttachments ? 1 : 0,
      now,
    );

  const unread = database
    .prepare(
      "SELECT COUNT(*) AS count FROM mail_messages WHERE thread_id = ? AND is_read = 0",
    )
    .get(threadId) as { count: number };
  database
    .prepare("UPDATE mail_threads SET unread = ? WHERE id = ?")
    .run(unread.count > 0 ? 1 : 0, threadId);
}

export function deleteProviderMessage(accountId: string, providerMessageId: string) {
  const database = getDatabase();
  const row = database
    .prepare(
      "SELECT thread_id FROM mail_messages WHERE account_id = ? AND provider_message_id = ?",
    )
    .get(accountId, providerMessageId) as { thread_id: string } | undefined;
  if (!row) return;
  database
    .prepare(
      "DELETE FROM mail_messages WHERE account_id = ? AND provider_message_id = ?",
    )
    .run(accountId, providerMessageId);
  const remaining = database
    .prepare("SELECT COUNT(*) AS count FROM mail_messages WHERE thread_id = ?")
    .get(row.thread_id) as { count: number };
  if (remaining.count === 0) {
    database.prepare("DELETE FROM mail_threads WHERE id = ?").run(row.thread_id);
  }
}

export function markThreadRead(id: string, read: boolean) {
  const database = getDatabase();
  database
    .prepare("UPDATE mail_threads SET unread = ?, updated_at = ? WHERE id = ?")
    .run(read ? 0 : 1, Date.now(), id);
  database
    .prepare("UPDATE mail_messages SET is_read = ?, updated_at = ? WHERE thread_id = ?")
    .run(read ? 1 : 0, Date.now(), id);
}

export function setThreadArchived(id: string, archived: boolean) {
  getDatabase()
    .prepare("UPDATE mail_threads SET archived = ?, updated_at = ? WHERE id = ?")
    .run(archived ? 1 : 0, Date.now(), id);
}

function threadRowToSummary(row: Record<string, unknown>): ThreadSummary {
  return {
    id: String(row.id),
    accountId: String(row.account_id),
    provider: String(row.provider) as Provider,
    providerThreadId: String(row.provider_thread_id),
    email: String(row.email),
    displayName: String(row.display_name),
    subject: decryptString(String(row.subject_cipher)),
    snippet: decryptString(String(row.snippet_cipher)),
    participants: decryptJson<MailAddress[]>(String(row.participants_cipher)),
    labels: decryptJson<string[]>(String(row.labels_cipher)),
    lastMessageAt: String(row.last_message_at),
    unread: Number(row.unread) === 1,
    messageCount: Number(row.message_count),
  };
}

export function listThreads(limit = 100): ThreadSummary[] {
  const rows = getDatabase()
    .prepare(
      `SELECT t.*, a.provider, a.email, a.display_name,
        (SELECT COUNT(*) FROM mail_messages m WHERE m.thread_id = t.id) AS message_count
       FROM mail_threads t
       JOIN mail_accounts a ON a.id = t.account_id
       WHERE t.archived = 0
       ORDER BY t.last_message_at DESC
       LIMIT ?`,
    )
    .all(Math.max(1, Math.min(limit, 500))) as Record<string, unknown>[];
  return rows.map(threadRowToSummary);
}

export function getThread(id: string): ThreadDetail | null {
  const row = getDatabase()
    .prepare(
      `SELECT t.*, a.provider, a.email, a.display_name,
        (SELECT COUNT(*) FROM mail_messages m WHERE m.thread_id = t.id) AS message_count
       FROM mail_threads t
       JOIN mail_accounts a ON a.id = t.account_id
       WHERE t.id = ?`,
    )
    .get(id) as Record<string, unknown> | undefined;
  if (!row) return null;

  const messages = getDatabase()
    .prepare(
      "SELECT payload_cipher FROM mail_messages WHERE thread_id = ? ORDER BY received_at ASC",
    )
    .all(id) as Array<{ payload_cipher: string }>;
  return {
    ...threadRowToSummary(row),
    messages: messages.map((message) =>
      decryptJson<NormalizedMessage>(message.payload_cipher),
    ),
  };
}
