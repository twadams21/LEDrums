// Minimal Cloudflare Workers ambient types — the subset this Worker uses. Declaring them locally
// keeps the Worker dependency-light (no @cloudflare/workers-types install) while still typechecking.
// Wrangler injects the full runtime types at deploy; nothing here changes runtime behaviour.

export interface D1Result<T = unknown> {
  results?: T[];
  success: boolean;
  meta?: { changes?: number; last_row_id?: number; duration?: number };
}

export interface D1PreparedStatement {
  bind(...values: unknown[]): D1PreparedStatement;
  first<T = unknown>(colName?: string): Promise<T | null>;
  all<T = unknown>(): Promise<D1Result<T>>;
  run<T = unknown>(): Promise<D1Result<T>>;
}

export interface D1Database {
  prepare(query: string): D1PreparedStatement;
}

export interface ExecutionContext {
  waitUntil(promise: Promise<unknown>): void;
  passThroughOnException(): void;
}
