export const DEFAULT_HISTORY_BYTES = 32 * 1024 * 1024;
export const MAX_HISTORY_ENTRIES = 10000;

/** JSON-shaped document checkpoints, with immutable structural sharing between adjacent entries.
 * The estimate counts each retained object ONCE: 32 bytes/object, 24/array, 16/property slot,
 * 2/UTF-16 key or string code unit, 8/other primitive or reference plus 8/array slot. It also charges 48/object for
 * reference-count bookkeeping. This is a conservative accounting model, NOT a JS heap-size claim
 * (engines vary in headers, interned strings and GC). Transient traversal/restore allocations and
 * the live document are not history retention. No stringify or full structuredClone on push.
 *
 * Oldest checkpoints are evicted until BOTH limits hold. An individually oversized checkpoint
 * clears the history: keeping older checkpoints would let Undo jump over an unrecorded edit.
 * The edit itself is never refused. Subsequent fitting checkpoints work normally. Callers surface
 * the returned `oversized` result. Pop returns immutable data; clone before editing/restoring it.
 */
export class DocumentHistory<T extends object> {
  private entries: { documentId: string; value: T }[] = [];
  private documentId: string | null = null;
  private retained = new WeakMap<object, { refs: number; bytes: number }>();
  private bytes = 0;
  private readonly maxBytes: number;
  private readonly maxEntries: number;

  constructor(options: { maxBytes?: number; maxEntries?: number } = {}) {
    this.maxBytes = Math.max(0, options.maxBytes ?? DEFAULT_HISTORY_BYTES);
    this.maxEntries = Math.max(1, Math.min(MAX_HISTORY_ENTRIES, options.maxEntries ?? MAX_HISTORY_ENTRIES));
  }

  get stats(): { entries: number; bytes: number } {
    return { entries: this.entries.length, bytes: this.bytes };
  }

  replace(documentId: string): void {
    this.entries = [];
    this.retained = new WeakMap();
    this.bytes = 0;
    this.documentId = documentId;
  }

  push(documentId: string, source: T): 'stored' | 'oversized' {
    if (documentId !== this.documentId) this.replace(documentId);
    const value = shareSnapshot(source, this.entries.at(-1)?.value) as T;
    const entry = { documentId, value };
    this.retain(entry);
    this.entries.push(entry);
    while (this.entries.length > this.maxEntries || this.bytes > this.maxBytes) {
      this.release(this.entries.shift()!);
    }
    return this.entries.length ? 'stored' : 'oversized';
  }

  pop(documentId: string): T | null {
    if (documentId !== this.documentId) {
      this.replace(documentId);
      return null;
    }
    const entry = this.entries.pop();
    if (!entry) return null;
    this.release(entry);
    return entry.value;
  }

  private retain(value: object): void {
    const held = this.retained.get(value);
    if (held) { held.refs++; return; }
    const bytes = shallowBytes(value);
    this.retained.set(value, { refs: 1, bytes });
    this.bytes += bytes;
    for (const child of Object.values(value)) if (isObject(child)) this.retain(child);
  }

  private release(value: object): void {
    const held = this.retained.get(value)!;
    if (--held.refs > 0) return;
    this.bytes -= held.bytes;
    this.retained.delete(value);
    for (const child of Object.values(value)) if (isObject(child)) this.release(child);
  }
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

/** Copy only changed paths. Do not trust the source object's identity: Svelte edits nested proxies
 * in place. Keys are compared too so deleting a field differs from setting it to undefined. */
function shareSnapshot(source: unknown, previous: unknown): unknown {
  if (!isObject(source)) return source;
  const array = Array.isArray(source);
  const prior = isObject(previous) && Array.isArray(previous) === array ? previous : undefined;
  const keys = Object.keys(source);
  const priorKeys = prior ? Object.keys(prior) : [];
  const sameShape = prior && keys.length === priorKeys.length
    && keys.every((key, i) => key === priorKeys[i])
    && (!array || source.length === prior.length);
  // Lazily allocate only on a changed path. Preserve insertion order: graph/library order is UI.
  const empty = () => (array ? [] : {}) as Record<string, unknown>;
  let copy = sameShape ? undefined : empty();
  for (let i = 0; i < keys.length; i++) {
    const key = keys[i]!;
    const child = shareSnapshot(source[key], prior?.[key]);
    if (!copy && child !== prior![key]) {
      copy = empty();
      for (let j = 0; j < i; j++) define(copy, keys[j]!, prior![keys[j]!]);
    }
    if (copy) define(copy, key, child);
  }
  if (!copy) return prior;
  if (array) (copy as unknown as unknown[]).length = (source as unknown as unknown[]).length;
  return Object.freeze(copy);
}

function define(target: object, key: string, value: unknown): void {
  // A document key named __proto__ is data, not a prototype assignment.
  Object.defineProperty(target, key, { value, enumerable: true, configurable: true, writable: true });
}

function shallowBytes(value: object): number {
  let bytes = (Array.isArray(value) ? 24 + value.length * 8 : 32) + 48;
  for (const [key, child] of Object.entries(value)) {
    bytes += 16 + key.length * 2 + (typeof child === 'string' ? child.length * 2 : 8);
  }
  return bytes;
}
