/* Hydration / back-compat unions — the idempotent fix-ups every boot + show-load runs so a
   stale localStorage blob never drops new built-ins or surfaces a raw pad key. PURE (no
   runes/DOM); extracted from store.svelte.ts verbatim. The store wraps these in
   `normalizeGraphs` / `applyAuthored`. */

import {
  type EffectDef,
  type Preset,
  type TriggerGraph,
  type TriggerSource,
  foldVelocitySwitches,
} from '../sim';
import { EFFECTS, PRESETS, type Pad } from '../fixtures';
import { padKey, padLabel } from './seed';

/** Union built-in effects with persisted USER-CREATED ones. Hydration must never
    drop new built-ins: a user's blob saved before the 41 generator effects existed
    would otherwise overwrite the fresh registry and hide them forever. So start from
    the fixture EFFECTS (every built-in, always current) and append only persisted
    effects whose id isn't a built-in — the user's own createEffect() additions.
    Built-ins are immutable from the UI, so re-taking the fresh def loses nothing. */
export function unionEffects(persisted: readonly EffectDef[]): EffectDef[] {
  const overrideById = new Map(persisted.map((e) => [e.id, e] as const));
  const builtinIds = new Set(EFFECTS.map((e) => e.id));
  // Built-ins are re-taken FRESH (so new params/pattern/generator defs always surface), but a
  // persisted RENAME of a built-in wins — `name` is the only field the UI lets you edit on an
  // effect (rename + duplicate; never delete), so a renamed "Swirl" survives a reload. Mirrors
  // {@link unionPresets} letting a persisted built-in preset win. Then append the user's own
  // createEffect/duplicateEffect additions.
  const builtins = EFFECTS.map((e) => {
    const o = overrideById.get(e.id);
    return o && o.name !== e.name ? { ...e, name: o.name } : e;
  });
  return [...builtins, ...persisted.filter((e) => !builtinIds.has(e.id))];
}

/** Union persisted presets with the built-ins (mirrors {@link unionEffects}). Keeps
    the user's persisted presets first — so edits to a built-in preset (linked mode)
    survive — then re-adds any built-in preset the stored slice LACKS. Without this a
    pre-generator localStorage blob silently drops the 41 generator `${id}:default`
    presets, so swapping a play node to a generator effect leaves `presetId` dangling:
    the node sub goes blank AND the engine can't resolve the effect (frozen preview). */
export function unionPresets(persisted: readonly Preset[]): Preset[] {
  const persistedIds = new Set(persisted.map((p) => p.id));
  return [...persisted, ...PRESETS.filter((p) => !persistedIds.has(p.id))];
}

/** Ensure a pad graph's trigger node carries a `drum` source derived from its padKey
    `"drumId:zone"`. Returns the SAME graph reference when nothing changes (idempotent +
    alias-stable), so an already-sourced or non-pad-keyed graph is untouched. */
export function withDrumSource(graph: TriggerGraph, key: string): TriggerGraph {
  const i = graph.nodes.findIndex((n) => n.kind === 'trigger');
  if (i < 0 || graph.nodes[i]!.source) return graph; // no trigger node, or already explicit
  const sep = key.indexOf(':');
  if (sep < 0) return graph; // not a "drumId:zone" key → leave unset
  const source: TriggerSource = { kind: 'drum', drumId: key.slice(0, sep), zone: key.slice(sep + 1) };
  const nodes = graph.nodes.slice();
  nodes[i] = { ...nodes[i]!, source };
  return { nodes, edges: graph.edges };
}

/** Back-fill an explicit `drum` trigger source on every PAD-BOUND graph (a key matching a real
    pad) that lacks one — the implicit padKey binding (`"drumId:zone"`) made explicit, so a graph
    now declares what fires it. Mirrors {@link unionEffects}/{@link unionPresets}: a blob saved
    before the trigger-source model has no `source`, and we fill the least-surprising default
    rather than dropping anything. Idempotent (a trigger node that already carries a `source` is
    left untouched) and immutable (only changed graphs are rebuilt). NON-pad graphs (authored
    `graph-`/`graph:` keys, or any other) are left untouched — they keep `source` unset until the
    user binds a drum/MIDI/OSC source. Keyed off the actual pad-key set rather than "not named",
    because graphNames now labels pad keys too (so it can't proxy "authored"). */
export function unionTriggerSources(
  graphs: Record<string, TriggerGraph>,
  padKeys: ReadonlySet<string>,
): Record<string, TriggerGraph> {
  const out: Record<string, TriggerGraph> = {};
  for (const [key, graph] of Object.entries(graphs)) {
    out[key] = padKeys.has(key) ? withDrumSource(graph, key) : graph;
  }
  return out;
}

/** Ensure every PAD-keyed graph carries a friendly display name in `graphNames`
    ("Kick · center"), so renames start from a nice label and a restored show never surfaces a
    raw "kick:0" key. Idempotent + non-destructive: a pad key the user already renamed (present
    in `names`) is left untouched — only missing pad-key names are filled. Returns the SAME
    reference when nothing changes (alias-stable, mirrors {@link withDrumSource}). Authored keys
    are named at create/duplicate time, not here. */
export function hydratePadNames(
  graphs: Record<string, TriggerGraph>,
  names: Record<string, string>,
  pads: readonly Pad[],
): Record<string, string> {
  let out: Record<string, string> | null = null;
  for (const p of pads) {
    const key = padKey(p);
    if (key in graphs && !(key in names)) {
      out ??= { ...names };
      out[key] = padLabel(p);
    }
  }
  return out ?? names;
}

/** The full graph back-compat pass the constructor + every show-load runs (idempotent): make
    every pad-bound graph's trigger source explicit, fold legacy velocity switches into the
    canonical value+bands form, and hydrate a friendly display name onto every pad-keyed graph.
    Returns the new `{ graphs, graphNames }` — the store assigns them back into its runes. */
export function normalizeGraphs(
  graphs: Record<string, TriggerGraph>,
  graphNames: Record<string, string>,
  pads: readonly Pad[],
): { graphs: Record<string, TriggerGraph>; graphNames: Record<string, string> } {
  const padKeys = new Set(pads.map(padKey));
  let next = unionTriggerSources(graphs, padKeys);
  next = foldVelocitySwitches(next);
  const names = hydratePadNames(next, graphNames, pads);
  return { graphs: next, graphNames: names };
}
