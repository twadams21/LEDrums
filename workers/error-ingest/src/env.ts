import type { D1Database } from './cf';

/** Worker bindings + secrets (set via `wrangler secret put` and the D1 binding in wrangler.toml). */
export interface Env {
  /** D1 database binding (the `reports` table). */
  DB: D1Database;
  /** Static bearer token both routes require. Stored as a Worker secret. */
  TELEMETRY_TOKEN: string;
  /** Discord webhook URL fired on the first occurrence of a dedup key. Optional (unset ⇒ no pings). */
  DISCORD_WEBHOOK_URL?: string;
}

/** Per-machine rate limit: max NEW rows accepted per window (repeats upsert, so they don't count). */
export const RATE_LIMIT_WINDOW_MS = 60_000;
export const RATE_LIMIT_MAX_NEW_ROWS = 240;
