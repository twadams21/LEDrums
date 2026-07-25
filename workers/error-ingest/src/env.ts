import type { D1Database, R2Bucket } from './cf';

/** Worker bindings + secrets (set via `wrangler secret put` and the D1/R2 bindings in wrangler.toml). */
export interface Env {
  /** D1 database binding (the `reports` table). */
  DB: D1Database;
  /** R2 bucket for project backups (#123): objects under `backups/<machine>/<key>`. Remote retention
   * is a bucket lifecycle rule (90-day expiry), configured on the bucket — not code. */
  BACKUPS: R2Bucket;
  /** Static bearer token every route requires. Stored as a Worker secret. */
  TELEMETRY_TOKEN: string;
  /** Discord webhook URL fired on the first occurrence of a dedup key. Optional (unset ⇒ no pings). */
  DISCORD_WEBHOOK_URL?: string;
}

/** Per-machine rate limit: max NEW rows accepted per window (repeats upsert, so they don't count). */
export const RATE_LIMIT_WINDOW_MS = 60_000;
export const RATE_LIMIT_MAX_NEW_ROWS = 240;
