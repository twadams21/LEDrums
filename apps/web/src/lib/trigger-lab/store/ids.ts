/* Id factory (#12) — the ONE place the store mints ids. Every domain (shows, songs,
   sections, graphs, nodes, edges, presets) used to carry its own ad-hoc `nid()` /
   collision loop; they all funnel here now so the counter + the "survives reload" loop
   live once. Pure (no runes/DOM): a module-global monotonic counter, exactly as the old
   `store.svelte.ts` module scope held it — shared across every TriggerLab instance so a
   reload's fresh ids never collide with a restored library's. */

/** Monotonic id seed — module-global on purpose (one counter per process, like the old
    `let idSeq` in store.svelte.ts), so ids stay unique across stores + reloads. */
let idSeq = 1000;

const GENERATED_ID_RE = /^(show|graph|song|section|n|e|preset)-(\d+)$/;

/** Mint a fresh `"<prefix>-<n>"` id (the raw counter bump). */
export function nid(prefix: string): string {
  return `${prefix}-${idSeq++}`;
}

/** Reserve a persisted generated id so later nid() calls cannot reuse it after reload. */
export function reserveId(id: string): void {
  const match = GENERATED_ID_RE.exec(id);
  if (!match) return;
  const next = Number(match[2]) + 1;
  if (Number.isFinite(next)) idSeq = Math.max(idSeq, next);
}

/** Reserve every generated id present in a restored authored library. */
export function reserveIds(ids: Iterable<string>): void {
  for (const id of ids) reserveId(id);
}

/** Mint a fresh id that is not already taken (the "survives reload" loop the domains
    repeated: keep bumping until `exists` says the id is free). `exists` is the domain's
    membership test (e.g. `(id) => id in this.graphs`). */
export function freshId(prefix: string, exists: (id: string) => boolean): string {
  let id = nid(prefix);
  while (exists(id)) id = nid(prefix);
  return id;
}
