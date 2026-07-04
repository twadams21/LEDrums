/**
 * Strict member-ordered JSON serializer.
 *
 * The PixLite API requires JSON object members to appear in a specific order —
 * the first member of a request MUST be `req`, and members like `net` before
 * `pix` are rejected if reversed (doc §6.5). Native `JSON.stringify` preserves
 * insertion order *today*, but that is not a language guarantee and does not
 * survive round-trips through parse/serialize or structuredClone. So we never
 * rely on object key order: requests are built as {@link OrderedMap}s (an
 * explicit list of entries) and serialized here, deterministically.
 *
 * No whitespace between members (the controller has limited buffer capacity and
 * the doc recommends omitting it).
 */

/** A JSON value with explicit, preserved object-member ordering. */
export type OrderedJson = string | number | boolean | null | OrderedJson[] | OrderedMap;

/** An object whose members are an ordered list of `[key, value]` entries. */
export class OrderedMap {
  constructor(public readonly entries: ReadonlyArray<readonly [string, OrderedJson]>) {}
}

/** Terse constructor: `om(['req', 'identify'], ['id', 1])`. */
export function om(...entries: ReadonlyArray<readonly [string, OrderedJson]>): OrderedMap {
  return new OrderedMap(entries);
}

/** Serialize an {@link OrderedJson} value to a compact, order-preserving string. */
export function stringifyOrdered(value: OrderedJson): string {
  if (value === null) return 'null';
  if (value instanceof OrderedMap) {
    const body = value.entries
      .map(([k, v]) => `${JSON.stringify(k)}:${stringifyOrdered(v)}`)
      .join(',');
    return `{${body}}`;
  }
  if (Array.isArray(value)) {
    return `[${value.map(stringifyOrdered).join(',')}]`;
  }
  // string | number | boolean — JSON.stringify handles ASCII escaping correctly.
  return JSON.stringify(value);
}
