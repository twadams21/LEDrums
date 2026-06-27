/* Show-document library cores — the multi-show library decisions (naming, rename, the
   delete re-point) as PURE functions over the `Record<string, Show>` map (no runes/DOM). The
   store owns the authored-rune swap (applyShow / toAuthored) these can't reach; here lives only
   the map arithmetic + which-show-becomes-active logic. Extracted from store.svelte.ts
   unchanged in behaviour. */

import type { Show } from '../persistence';

export type ShowMap = Record<string, Show>;

/** First unused "Untitled Show" / "Untitled Show 2" … label, so blank shows stay distinct. */
export function nextShowName(library: ShowMap): string {
  const base = 'Untitled Show';
  const used = new Set(Object.values(library).map((s) => s.name));
  if (!used.has(base)) return base;
  let n = 2;
  while (used.has(`${base} ${n}`)) n++;
  return `${base} ${n}`;
}

/** Insert / replace a show in the library (immutable). */
export function withShow(library: ShowMap, show: Show): ShowMap {
  return { ...library, [show.id]: show };
}

/** Rename a show. Returns the SAME map ref on an unknown id or a blank name (keeps the old
    name, mirrors renameSong). */
export function renameShowIn(library: ShowMap, id: string, name: string): ShowMap {
  const show = library[id];
  if (!show) return library;
  const trimmed = name.trim();
  if (!trimmed) return library;
  return { ...library, [id]: { ...show, name: trimmed } };
}

/** The outcome of a deleteShow request — the store applies it (and, for `reseed`, mints a fresh
    blank show via its seed path):
      - `noop`   — unknown id, nothing changes;
      - `reseed` — the last show was deleted; the store seeds a fresh "Untitled Show";
      - `remove` — the show is gone; `library` + `activeShowId` are the new state, and `reload`
                   (when non-null) is the show whose authored content must swap into the runes
                   (only when the ACTIVE show was the one deleted). */
export type DeletePlan =
  | { kind: 'noop' }
  | { kind: 'reseed' }
  | { kind: 'remove'; library: ShowMap; activeShowId: string; reload: Show | null };

/** Decide how deleting `id` reshapes the library. Never leaves zero shows (→ `reseed`). When the
    ACTIVE show is deleted, re-points to its left neighbour (else the new first) and flags that
    show for a runes swap. Mirrors the old inline `deleteShow`. */
export function planDeleteShow(library: ShowMap, activeShowId: string, id: string): DeletePlan {
  if (!library[id]) return { kind: 'noop' };
  const ids = Object.keys(library);
  const next: ShowMap = { ...library };
  delete next[id];

  if (Object.keys(next).length === 0) return { kind: 'reseed' };

  if (activeShowId !== id) {
    return { kind: 'remove', library: next, activeShowId, reload: null };
  }
  const idx = ids.indexOf(id);
  const leftId = idx > 0 ? ids[idx - 1]! : null;
  const neighbourId = leftId && next[leftId] ? leftId : Object.keys(next)[0]!;
  return { kind: 'remove', library: next, activeShowId: neighbourId, reload: next[neighbourId]! };
}
