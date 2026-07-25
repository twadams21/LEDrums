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

// R2 subset used by the backups routes (#123). Wrangler injects the full runtime types at deploy.
export interface R2Object {
  key: string;
  size: number;
  uploaded: Date;
}

export interface R2ObjectBody extends R2Object {
  text(): Promise<string>;
}

export interface R2Objects {
  objects: R2Object[];
  truncated: boolean;
  cursor?: string;
}

export interface R2Bucket {
  put(key: string, value: string | ArrayBuffer | ReadableStream): Promise<R2Object>;
  get(key: string): Promise<R2ObjectBody | null>;
  list(opts?: { prefix?: string; cursor?: string; limit?: number }): Promise<R2Objects>;
}

export interface ExecutionContext {
  waitUntil(promise: Promise<unknown>): void;
  passThroughOnException(): void;
}
