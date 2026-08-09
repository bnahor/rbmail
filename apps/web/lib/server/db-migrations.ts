import type { DatabaseSync } from "node:sqlite";

function hasColumn(database: DatabaseSync, table: string, column: string) {
  const rows = database.prepare(`PRAGMA table_info(${table})`).all() as Array<{
    name?: unknown;
  }>;
  return rows.some((row) => String(row.name) === column);
}

function addColumnIfMissing(
  database: DatabaseSync,
  table: string,
  column: string,
  definition: string,
) {
  if (!hasColumn(database, table, column)) {
    database.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${definition}`);
  }
}

/**
 * Upgrades the original pilot schema without relying on CREATE TABLE IF NOT
 * EXISTS to add columns. Keep all indexes that reference migrated columns at
 * the end so an existing production database can always complete the upgrade.
 */
export function applyCompatibilityMigrations(database: DatabaseSync) {
  addColumnIfMissing(database, "mail_accounts", "user_id", "TEXT");
  addColumnIfMissing(
    database,
    "mail_accounts",
    "auth_backend",
    "TEXT NOT NULL DEFAULT 'direct'",
  );
  addColumnIfMissing(
    database,
    "mail_accounts",
    "connected_account_id",
    "TEXT",
  );
  addColumnIfMissing(database, "oauth_states", "user_id", "TEXT");
  addColumnIfMissing(
    database,
    "oauth_states",
    "native",
    "INTEGER NOT NULL DEFAULT 0",
  );
  addColumnIfMissing(
    database,
    "mail_threads",
    "archived",
    "INTEGER NOT NULL DEFAULT 0",
  );
  addColumnIfMissing(
    database,
    "mail_threads",
    "flagged",
    "INTEGER NOT NULL DEFAULT 0",
  );
  addColumnIfMissing(database, "mail_threads", "snoozed_until", "TEXT");
  addColumnIfMissing(
    database,
    "mail_threads",
    "muted",
    "INTEGER NOT NULL DEFAULT 0",
  );
  addColumnIfMissing(
    database,
    "mail_threads",
    "vip",
    "INTEGER NOT NULL DEFAULT 0",
  );
  addColumnIfMissing(
    database,
    "mail_threads",
    "mailbox_kind",
    "TEXT NOT NULL DEFAULT 'inbox'",
  );
  addColumnIfMissing(
    database,
    "mail_threads",
    "sync_version",
    "INTEGER NOT NULL DEFAULT 1",
  );

  database.exec(`
    CREATE INDEX IF NOT EXISTS idx_mail_accounts_user
      ON mail_accounts(user_id, created_at);
    CREATE UNIQUE INDEX IF NOT EXISTS idx_mail_accounts_composio_connection
      ON mail_accounts(connected_account_id)
      WHERE connected_account_id IS NOT NULL;
    CREATE INDEX IF NOT EXISTS idx_threads_state
      ON mail_threads(archived, flagged, snoozed_until, last_message_at DESC);
  `);
}
