import { randomUUID } from "node:crypto";
import { mkdirSync } from "node:fs";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";

import { accountCapabilities } from "@/lib/mail/calendar-core";
import type {
  CalendarEventDetail,
  CalendarEventSummary,
  CalendarSource,
  MailAddress,
  NormalizedMessage,
  Provider,
  PublicAccount,
  StoredAccount,
  StoredCalendarSource,
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
      user_id TEXT,
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
      user_id TEXT,
      provider TEXT NOT NULL,
      verifier TEXT NOT NULL,
      created_at INTEGER NOT NULL
    );

    CREATE TABLE IF NOT EXISTS calendar_sources (
      id TEXT PRIMARY KEY,
      account_id TEXT NOT NULL REFERENCES mail_accounts(id) ON DELETE CASCADE,
      provider_calendar_id TEXT NOT NULL,
      details_cipher TEXT NOT NULL,
      access_role TEXT NOT NULL,
      is_primary INTEGER NOT NULL DEFAULT 0,
      selected INTEGER NOT NULL DEFAULT 1,
      sync_cursor TEXT,
      window_start TEXT,
      window_end TEXT,
      status TEXT NOT NULL DEFAULT 'connected',
      last_sync_at INTEGER,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL,
      UNIQUE(account_id, provider_calendar_id)
    );

    CREATE TABLE IF NOT EXISTS calendar_events (
      id TEXT PRIMARY KEY,
      source_id TEXT NOT NULL REFERENCES calendar_sources(id) ON DELETE CASCADE,
      account_id TEXT NOT NULL REFERENCES mail_accounts(id) ON DELETE CASCADE,
      provider_event_id TEXT NOT NULL,
      payload_cipher TEXT NOT NULL,
      start_at TEXT NOT NULL,
      end_at TEXT NOT NULL,
      all_day INTEGER NOT NULL DEFAULT 0,
      status TEXT NOT NULL DEFAULT 'confirmed',
      updated_at INTEGER NOT NULL,
      UNIQUE(source_id, provider_event_id)
    );

    CREATE TABLE IF NOT EXISTS calendar_mutations (
      idempotency_key TEXT PRIMARY KEY,
      response_cipher TEXT NOT NULL,
      created_at INTEGER NOT NULL
    );

    CREATE INDEX IF NOT EXISTS idx_threads_latest
      ON mail_threads(last_message_at DESC);
    CREATE INDEX IF NOT EXISTS idx_messages_thread
      ON mail_messages(thread_id, received_at ASC);
    CREATE INDEX IF NOT EXISTS idx_calendar_events_range
      ON calendar_events(start_at, end_at);
    CREATE INDEX IF NOT EXISTS idx_calendar_events_source
      ON calendar_events(source_id, start_at);
  `);
  try {
    database.exec(
      "ALTER TABLE mail_threads ADD COLUMN archived INTEGER NOT NULL DEFAULT 0",
    );
  } catch {
    // The column already exists.
  }
  for (const statement of [
    "ALTER TABLE mail_accounts ADD COLUMN user_id TEXT",
    "ALTER TABLE oauth_states ADD COLUMN user_id TEXT",
  ]) {
    try {
      database.exec(statement);
    } catch {
      // The column already exists.
    }
  }
  database.exec(`
    CREATE INDEX IF NOT EXISTS idx_mail_accounts_user
      ON mail_accounts(user_id, created_at);
  `);
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
    userId: row.user_id ? String(row.user_id) : null,
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
  userId: string;
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
  if (existing?.user_id && String(existing.user_id) !== input.userId) {
    throw new Error("This mailbox is already connected to another Rubidium user.");
  }
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
        id, user_id, provider, provider_account_id, email, display_name, token_cipher,
        status, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, 'connected', ?, ?)
      ON CONFLICT(provider, provider_account_id) DO UPDATE SET
        user_id = excluded.user_id,
        email = excluded.email,
        display_name = excluded.display_name,
        token_cipher = excluded.token_cipher,
        status = 'connected',
        updated_at = excluded.updated_at`,
    )
    .run(
      id,
      input.userId,
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

export function getAccount(id: string, userId?: string): StoredAccount | null {
  const row = getDatabase()
    .prepare(
      `SELECT * FROM mail_accounts
       WHERE id = ? AND (? IS NULL OR user_id = ?)`,
    )
    .get(id, userId ?? null, userId ?? null) as
    | Record<string, unknown>
    | undefined;
  return row ? rowToStoredAccount(row) : null;
}

export function getAccounts(userId?: string): StoredAccount[] {
  const rows = getDatabase()
    .prepare(
      `SELECT * FROM mail_accounts
       WHERE (? IS NULL OR user_id = ?)
       ORDER BY created_at ASC`,
    )
    .all(userId ?? null, userId ?? null) as Record<string, unknown>[];
  return rows.map(rowToStoredAccount);
}

export function getPublicAccounts(userId: string): PublicAccount[] {
  return getAccounts(userId).map(
    ({ token, syncCursor: _cursor, userId: _userId, ...account }) => {
      return {
        ...account,
        capabilities: accountCapabilities(account.provider, token.scope),
      };
    },
  );
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

export function deleteAccount(id: string, userId: string) {
  getDatabase()
    .prepare("DELETE FROM mail_accounts WHERE id = ? AND user_id = ?")
    .run(id, userId);
}

export function saveOauthState(
  state: string,
  userId: string,
  provider: Provider,
  verifier: string,
) {
  const database = getDatabase();
  database
    .prepare("DELETE FROM oauth_states WHERE created_at < ?")
    .run(Date.now() - 10 * 60 * 1000);
  database
    .prepare(
      "INSERT INTO oauth_states (state, user_id, provider, verifier, created_at) VALUES (?, ?, ?, ?, ?)",
    )
    .run(state, userId, provider, verifier, Date.now());
}

export function consumeOauthState(
  state: string,
  provider: Provider,
): { verifier: string; userId: string } | null {
  const database = getDatabase();
  const row = database
    .prepare(
      "SELECT verifier, user_id, created_at FROM oauth_states WHERE state = ? AND provider = ?",
    )
    .get(state, provider) as
    | { verifier: string; user_id: string | null; created_at: number }
    | undefined;
  database.prepare("DELETE FROM oauth_states WHERE state = ?").run(state);
  if (
    !row ||
    !row.user_id ||
    row.created_at < Date.now() - 10 * 60 * 1000
  ) {
    return null;
  }
  return { verifier: row.verifier, userId: row.user_id };
}

export function countUnownedAccounts(): number {
  const row = getDatabase()
    .prepare("SELECT COUNT(*) AS count FROM mail_accounts WHERE user_id IS NULL")
    .get() as { count: number };
  return Number(row.count);
}

export function claimUnownedAccounts(userId: string): number {
  const result = getDatabase()
    .prepare(
      "UPDATE mail_accounts SET user_id = ?, updated_at = ? WHERE user_id IS NULL",
    )
    .run(userId, Date.now());
  return Number(result.changes);
}

type CalendarSourceDetails = {
  name: string;
  color: string;
  timeZone: string;
};

function calendarSourceRow(
  row: Record<string, unknown>,
): StoredCalendarSource {
  const details = decryptJson<CalendarSourceDetails>(
    String(row.details_cipher),
  );
  return {
    id: String(row.id),
    accountId: String(row.account_id),
    provider: String(row.provider) as Provider,
    accountEmail: String(row.email),
    providerCalendarId: String(row.provider_calendar_id),
    name: details.name,
    color: details.color,
    timeZone: details.timeZone,
    accessRole: String(row.access_role) as CalendarSource["accessRole"],
    primary: Number(row.is_primary) === 1,
    selected: Number(row.selected) === 1,
    syncCursor: row.sync_cursor ? String(row.sync_cursor) : null,
    windowStart: row.window_start ? String(row.window_start) : null,
    windowEnd: row.window_end ? String(row.window_end) : null,
    status: String(row.status) as CalendarSource["status"],
    lastSyncAt: row.last_sync_at ? Number(row.last_sync_at) : null,
  };
}

export function saveCalendarSource(
  account: StoredAccount,
  input: {
    providerCalendarId: string;
    name: string;
    color?: string;
    timeZone?: string;
    accessRole: CalendarSource["accessRole"];
    primary?: boolean;
  },
): StoredCalendarSource {
  const database = getDatabase();
  const existing = database
    .prepare(
      "SELECT id FROM calendar_sources WHERE account_id = ? AND provider_calendar_id = ?",
    )
    .get(account.id, input.providerCalendarId) as { id: string } | undefined;
  const id = existing?.id || randomUUID();
  const now = Date.now();
  database
    .prepare(
      `INSERT INTO calendar_sources (
        id, account_id, provider_calendar_id, details_cipher, access_role,
        is_primary, selected, status, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, 1, 'connected', ?, ?)
      ON CONFLICT(account_id, provider_calendar_id) DO UPDATE SET
        details_cipher = excluded.details_cipher,
        access_role = excluded.access_role,
        is_primary = excluded.is_primary,
        status = CASE
          WHEN calendar_sources.status = 'syncing' THEN 'syncing'
          ELSE 'connected'
        END,
        updated_at = excluded.updated_at`,
    )
    .run(
      id,
      account.id,
      input.providerCalendarId,
      encryptJson({
        name: input.name,
        color: input.color || (account.provider === "google" ? "#d94b35" : "#5278d8"),
        timeZone: input.timeZone || "UTC",
      } satisfies CalendarSourceDetails),
      input.accessRole,
      input.primary ? 1 : 0,
      now,
      now,
    );
  return getCalendarSource(id)!;
}

export function getCalendarSource(
  id: string,
  userId?: string,
): StoredCalendarSource | null {
  const row = getDatabase()
    .prepare(
      `SELECT c.*, a.provider, a.email
       FROM calendar_sources c
       JOIN mail_accounts a ON a.id = c.account_id
       WHERE c.id = ? AND (? IS NULL OR a.user_id = ?)`,
    )
    .get(id, userId ?? null, userId ?? null) as
    | Record<string, unknown>
    | undefined;
  return row ? calendarSourceRow(row) : null;
}

export function listCalendarSources(
  userId: string,
  accountId?: string,
): CalendarSource[] {
  const rows = getDatabase()
    .prepare(
      `SELECT c.*, a.provider, a.email
       FROM calendar_sources c
       JOIN mail_accounts a ON a.id = c.account_id
       WHERE a.user_id = ?
         AND (? IS NULL OR c.account_id = ?)
       ORDER BY c.is_primary DESC, c.created_at ASC`,
    )
    .all(userId, accountId ?? null, accountId ?? null) as Record<
    string,
    unknown
  >[];
  return rows.map((row) => {
    const { syncCursor: _cursor, windowStart: _start, windowEnd: _end, ...source } =
      calendarSourceRow(row);
    return source;
  });
}

export function listStoredCalendarSources(
  accountId?: string,
): StoredCalendarSource[] {
  const rows = getDatabase()
    .prepare(
      `SELECT c.*, a.provider, a.email
       FROM calendar_sources c
       JOIN mail_accounts a ON a.id = c.account_id
       WHERE (? IS NULL OR c.account_id = ?)
       ORDER BY c.is_primary DESC, c.created_at ASC`,
    )
    .all(accountId ?? null, accountId ?? null) as Record<string, unknown>[];
  return rows.map(calendarSourceRow);
}

export function updateCalendarSourceSync(
  id: string,
  input: {
    cursor?: string | null;
    windowStart?: string | null;
    windowEnd?: string | null;
    status?: CalendarSource["status"];
    markSynced?: boolean;
  },
) {
  const source = getCalendarSource(id);
  if (!source) return;
  getDatabase()
    .prepare(
      `UPDATE calendar_sources
       SET sync_cursor = ?, window_start = ?, window_end = ?, status = ?,
           last_sync_at = ?, updated_at = ?
       WHERE id = ?`,
    )
    .run(
      input.cursor === undefined ? source.syncCursor : input.cursor,
      input.windowStart === undefined ? source.windowStart : input.windowStart,
      input.windowEnd === undefined ? source.windowEnd : input.windowEnd,
      input.status ?? source.status,
      input.markSynced ? Date.now() : source.lastSyncAt,
      Date.now(),
      id,
    );
}

export function clearCalendarSourceEvents(sourceId: string) {
  getDatabase()
    .prepare("DELETE FROM calendar_events WHERE source_id = ?")
    .run(sourceId);
}

export function upsertCalendarEvent(event: CalendarEventDetail) {
  getDatabase()
    .prepare(
      `INSERT INTO calendar_events (
        id, source_id, account_id, provider_event_id, payload_cipher,
        start_at, end_at, all_day, status, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(source_id, provider_event_id) DO UPDATE SET
        payload_cipher = excluded.payload_cipher,
        start_at = excluded.start_at,
        end_at = excluded.end_at,
        all_day = excluded.all_day,
        status = excluded.status,
        updated_at = excluded.updated_at`,
    )
    .run(
      event.id,
      event.sourceId,
      event.accountId,
      event.providerEventId,
      encryptJson(event),
      event.start,
      event.end,
      event.allDay ? 1 : 0,
      event.status,
      Date.now(),
    );
}

export function deleteProviderCalendarEvent(
  sourceId: string,
  providerEventId: string,
) {
  getDatabase()
    .prepare(
      "DELETE FROM calendar_events WHERE source_id = ? AND provider_event_id = ?",
    )
    .run(sourceId, providerEventId);
}

export function deleteCalendarEvent(id: string) {
  getDatabase().prepare("DELETE FROM calendar_events WHERE id = ?").run(id);
}

export function getCalendarEvent(
  id: string,
  userId?: string,
): CalendarEventDetail | null {
  const row = getDatabase()
    .prepare(
      `SELECT e.payload_cipher
       FROM calendar_events e
       JOIN mail_accounts a ON a.id = e.account_id
       WHERE e.id = ? AND (? IS NULL OR a.user_id = ?)`,
    )
    .get(id, userId ?? null, userId ?? null) as
    | { payload_cipher: string }
    | undefined;
  return row
    ? decryptJson<CalendarEventDetail>(row.payload_cipher)
    : null;
}

export function listCalendarEvents(input: {
  userId: string;
  from: string;
  to: string;
  accountId?: string;
  sourceId?: string;
  query?: string;
}): CalendarEventSummary[] {
  const rows = getDatabase()
    .prepare(
      `SELECT e.payload_cipher
       FROM calendar_events e
       JOIN mail_accounts a ON a.id = e.account_id
       WHERE a.user_id = ?
         AND e.start_at < ? AND e.end_at > ? AND e.status != 'cancelled'
         AND (? IS NULL OR e.account_id = ?)
         AND (? IS NULL OR e.source_id = ?)
       ORDER BY e.start_at ASC, e.end_at ASC`,
    )
    .all(
      input.userId,
      input.to,
      input.from,
      input.accountId ?? null,
      input.accountId ?? null,
      input.sourceId ?? null,
      input.sourceId ?? null,
    ) as Array<{ payload_cipher: string }>;
  const query = input.query?.trim().toLocaleLowerCase();
  return rows.flatMap((row) => {
    const detail = decryptJson<CalendarEventDetail>(row.payload_cipher);
    if (
      query &&
      ![
        detail.title,
        detail.location,
        detail.description,
        detail.organizer.name,
        detail.organizer.address,
        ...detail.attendees.flatMap((attendee) => [
          attendee.name,
          attendee.address,
        ]),
      ]
        .join("\n")
        .toLocaleLowerCase()
        .includes(query)
    ) {
      return [];
    }
    const {
      description: _description,
      organizer: _organizer,
      attendees: _attendees,
      recurring: _recurring,
      htmlLink: _htmlLink,
      ...summary
    } = detail;
    return [summary];
  });
}

export function getCalendarMutation<T>(key: string): T | null {
  const row = getDatabase()
    .prepare(
      "SELECT response_cipher FROM calendar_mutations WHERE idempotency_key = ?",
    )
    .get(key) as { response_cipher: string } | undefined;
  return row ? decryptJson<T>(row.response_cipher) : null;
}

export function saveCalendarMutation(key: string, response: unknown) {
  const database = getDatabase();
  database
    .prepare("DELETE FROM calendar_mutations WHERE created_at < ?")
    .run(Date.now() - 7 * 24 * 60 * 60 * 1000);
  database
    .prepare(
      `INSERT INTO calendar_mutations (idempotency_key, response_cipher, created_at)
       VALUES (?, ?, ?)
       ON CONFLICT(idempotency_key) DO NOTHING`,
    )
    .run(key, encryptJson(response), Date.now());
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

export function listThreads(userId: string, limit = 100): ThreadSummary[] {
  const rows = getDatabase()
    .prepare(
      `SELECT t.*, a.provider, a.email, a.display_name,
        (SELECT COUNT(*) FROM mail_messages m WHERE m.thread_id = t.id) AS message_count
       FROM mail_threads t
       JOIN mail_accounts a ON a.id = t.account_id
       WHERE a.user_id = ? AND t.archived = 0
       ORDER BY t.last_message_at DESC
       LIMIT ?`,
    )
    .all(userId, Math.max(1, Math.min(limit, 500))) as Record<string, unknown>[];
  return rows.map(threadRowToSummary);
}

export function getThread(id: string, userId?: string): ThreadDetail | null {
  const row = getDatabase()
    .prepare(
      `SELECT t.*, a.provider, a.email, a.display_name,
        (SELECT COUNT(*) FROM mail_messages m WHERE m.thread_id = t.id) AS message_count
       FROM mail_threads t
       JOIN mail_accounts a ON a.id = t.account_id
       WHERE t.id = ? AND (? IS NULL OR a.user_id = ?)`,
    )
    .get(id, userId ?? null, userId ?? null) as
    | Record<string, unknown>
    | undefined;
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
