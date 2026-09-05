import type { SQLInputValue } from 'node:sqlite';
import { createRequire } from 'node:module';
// Vite 5 predates node:sqlite; load the builtin directly, never via its module resolver.
const { DatabaseSync } = createRequire(import.meta.url)('node:sqlite') as typeof import('node:sqlite');
import { readFileSync } from 'node:fs';
import type { D1Database, D1PreparedStatement, D1Result } from '../src/cf';

/** Local-only D1 transport shim. No SQL interpretation: production statements run in real SQLite.
 * Each async call yields so overlapping handlers interleave at IO boundaries. A batch executes
 * inside one SQLite transaction, matching D1's documented batch commit/rollback contract. */
export function sqliteD1(path = ':memory:', initialize = true) {
  const sqlite = new DatabaseSync(path);
  if (initialize) sqlite.exec(readFileSync(new URL('../schema.sql', import.meta.url), 'utf8'));

  class Statement implements D1PreparedStatement {
    constructor(readonly query: string, readonly values: SQLInputValue[] = []) {}
    bind(...values: unknown[]) {
      return new Statement(this.query, values as SQLInputValue[]);
    }
    execute<T>(): D1Result<T> {
      const results = sqlite.prepare(this.query).all(...this.values) as T[];
      const { changes } = sqlite.prepare('SELECT changes() AS changes').get()!;
      return { success: true, results, meta: { changes: Number(changes) } };
    }
    async first<T>(colName?: string): Promise<T | null> {
      await Promise.resolve();
      const row = this.execute<Record<string, unknown>>().results?.[0];
      return (row == null ? null : colName ? row[colName] : row) as T | null;
    }
    async all<T>(): Promise<D1Result<T>> {
      await Promise.resolve();
      return this.execute<T>();
    }
    run<T>() { return this.all<T>(); }
  }

  const db = {
    prepare: (query: string) => new Statement(query),
    async batch<T>(statements: D1PreparedStatement[]): Promise<D1Result<T>[]> {
      await Promise.resolve();
      sqlite.exec('BEGIN IMMEDIATE');
      try {
        const results = statements.map((statement) => {
          if (!(statement instanceof Statement)) throw new Error('foreign statement');
          return statement.execute<T>();
        });
        sqlite.exec('COMMIT');
        return results;
      } catch (error) {
        sqlite.exec('ROLLBACK');
        throw error;
      }
    },
  } satisfies D1Database;
  return { db, sqlite, close: () => sqlite.close() };
}
