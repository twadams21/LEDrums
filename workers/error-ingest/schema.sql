-- D1 schema for the LEDrums error-ingest Worker (#122).
-- One row per (machine, version, session, dedup_key); repeats bump `count` + `last_seen`.

CREATE TABLE IF NOT EXISTS reports (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  machine      TEXT    NOT NULL,
  version      TEXT    NOT NULL,
  engine_mode  TEXT    NOT NULL,
  platform     TEXT    NOT NULL,
  os_release   TEXT    NOT NULL,
  session      TEXT    NOT NULL,
  origin       TEXT    NOT NULL,
  dedup_key    TEXT    NOT NULL,
  message      TEXT    NOT NULL,
  stack        TEXT,
  breadcrumbs  TEXT    NOT NULL DEFAULT '[]',
  count        INTEGER NOT NULL DEFAULT 1,
  first_seen   INTEGER NOT NULL,
  last_seen    INTEGER NOT NULL,
  received_at  INTEGER NOT NULL,
  UNIQUE (machine, version, session, dedup_key)
);

-- Per-machine rate-limit window scan (rows created since T).
CREATE INDEX IF NOT EXISTS idx_reports_machine_received ON reports (machine, received_at);
-- Webhook newness check + read-API (machine, version, dedup_key).
CREATE INDEX IF NOT EXISTS idx_reports_lookup ON reports (machine, version, dedup_key);
-- Read-API ordering + `since` filter.
CREATE INDEX IF NOT EXISTS idx_reports_last_seen ON reports (last_seen);
