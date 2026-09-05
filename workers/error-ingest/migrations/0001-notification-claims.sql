-- Existing installs: apply with ingest writers QUIESCED, before deploying the new Worker.
-- This ledger is both the new-error budget charge and the best-effort notification claim.
-- Backfilled rows suppress re-notification; they do NOT assert that Discord ever received a ping.
CREATE TABLE IF NOT EXISTS notification_claims (
  machine     TEXT    NOT NULL,
  version     TEXT    NOT NULL,
  dedup_key   TEXT    NOT NULL,
  claimed_at  INTEGER NOT NULL,
  PRIMARY KEY (machine, version, dedup_key)
);
CREATE INDEX IF NOT EXISTS idx_notification_claims_machine_time
  ON notification_claims (machine, claimed_at);

-- Collapse sessions into one identity. Use original arrival time, not migration time, so the
-- historical dataset does not exhaust today's window. Safe to repeat; never resets a live claim.
INSERT INTO notification_claims (machine, version, dedup_key, claimed_at)
SELECT machine, version, dedup_key, MIN(received_at)
FROM reports
GROUP BY machine, version, dedup_key
ON CONFLICT(machine, version, dedup_key) DO NOTHING;
