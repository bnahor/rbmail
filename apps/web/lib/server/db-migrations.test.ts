import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import test from "node:test";

import { applyCompatibilityMigrations } from "./db-migrations.ts";

function columnNames(database: DatabaseSync, table: string) {
  return new Set(
    (database.prepare(`PRAGMA table_info(${table})`).all() as Array<{ name: string }>).map(
      (row) => row.name,
    ),
  );
}

test("upgrades the original pilot database before creating state indexes", () => {
  const database = new DatabaseSync(":memory:");
  database.exec(`
    CREATE TABLE mail_accounts (
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
      updated_at INTEGER NOT NULL
    );
    CREATE TABLE mail_threads (
      id TEXT PRIMARY KEY,
      account_id TEXT NOT NULL,
      provider_thread_id TEXT NOT NULL,
      subject_cipher TEXT NOT NULL,
      snippet_cipher TEXT NOT NULL,
      participants_cipher TEXT NOT NULL,
      labels_cipher TEXT NOT NULL,
      last_message_at TEXT NOT NULL,
      unread INTEGER NOT NULL DEFAULT 0,
      archived INTEGER NOT NULL DEFAULT 0,
      updated_at INTEGER NOT NULL
    );
    CREATE TABLE oauth_states (
      state TEXT PRIMARY KEY,
      provider TEXT NOT NULL,
      verifier TEXT NOT NULL,
      created_at INTEGER NOT NULL
    );
  `);

  database.exec("BEGIN IMMEDIATE");
  applyCompatibilityMigrations(database);
  database.exec("COMMIT");

  assert.deepEqual(
    [...columnNames(database, "mail_threads")].filter((name) =>
      ["flagged", "snoozed_until", "muted", "vip", "mailbox_kind", "sync_version"].includes(
        name,
      ),
    ),
    ["flagged", "snoozed_until", "muted", "vip", "mailbox_kind", "sync_version"],
  );
  assert.equal(
    database
      .prepare("SELECT name FROM sqlite_master WHERE type = 'index' AND name = 'idx_threads_state'")
      .get()?.name,
    "idx_threads_state",
  );

  // Every migration is idempotent and safe to run again on the same volume.
  applyCompatibilityMigrations(database);
  assert.equal(
    database
      .prepare("SELECT COUNT(*) AS count FROM pragma_index_list('mail_threads') WHERE name = 'idx_threads_state'")
      .get()?.count,
    1,
  );
  database.close();
});
