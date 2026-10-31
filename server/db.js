import { DatabaseSync } from 'node:sqlite';

// One file, no server to run. Plenty for hundreds of shops.
export function openDb(file = process.env.DB_FILE || 'ustaad.db') {
  const db = new DatabaseSync(file);
  db.exec(`
    PRAGMA journal_mode = WAL;
    PRAGMA foreign_keys = ON;

    CREATE TABLE IF NOT EXISTS shops (
      id              INTEGER PRIMARY KEY,
      slug            TEXT    NOT NULL UNIQUE,          -- used in the link: /q/<slug>
      name            TEXT    NOT NULL,
      name_ur         TEXT,
      pin_hash        TEXT    NOT NULL,                 -- barber login PIN (scrypt)
      avg_service_sec INTEGER NOT NULL DEFAULT 900,     -- learned from "Next" taps
      is_open         INTEGER NOT NULL DEFAULT 1,
      created_at      INTEGER NOT NULL
    );

    CREATE TABLE IF NOT EXISTS tokens (
      id        INTEGER PRIMARY KEY,
      shop_id   INTEGER NOT NULL REFERENCES shops(id),
      day       TEXT    NOT NULL,                       -- YYYY-MM-DD (Pakistan time); numbers restart daily
      number    INTEGER NOT NULL,
      status    TEXT    NOT NULL DEFAULT 'waiting'
                CHECK (status IN ('waiting','serving','done','skipped','left')),
      source    TEXT    NOT NULL DEFAULT 'link',        -- 'link' (phone) or 'walkin' (added by barber)
      secret    TEXT,                                   -- proves the phone owns this token
      joined_at INTEGER NOT NULL,
      called_at INTEGER,                                -- when barber called this number
      done_at   INTEGER,
      UNIQUE (shop_id, day, number)
    );

    CREATE INDEX IF NOT EXISTS tokens_shop_day_status ON tokens (shop_id, day, status);
  `);
  return db;
}
