import { createHash, randomUUID } from "node:crypto";
import { mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";

import {
  accountCapabilities,
  GOOGLE_SCOPES,
  MICROSOFT_SCOPES,
} from "@/lib/mail/calendar-core";
import type {
  CalendarEventDetail,
  CalendarEventSummary,
  CalendarSource,
  ComposeMessageInput,
  Draft,
  MailAddress,
  MailAttachment,
  MailAction,
  NotificationPreferences,
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
import { applyCompatibilityMigrations } from "./db-migrations";

type DatabaseHolder = {
  rbmailDatabase?: DatabaseSync;
};

const globalDatabase = globalThis as typeof globalThis & DatabaseHolder;

function databasePath() {
  const directory =
    process.env.NEXT_PHASE === "phase-production-build"
      ? path.join(tmpdir(), `rbmail-build-${process.pid}`)
      : path.resolve(
          process.env.RBMAIL_DATA_DIR ?? path.join(process.cwd(), "data"),
        );
  mkdirSync(directory, { recursive: true, mode: 0o700 });
  return path.join(directory, "rbmail.sqlite");
}

export function initializeDatabase(database: DatabaseSync) {
  database.exec(`
    PRAGMA journal_mode = WAL;
    PRAGMA foreign_keys = ON;
    PRAGMA busy_timeout = 5000;
  `);

  database.exec("BEGIN IMMEDIATE");
  try {
    database.exec(`

    CREATE TABLE IF NOT EXISTS mail_accounts (
      id TEXT PRIMARY KEY,
      user_id TEXT,
      provider TEXT NOT NULL,
      provider_account_id TEXT NOT NULL,
      email TEXT NOT NULL,
      display_name TEXT NOT NULL,
      auth_backend TEXT NOT NULL DEFAULT 'direct',
      connected_account_id TEXT,
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
      flagged INTEGER NOT NULL DEFAULT 0,
      snoozed_until TEXT,
      muted INTEGER NOT NULL DEFAULT 0,
      vip INTEGER NOT NULL DEFAULT 0,
      mailbox_kind TEXT NOT NULL DEFAULT 'inbox',
      sync_version INTEGER NOT NULL DEFAULT 1,
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

    CREATE TABLE IF NOT EXISTS mail_attachments (
      id TEXT PRIMARY KEY,
      message_id TEXT NOT NULL REFERENCES mail_messages(id) ON DELETE CASCADE,
      account_id TEXT NOT NULL REFERENCES mail_accounts(id) ON DELETE CASCADE,
      provider_attachment_id TEXT NOT NULL,
      metadata_cipher TEXT NOT NULL,
      content_id TEXT,
      inline INTEGER NOT NULL DEFAULT 0,
      byte_size INTEGER NOT NULL DEFAULT 0,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL,
      UNIQUE(message_id, provider_attachment_id)
    );

    CREATE TABLE IF NOT EXISTS mail_drafts (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL,
      account_id TEXT NOT NULL REFERENCES mail_accounts(id) ON DELETE CASCADE,
      payload_cipher TEXT NOT NULL,
      state TEXT NOT NULL DEFAULT 'draft',
      error_cipher TEXT,
      send_at INTEGER,
      idempotency_key TEXT,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL,
      UNIQUE(idempotency_key)
    );

    CREATE TABLE IF NOT EXISTS mail_mutations (
      idempotency_key TEXT PRIMARY KEY,
      user_id TEXT NOT NULL,
      response_cipher TEXT NOT NULL,
      created_at INTEGER NOT NULL
    );

    CREATE TABLE IF NOT EXISTS mail_rules (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL,
      payload_cipher TEXT NOT NULL,
      enabled INTEGER NOT NULL DEFAULT 1,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL
    );

    CREATE TABLE IF NOT EXISTS native_devices (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL,
      token_hash TEXT NOT NULL UNIQUE,
      token_cipher TEXT NOT NULL,
      environment TEXT NOT NULL,
      locale TEXT NOT NULL DEFAULT 'en',
      active INTEGER NOT NULL DEFAULT 1,
      last_seen_at INTEGER NOT NULL,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL
    );

    CREATE TABLE IF NOT EXISTS notification_preferences (
      user_id TEXT PRIMARY KEY,
      payload_cipher TEXT NOT NULL,
      updated_at INTEGER NOT NULL
    );

    CREATE TABLE IF NOT EXISTS provider_subscriptions (
      id TEXT PRIMARY KEY,
      account_id TEXT NOT NULL REFERENCES mail_accounts(id) ON DELETE CASCADE,
      provider TEXT NOT NULL,
      resource TEXT NOT NULL,
      details_cipher TEXT NOT NULL,
      expires_at INTEGER,
      updated_at INTEGER NOT NULL,
      UNIQUE(account_id, resource)
    );

    CREATE TABLE IF NOT EXISTS notification_deliveries (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL,
      account_id TEXT NOT NULL,
      provider_message_id TEXT NOT NULL,
      delivered_at INTEGER NOT NULL,
      UNIQUE(user_id, account_id, provider_message_id)
    );

    CREATE TABLE IF NOT EXISTS oauth_states (
      state TEXT PRIMARY KEY,
      user_id TEXT,
      provider TEXT NOT NULL,
      verifier TEXT NOT NULL,
      native INTEGER NOT NULL DEFAULT 0,
      created_at INTEGER NOT NULL
    );

    CREATE TABLE IF NOT EXISTS composio_states (
      state TEXT PRIMARY KEY,
      user_id TEXT NOT NULL,
      provider TEXT NOT NULL,
      connected_account_id TEXT NOT NULL,
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
    CREATE INDEX IF NOT EXISTS idx_attachments_message
      ON mail_attachments(message_id);
    CREATE INDEX IF NOT EXISTS idx_drafts_user
      ON mail_drafts(user_id, updated_at DESC);
    CREATE INDEX IF NOT EXISTS idx_calendar_events_range
      ON calendar_events(start_at, end_at);
    CREATE INDEX IF NOT EXISTS idx_calendar_events_source
      ON calendar_events(source_id, start_at);
    `);

    applyCompatibilityMigrations(database);
    database.exec("COMMIT");
  } catch (error) {
    database.exec("ROLLBACK");
    throw error;
  }
}

export function getDatabase(): DatabaseSync {
  if (!globalDatabase.rbmailDatabase) {
    const database = new DatabaseSync(databasePath());
    initializeDatabase(database);
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
    authBackend:
      String(row.auth_backend || "direct") === "composio"
        ? "composio"
        : "direct",
    connectedAccountId: row.connected_account_id
      ? String(row.connected_account_id)
      : null,
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
        id, user_id, provider, provider_account_id, email, display_name,
        auth_backend, connected_account_id, token_cipher,
        status, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, 'direct', NULL, ?, 'connected', ?, ?)
      ON CONFLICT(provider, provider_account_id) DO UPDATE SET
        user_id = excluded.user_id,
        email = excluded.email,
        display_name = excluded.display_name,
        auth_backend = 'direct',
        connected_account_id = NULL,
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

export function saveComposioAccount(input: {
  userId: string;
  provider: Provider;
  connectedAccountId: string;
  providerAccountId: string;
  email: string;
  displayName: string;
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

  if (existing?.user_id && String(existing.user_id) !== input.userId) {
    throw new Error("This mailbox is already connected to another Rubidium user.");
  }

  const id = existing ? String(existing.id) : randomUUID();
  const now = Date.now();
  // Gmail and Google Calendar are separate Composio toolkits. Do not label a
  // Gmail-only connection as calendar-capable: provider calls then fail with
  // "insufficient authentication scopes" while the UI claims everything is on.
  const scope = (
    input.provider === "google"
      ? GOOGLE_SCOPES.filter((item) => !item.includes("/auth/calendar."))
      : MICROSOFT_SCOPES
  ).join(" ");
  const token: StoredToken = {
    accessToken: "",
    refreshToken: "",
    expiresAt: Number.MAX_SAFE_INTEGER,
    scope,
    tokenType: "Composio",
  };

  database
    .prepare(
      `INSERT INTO mail_accounts (
        id, user_id, provider, provider_account_id, email, display_name,
        auth_backend, connected_account_id, token_cipher, status, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, 'composio', ?, ?, 'connected', ?, ?)
      ON CONFLICT(provider, provider_account_id) DO UPDATE SET
        user_id = excluded.user_id,
        email = excluded.email,
        display_name = excluded.display_name,
        auth_backend = 'composio',
        connected_account_id = excluded.connected_account_id,
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
      input.connectedAccountId,
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
    ({
      token,
      syncCursor: _cursor,
      userId: _userId,
      connectedAccountId: _connection,
      ...account
    }) => {
      return {
        ...account,
        capabilities:
          account.authBackend === "composio" && account.provider === "google"
            ? { mail: true, calendar: false }
            : accountCapabilities(account.provider, token.scope),
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
  native = false,
) {
  const database = getDatabase();
  database
    .prepare("DELETE FROM oauth_states WHERE created_at < ?")
    .run(Date.now() - 10 * 60 * 1000);
  database
    .prepare(
      "INSERT INTO oauth_states (state, user_id, provider, verifier, native, created_at) VALUES (?, ?, ?, ?, ?, ?)",
    )
    .run(state, userId, provider, verifier, native ? 1 : 0, Date.now());
}

export function consumeOauthState(
  state: string,
  provider: Provider,
): { verifier: string; userId: string; native: boolean } | null {
  const database = getDatabase();
  const row = database
    .prepare(
      "SELECT verifier, user_id, native, created_at FROM oauth_states WHERE state = ? AND provider = ?",
    )
    .get(state, provider) as
    | { verifier: string; user_id: string | null; native: number; created_at: number }
    | undefined;
  database.prepare("DELETE FROM oauth_states WHERE state = ?").run(state);
  if (
    !row ||
    !row.user_id ||
    row.created_at < Date.now() - 10 * 60 * 1000
  ) {
    return null;
  }
  return {
    verifier: row.verifier,
    userId: row.user_id,
    native: Boolean(row.native),
  };
}

export function saveComposioState(input: {
  state: string;
  userId: string;
  provider: Provider;
  connectedAccountId: string;
}) {
  const database = getDatabase();
  database
    .prepare("DELETE FROM composio_states WHERE created_at < ?")
    .run(Date.now() - 20 * 60 * 1000);
  database
    .prepare(
      `INSERT INTO composio_states (
        state, user_id, provider, connected_account_id, created_at
      ) VALUES (?, ?, ?, ?, ?)`,
    )
    .run(
      input.state,
      input.userId,
      input.provider,
      input.connectedAccountId,
      Date.now(),
    );
}

export function getComposioState(
  state: string,
  userId: string,
): { provider: Provider; connectedAccountId: string } | null {
  const database = getDatabase();
  const row = database
    .prepare(
      `SELECT user_id, provider, connected_account_id, created_at
       FROM composio_states WHERE state = ?`,
    )
    .get(state) as
    | {
        user_id: string;
        provider: Provider;
        connected_account_id: string;
        created_at: number;
      }
    | undefined;
  if (
    !row ||
    row.user_id !== userId ||
    row.created_at < Date.now() - 20 * 60 * 1000
  ) {
    return null;
  }
  return {
    provider: row.provider,
    connectedAccountId: row.connected_account_id,
  };
}

export function deleteComposioState(state: string) {
  getDatabase().prepare("DELETE FROM composio_states WHERE state = ?").run(state);
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
  const mailboxKind = (() => {
    if (message.labels.includes("TRASH") || message.folder === "deleteditems") return "trash";
    if (message.labels.includes("SPAM") || message.folder === "junkemail") return "junk";
    if (message.labels.includes("DRAFT") || message.folder === "drafts") return "drafts";
    if (message.labels.includes("SENT") || message.folder === "sentitems") return "sent";
    if (message.labels.includes("INBOX") || message.folder === "inbox") return "inbox";
    return "archive";
  })();

  database
    .prepare(
      `INSERT INTO mail_threads (
        id, account_id, provider_thread_id, subject_cipher, snippet_cipher,
        participants_cipher, labels_cipher, last_message_at, unread, archived,
        flagged, mailbox_kind, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
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
        flagged = MAX(mail_threads.flagged, excluded.flagged),
        archived = CASE
          WHEN excluded.archived = 0 THEN 0 ELSE mail_threads.archived END,
        mailbox_kind = CASE
          WHEN excluded.last_message_at >= mail_threads.last_message_at
          THEN excluded.mailbox_kind ELSE mail_threads.mailbox_kind END,
        sync_version = mail_threads.sync_version + 1,
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
      message.flagged ? 1 : 0,
      mailboxKind,
      now,
    );

  // Persist the parent before its attachment rows. SQLite foreign keys are
  // enabled, so reversing this order makes the first sync of an attached
  // message fail even though subsequent updates appear healthy.
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

  database.prepare("DELETE FROM mail_attachments WHERE message_id = ?").run(messageId);
  const attachmentStatement = database.prepare(
    `INSERT INTO mail_attachments (
      id, message_id, account_id, provider_attachment_id, metadata_cipher,
      content_id, inline, byte_size, created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  );
  for (const attachment of message.attachments ?? []) {
    attachmentStatement.run(
      `${messageId}:${attachment.id}`,
      messageId,
      account.id,
      attachment.providerAttachmentId,
      encryptJson(attachment),
      attachment.contentId,
      attachment.inline ? 1 : 0,
      attachment.size,
      now,
      now,
    );
  }

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
    .prepare(
      "UPDATE mail_threads SET unread = ?, sync_version = sync_version + 1, updated_at = ? WHERE id = ?",
    )
    .run(read ? 0 : 1, Date.now(), id);
  database
    .prepare("UPDATE mail_messages SET is_read = ?, updated_at = ? WHERE thread_id = ?")
    .run(read ? 1 : 0, Date.now(), id);
}

export function setThreadArchived(id: string, archived: boolean) {
  getDatabase()
    .prepare(
      "UPDATE mail_threads SET archived = ?, mailbox_kind = ?, sync_version = sync_version + 1, updated_at = ? WHERE id = ?",
    )
    .run(archived ? 1 : 0, archived ? "archive" : "inbox", Date.now(), id);
}

export function setThreadState(
  id: string,
  action: MailAction,
  options: { snoozedUntil?: string | null } = {},
) {
  const database = getDatabase();
  const values: Record<string, string | number | null> = {};
  if (action === "flag" || action === "unflag") values.flagged = action === "flag" ? 1 : 0;
  if (action === "mute" || action === "unmute") values.muted = action === "mute" ? 1 : 0;
  if (action === "vip" || action === "unvip") values.vip = action === "vip" ? 1 : 0;
  if (action === "snooze") values.snoozed_until = options.snoozedUntil ?? null;
  if (action === "unsnooze") values.snoozed_until = null;
  if (action === "trash" || action === "archive" || action === "junk") values.archived = 1;
  if (action === "restore" || action === "not_junk") values.archived = 0;
  if (action === "trash") values.mailbox_kind = "trash";
  if (action === "archive") values.mailbox_kind = "archive";
  if (action === "junk") values.mailbox_kind = "junk";
  if (action === "restore" || action === "not_junk") values.mailbox_kind = "inbox";
  if (action === "read" || action === "unread") {
    markThreadRead(id, action === "read");
  }
  const entries = Object.entries(values);
  if (!entries.length) return;
  database
    .prepare(
      `UPDATE mail_threads SET ${entries.map(([key]) => `${key} = ?`).join(", ")},
       sync_version = sync_version + 1, updated_at = ? WHERE id = ?`,
    )
    .run(...entries.map(([, value]) => value), Date.now(), id);
}

export function getMessage(
  id: string,
  userId?: string,
): (NormalizedMessage & { accountId: string; threadId: string }) | null {
  const row = getDatabase()
    .prepare(
      `SELECT m.payload_cipher, m.account_id, m.thread_id
       FROM mail_messages m
       JOIN mail_accounts a ON a.id = m.account_id
       WHERE m.id = ? AND (? IS NULL OR a.user_id = ?)`,
    )
    .get(id, userId ?? null, userId ?? null) as
    | { payload_cipher: string; account_id: string; thread_id: string }
    | undefined;
  if (!row) return null;
  return {
    ...hydrateNormalizedMessage(decryptJson<NormalizedMessage>(row.payload_cipher)),
    accountId: row.account_id,
    threadId: row.thread_id,
  };
}

export function getAttachment(
  messageId: string,
  attachmentId: string,
  userId: string,
): { attachment: MailAttachment; message: ReturnType<typeof getMessage> } | null {
  const message = getMessage(messageId, userId);
  if (!message) return null;
  const attachment = message.attachments?.find(
    (candidate) =>
      candidate.id === attachmentId ||
      candidate.providerAttachmentId === attachmentId ||
      candidate.contentId === attachmentId,
  );
  return attachment ? { attachment, message } : null;
}

export function getMailMutation<T>(userId: string, key: string): T | null {
  const row = getDatabase()
    .prepare(
      "SELECT response_cipher FROM mail_mutations WHERE idempotency_key = ? AND user_id = ?",
    )
    .get(key, userId) as { response_cipher: string } | undefined;
  return row ? decryptJson<T>(row.response_cipher) : null;
}

export function saveMailMutation(userId: string, key: string, response: unknown) {
  const database = getDatabase();
  database
    .prepare("DELETE FROM mail_mutations WHERE created_at < ?")
    .run(Date.now() - 7 * 24 * 60 * 60 * 1000);
  database
    .prepare(
      `INSERT INTO mail_mutations (idempotency_key, user_id, response_cipher, created_at)
       VALUES (?, ?, ?, ?) ON CONFLICT(idempotency_key) DO NOTHING`,
    )
    .run(key, userId, encryptJson(response), Date.now());
}

function draftRow(row: Record<string, unknown>): Draft {
  const payload = decryptJson<ComposeMessageInput>(String(row.payload_cipher));
  return {
    ...payload,
    id: String(row.id),
    userId: String(row.user_id),
    state: String(row.state) as Draft["state"],
    error: row.error_cipher ? decryptString(String(row.error_cipher)) : null,
    createdAt: Number(row.created_at),
    updatedAt: Number(row.updated_at),
  };
}

export function saveDraft(
  userId: string,
  input: ComposeMessageInput,
  options: { id?: string; state?: Draft["state"]; error?: string | null; idempotencyKey?: string } = {},
): Draft {
  const id = options.id || randomUUID();
  const now = Date.now();
  getDatabase()
    .prepare(
      `INSERT INTO mail_drafts (
        id, user_id, account_id, payload_cipher, state, error_cipher,
        send_at, idempotency_key, created_at, updated_at
       ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(id) DO UPDATE SET
        account_id = excluded.account_id,
        payload_cipher = excluded.payload_cipher,
        state = excluded.state,
        error_cipher = excluded.error_cipher,
        send_at = excluded.send_at,
        idempotency_key = COALESCE(excluded.idempotency_key, mail_drafts.idempotency_key),
        updated_at = excluded.updated_at`,
    )
    .run(
      id,
      userId,
      input.accountId,
      encryptJson(input),
      options.state || "draft",
      options.error ? encryptString(options.error) : null,
      input.sendAt ? new Date(input.sendAt).getTime() : null,
      options.idempotencyKey || null,
      now,
      now,
    );
  return getDraft(userId, id)!;
}

export function getDraft(userId: string, id: string): Draft | null {
  const row = getDatabase()
    .prepare("SELECT * FROM mail_drafts WHERE id = ? AND user_id = ?")
    .get(id, userId) as Record<string, unknown> | undefined;
  return row ? draftRow(row) : null;
}

export function listDrafts(userId: string): Draft[] {
  return (getDatabase()
    .prepare("SELECT * FROM mail_drafts WHERE user_id = ? ORDER BY updated_at DESC")
    .all(userId) as Record<string, unknown>[]).map(draftRow);
}

export function deleteDraft(userId: string, id: string) {
  return getDatabase()
    .prepare("DELETE FROM mail_drafts WHERE id = ? AND user_id = ?")
    .run(id, userId).changes > 0;
}

export function listDueDrafts(now = Date.now()): Draft[] {
  return (getDatabase()
    .prepare(
      "SELECT * FROM mail_drafts WHERE state = 'queued' AND send_at IS NOT NULL AND send_at <= ? ORDER BY send_at ASC LIMIT 50",
    )
    .all(now) as Record<string, unknown>[]).map(draftRow);
}

const defaultNotificationPreferences: NotificationPreferences = {
  enabled: true,
  scope: "all",
  accountIds: [],
  showSender: true,
  showSubject: true,
  showBody: false,
  sound: true,
  badge: true,
  calendarReminders: false,
};

export function getNotificationPreferences(userId: string): NotificationPreferences {
  const row = getDatabase()
    .prepare("SELECT payload_cipher FROM notification_preferences WHERE user_id = ?")
    .get(userId) as { payload_cipher: string } | undefined;
  return row
    ? { ...defaultNotificationPreferences, ...decryptJson<NotificationPreferences>(row.payload_cipher) }
    : { ...defaultNotificationPreferences };
}

export function saveNotificationPreferences(
  userId: string,
  preferences: NotificationPreferences,
) {
  getDatabase()
    .prepare(
      `INSERT INTO notification_preferences (user_id, payload_cipher, updated_at)
       VALUES (?, ?, ?) ON CONFLICT(user_id) DO UPDATE SET
       payload_cipher = excluded.payload_cipher, updated_at = excluded.updated_at`,
    )
    .run(userId, encryptJson(preferences), Date.now());
  return preferences;
}

export function registerNativeDevice(input: {
  userId: string;
  token: string;
  environment: "sandbox" | "production";
  locale?: string;
}) {
  const hash = createHash("sha256").update(input.token).digest("hex");
  const now = Date.now();
  const id = randomUUID();
  getDatabase()
    .prepare(
      `INSERT INTO native_devices (
        id, user_id, token_hash, token_cipher, environment, locale,
        active, last_seen_at, created_at, updated_at
       ) VALUES (?, ?, ?, ?, ?, ?, 1, ?, ?, ?)
       ON CONFLICT(token_hash) DO UPDATE SET
        user_id = excluded.user_id, token_cipher = excluded.token_cipher,
        environment = excluded.environment, locale = excluded.locale,
        active = 1, last_seen_at = excluded.last_seen_at,
        updated_at = excluded.updated_at`,
    )
    .run(
      id, input.userId, hash, encryptString(input.token), input.environment,
      input.locale || "en", now, now, now,
    );
  return { id, tokenHash: hash };
}

export function listNativeDevices(userId: string) {
  return (getDatabase()
    .prepare("SELECT * FROM native_devices WHERE user_id = ? AND active = 1")
    .all(userId) as Record<string, unknown>[]).map((row) => ({
      id: String(row.id),
      token: decryptString(String(row.token_cipher)),
      environment: String(row.environment) as "sandbox" | "production",
    }));
}

export function unreadCount(userId: string): number {
  const row = getDatabase()
    .prepare(
      `SELECT COUNT(*) AS count FROM mail_threads t
       JOIN mail_accounts a ON a.id = t.account_id
       WHERE a.user_id = ? AND t.unread = 1 AND t.archived = 0
       AND (t.snoozed_until IS NULL OR t.snoozed_until <= ?)`,
    )
    .get(userId, new Date().toISOString()) as { count: number };
  return Number(row.count || 0);
}

export function claimNotificationDelivery(input: {
  userId: string;
  accountId: string;
  providerMessageId: string;
}): boolean {
  try {
    getDatabase()
      .prepare(
        `INSERT INTO notification_deliveries (
          id, user_id, account_id, provider_message_id, delivered_at
         ) VALUES (?, ?, ?, ?, ?)`,
      )
      .run(
        randomUUID(), input.userId, input.accountId, input.providerMessageId, Date.now(),
      );
    return true;
  } catch {
    return false;
  }
}

export function upsertProviderSubscription(input: {
  id: string;
  accountId: string;
  provider: Provider;
  resource: string;
  details: Record<string, unknown>;
  expiresAt?: number | null;
}) {
  getDatabase()
    .prepare(
      `INSERT INTO provider_subscriptions (
        id, account_id, provider, resource, details_cipher, expires_at, updated_at
       ) VALUES (?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(account_id, resource) DO UPDATE SET
        id = excluded.id,
        details_cipher = excluded.details_cipher,
        expires_at = excluded.expires_at,
        updated_at = excluded.updated_at`,
    )
    .run(
      input.id,
      input.accountId,
      input.provider,
      input.resource,
      encryptJson(input.details),
      input.expiresAt ?? null,
      Date.now(),
    );
}

export function getProviderSubscription(id: string) {
  const row = getDatabase()
    .prepare("SELECT * FROM provider_subscriptions WHERE id = ?")
    .get(id) as Record<string, unknown> | undefined;
  if (!row) return null;
  return {
    id: String(row.id),
    accountId: String(row.account_id),
    provider: String(row.provider) as Provider,
    resource: String(row.resource),
    details: decryptJson<Record<string, unknown>>(String(row.details_cipher)),
    expiresAt: row.expires_at ? Number(row.expires_at) : null,
  };
}

export function getAccountSubscription(accountId: string, resource: string) {
  const row = getDatabase()
    .prepare("SELECT id FROM provider_subscriptions WHERE account_id = ? AND resource = ?")
    .get(accountId, resource) as { id: string } | undefined;
  return row ? getProviderSubscription(row.id) : null;
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
    flagged: Number(row.flagged) === 1,
    archived: Number(row.archived) === 1,
    snoozedUntil: row.snoozed_until ? String(row.snoozed_until) : null,
    muted: Number(row.muted) === 1,
    vip: Number(row.vip) === 1,
    syncVersion: Number(row.sync_version || 1),
    attachmentCount: Number(row.attachment_count || 0),
    messageCount: Number(row.message_count),
  };
}

function hydrateNormalizedMessage(message: NormalizedMessage): NormalizedMessage {
  return {
    ...message,
    bcc: message.bcc ?? [],
    flagged: message.flagged ?? message.labels?.includes("STARRED") ?? false,
    attachments: message.attachments ?? [],
    headers: message.headers ?? {
      messageId: null,
      inReplyTo: null,
      references: [],
      replyTo: [],
      listUnsubscribe: null,
    },
    mimeTree: message.mimeTree ?? null,
  };
}

export type ThreadListOptions = {
  limit?: number;
  cursor?: string;
  accountId?: string;
  view?: string;
  query?: string;
};

export function listThreads(
  userId: string,
  limitOrOptions: number | ThreadListOptions = 100,
): ThreadSummary[] {
  const options: ThreadListOptions =
    typeof limitOrOptions === "number" ? { limit: limitOrOptions } : limitOrOptions;
  const limit = Math.max(1, Math.min(options.limit ?? 100, 500));
  const cursor = options.cursor
    ? Buffer.from(options.cursor, "base64url").toString("utf8").split("\u0000")
    : [];
  const clauses = ["a.user_id = ?"];
  const values: Array<string | number | null> = [userId];
  const now = new Date().toISOString();
  switch (options.view) {
    case "archive": clauses.push("t.mailbox_kind = 'archive'"); break;
    case "sent": clauses.push("t.mailbox_kind = 'sent'"); break;
    case "drafts": clauses.push("t.mailbox_kind = 'drafts'"); break;
    case "junk": clauses.push("t.mailbox_kind = 'junk'"); break;
    case "flagged": clauses.push("t.flagged = 1"); break;
    case "vip": clauses.push("t.vip = 1"); break;
    case "snoozed": clauses.push("t.snoozed_until IS NOT NULL"); break;
    case "trash": clauses.push("t.mailbox_kind = 'trash'"); break;
    default:
      // Search spans the encrypted local history rather than silently being
      // constrained to the current inbox. Normal mailbox loads retain the
      // inbox/snooze contract.
      if (!options.query?.trim()) {
        clauses.push("t.mailbox_kind = 'inbox'");
        clauses.push("t.archived = 0");
        clauses.push("(t.snoozed_until IS NULL OR t.snoozed_until <= ?)");
        values.push(now);
      }
  }
  if (options.accountId) {
    clauses.push("t.account_id = ?");
    values.push(options.accountId);
  }
  if (cursor.length === 2) {
    clauses.push("(t.last_message_at < ? OR (t.last_message_at = ? AND t.id < ?))");
    values.push(cursor[0], cursor[0], cursor[1]);
  }
  const rows = getDatabase()
    .prepare(
      `SELECT t.*, a.provider, a.email, a.display_name,
        (SELECT COUNT(*) FROM mail_messages m WHERE m.thread_id = t.id) AS message_count,
        (SELECT COUNT(*) FROM mail_attachments ma
          JOIN mail_messages mm ON mm.id = ma.message_id
          WHERE mm.thread_id = t.id) AS attachment_count
       FROM mail_threads t
       JOIN mail_accounts a ON a.id = t.account_id
       WHERE ${clauses.join(" AND ")}
       ORDER BY t.last_message_at DESC
       LIMIT ?`,
    )
    .all(...values, options.query?.trim() ? 5_000 : limit * 3) as Record<string, unknown>[];
  const normalizedQuery = options.query?.trim().toLowerCase();
  const summaries = rows.map(threadRowToSummary);
  return (normalizedQuery
    ? summaries.filter((thread) =>
        [thread.subject, thread.snippet, thread.email, thread.displayName,
          ...thread.participants.flatMap((participant) => [participant.name, participant.address])]
          .join(" ")
          .toLowerCase()
          .includes(normalizedQuery),
      )
    : summaries
  ).slice(0, limit);
}

export function getThread(id: string, userId?: string): ThreadDetail | null {
  const row = getDatabase()
    .prepare(
      `SELECT t.*, a.provider, a.email, a.display_name,
        (SELECT COUNT(*) FROM mail_messages m WHERE m.thread_id = t.id) AS message_count,
        (SELECT COUNT(*) FROM mail_attachments ma
          JOIN mail_messages mm ON mm.id = ma.message_id
          WHERE mm.thread_id = t.id) AS attachment_count
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
      hydrateNormalizedMessage(
        decryptJson<NormalizedMessage>(message.payload_cipher),
      ),
    ),
  };
}
