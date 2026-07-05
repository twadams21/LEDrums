/* Hydration / back-compat unions — the idempotent fix-ups every boot + show-load runs so a
   stale localStorage blob never drops new built-ins or surfaces a raw pad key. PURE (no
   runes/DOM); extracted from store.svelte.ts verbatim. The store wraps these in
   `normalizeGraphs` / `applyAuthored`. */

import {
  type AdsrShape,
  type EaseSpec,
  type EffectDef,
  type EnvMap,
  type GraphEdge,
  type GraphNode,
  type ParamSpec,
  type Preset,
  type TriggerGraph,
  type TriggerSource,
  NODE_W,
  cloneEnvelope,
  foldVelocitySwitches,
  makeNode,
  migrateAdsr,
} from '../sim';
import { voice, resolveEffectAlias } from '@ledrums/core';
import { EFFECTS, PRESETS, type Pad } from '../fixtures';
import { nid } from './ids';
import { padKey, padLabel } from './seed';

/** Union built-in effects with persisted USER-CREATED ones. Hydration must never
    drop new built-ins: a user's blob saved before the 41 generator effects existed
    would otherwise overwrite the fresh registry and hide them forever. So start from
    the fixture EFFECTS (every built-in, always current) and append only persisted
    effects whose id isn't a built-in — the user's own duplicated-effect additions.
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

/** A play node persisted before `linked` was removed still carries the flag; read it via a
    cast (the field is gone from {@link GraphNode}, mirroring `foldVelocitySwitch`'s legacy
    read). */
type MaybeLinked = { linked?: boolean };

/** Look up a preset's params by id — the store threads this in from its `presets` rune. */
export type PresetParamsFor = (presetId: string) => Readonly<Record<string, unknown>> | undefined;

/** Materialize every formerly-`linked:true` play node's params from its shared preset (exactly
    the store's old `toggleLink` unlink branch — copy `preset.params` onto the node, keeping the
    node's own params when the preset is unknown), then drop the `linked` flag from every node so
    the field leaves the model. Presets are now snapshots, not live bindings: after this a node's
    params never depend on a preset at runtime (proven by the eval-graph change).

    Idempotent + alias-stable: a graph whose nodes carry no `linked` field keeps its reference, so
    re-running — or a graph authored after the removal — is a no-op. `presetId` is preserved as a
    provenance label ("based on X" + re-apply); only `linked` is stripped. */
export function materializeLinkedNodes(graph: TriggerGraph, presetParamsFor: PresetParamsFor): TriggerGraph {
  if (!graph.nodes.some((n) => 'linked' in (n as MaybeLinked))) return graph; // nothing to migrate → same ref
  const nodes = graph.nodes.map((n) => {
    if (!('linked' in (n as MaybeLinked))) return n; // already migrated — keep the ref
    const wasLinked = (n as MaybeLinked).linked === true;
    const { linked: _drop, ...rest } = n as GraphNode & MaybeLinked;
    if (wasLinked && n.kind === 'play') {
      const shared = presetParamsFor(n.presetId);
      if (shared) return { ...rest, params: { ...(shared as Record<string, unknown>) } } as GraphNode;
    }
    return rest as GraphNode;
  });
  return { nodes, edges: graph.edges };
}

/** Apply {@link materializeLinkedNodes} across a keyed map of graphs (each unchanged graph keeps
    its reference — alias-stable + idempotent, mirrors {@link foldVelocitySwitches}). */
export function materializeLinkedNodesAll(
  graphs: Record<string, TriggerGraph>,
  presetParamsFor: PresetParamsFor,
): Record<string, TriggerGraph> {
  const out: Record<string, TriggerGraph> = {};
  for (const [key, graph] of Object.entries(graphs)) out[key] = materializeLinkedNodes(graph, presetParamsFor);
  return out;
}

/** Structural equality for two ADSR shapes (times, levels, legacy curve, and each
    per-segment ease by fn/dir) — lets the migrator keep the original object when a
    shape is already normalized, so the pass stays alias-stable. */
function adsrEqual(a: AdsrShape, b: AdsrShape): boolean {
  const easeEq = (x?: EaseSpec, y?: EaseSpec): boolean =>
    (!x && !y) || (!!x && !!y && x.fn === y.fn && x.dir === y.dir);
  return (
    a.attack === b.attack &&
    a.decay === b.decay &&
    a.sustain === b.sustain &&
    a.release === b.release &&
    a.attackLevel === b.attackLevel &&
    a.curve === b.curve &&
    easeEq(a.attackEase, b.attackEase) &&
    easeEq(a.decayEase, b.decayEase) &&
    easeEq(a.releaseEase, b.releaseEase)
  );
}

/** Normalize every play node's persisted {@link AdsrShape} to the v2 form
    (attackLevel + per-segment eases) via the core {@link migrateAdsr} migrator —
    the S23-deferred hydrate wiring, sitting beside {@link foldVelocitySwitch}.
    Behaviour-preserving: `migrateAdsr` never alters a sampled point, so the
    persisted `points` need no regeneration. Idempotent + immutable: a graph with
    no envelope shapes (or already-normalized ones) keeps its reference. */
export function migrateGraphEnvelopes(graph: TriggerGraph): TriggerGraph {
  let graphChanged = false;
  const nodes = graph.nodes.map((n) => {
    if (n.kind !== 'play') return n;
    let envChanged = false;
    const env: EnvMap = {};
    for (const [key, e] of Object.entries(n.env)) {
      if (!e.adsr) {
        env[key] = e;
        continue;
      }
      const migrated = migrateAdsr(e.adsr);
      if (adsrEqual(migrated, e.adsr)) {
        env[key] = e; // already v2 (or a retained-curve shape) — keep the ref
        continue;
      }
      env[key] = { ...e, adsr: migrated };
      envChanged = true;
    }
    if (!envChanged) return n;
    graphChanged = true;
    return { ...n, env };
  });
  return graphChanged ? { nodes, edges: graph.edges } : graph;
}

/** Apply {@link migrateGraphEnvelopes} across a keyed map of graphs (each unchanged
    graph keeps its reference — alias-stable + idempotent, mirrors
    {@link foldVelocitySwitches}). */
export function migrateGraphsEnvelopes(
  graphs: Record<string, TriggerGraph>,
): Record<string, TriggerGraph> {
  const out: Record<string, TriggerGraph> = {};
  for (const [key, graph] of Object.entries(graphs)) out[key] = migrateGraphEnvelopes(graph);
  return out;
}

/** Horizontal gap the migrator leaves between a spawned envelope node and its target play
    node (mirrors `sim.graph-compilation`'s `H_GAP`), plus the vertical stagger when one play
    node migrates several params so their source nodes don't overlap. Cosmetic only — the
    mappings are position-independent. */
const MIGRATE_H_GAP = 90;
const MIGRATE_V_GAP = 120;

/** Effect param specs for a play node's `effectId` (empty when the effect is unknown — a
    persisted graph can reference an effect a later blob dropped; those envs are then inert
    just as the legacy sweep left them, so nothing is migrated). */
export type SpecsFor = (effectId: string) => readonly ParamSpec[];

/**
 * Migrate a play node's LEGACY per-param envelope map (`node.env`) into the S34 modulation
 * graph: each `env[key]` with a live shape becomes an `envelope` SOURCE node (its shape in the
 * `ENVELOPE_NODE_KEY` slot), the key is exposed as a `modInputs` row on the play node, and a
 * `param:<key>` edge carries the equivalent {@link import('@ledrums/core').voice.Mapping}
 * (`amount = env.amount`, no invert, range = the param spec's `[min, max]`) — the exact shape
 * {@link import('@ledrums/core').voice.envelopeToMapping} produces, so pre-migration env
 * behaviour is sample-identical afterwards (proven by the S33 parity fixture). The play node's
 * `env` is then cleared: the legacy runtime sweep is gone, so a leftover entry would be dead.
 *
 * Idempotent + alias-stable: a graph whose play nodes carry no live env entry keeps its
 * reference, so re-running on an already-migrated graph is a no-op (migrated play nodes have an
 * empty `env`). Only play nodes are touched — envelope/modifier `env` (the source-shape slot and
 * the modifier bridge) is left intact. Never throws: an env on an unknown / non-number param is
 * silently dropped, exactly as the sweep ignored it.
 */
export function migrateGraphEnvMaps(graph: TriggerGraph, specsFor: SpecsFor): TriggerGraph {
  // Any play node still carrying an `env` map is un-migrated (post-migration play env is `{}`), so
  // its mere presence is the trigger — including a map with only inert (`none` / non-number)
  // entries, which must still be cleared or the pass would never reach its fixed point.
  const hasLegacyEnv = graph.nodes.some((n) => n.kind === 'play' && Object.keys(n.env).length > 0);
  if (!hasLegacyEnv) return graph; // nothing to migrate → same reference (idempotent)

  const nodes: GraphNode[] = [];
  const addedEdges: GraphEdge[] = [];
  for (const n of graph.nodes) {
    if (n.kind !== 'play' || Object.keys(n.env).length === 0) {
      nodes.push(n); // non-play, or an already-migrated play node — untouched (alias-stable)
      continue;
    }
    const specs = specsFor(n.effectId);
    const modInputs = [...(n.modInputs ?? [])];
    let placed = 0;
    for (const [key, env] of Object.entries(n.env)) {
      if (!env || env.kind === 'none') continue; // no envelope authored on this param
      const spec = specs.find((s) => s.key === key);
      if (!spec || spec.kind !== 'number') continue; // inert in the legacy sweep → drop, no node
      const src = makeNode('envelope', nid('n'), n.x - (NODE_W + MIGRATE_H_GAP), n.y + placed * MIGRATE_V_GAP, {
        env: { [voice.ENVELOPE_NODE_KEY]: cloneEnvelope(env) },
      });
      nodes.push(src);
      placed += 1;
      if (!modInputs.some((m) => m.param === key)) modInputs.push({ param: key });
      // One `param:<key>` edge IS one mapping — bake the equivalent of `envelopeToMapping`
      // (the store's `connect` does the same at authoring time).
      addedEdges.push({
        id: nid('e'),
        from: src.id,
        to: n.id,
        toPort: `param:${key}`,
        amount: env.amount,
        invert: false,
        rangeMin: spec.min ?? 0,
        rangeMax: spec.max ?? 1,
      });
    }
    // Drop the legacy field now that its behaviour lives on the mappings (no dual mechanism);
    // extend the exposed rows only when a param was actually wired.
    nodes.push(placed > 0 ? { ...n, env: {}, modInputs } : { ...n, env: {} });
  }
  return { nodes, edges: [...graph.edges, ...addedEdges] };
}

/** Apply {@link migrateGraphEnvMaps} across a keyed map of graphs (each unchanged graph keeps
    its reference — alias-stable + idempotent, mirrors {@link migrateGraphsEnvelopes}). */
export function migrateGraphsEnvMaps(
  graphs: Record<string, TriggerGraph>,
  specsFor: SpecsFor,
): Record<string, TriggerGraph> {
  const out: Record<string, TriggerGraph> = {};
  for (const [key, graph] of Object.entries(graphs)) out[key] = migrateGraphEnvMaps(graph, specsFor);
  return out;
}

/** Rewrite every play node's `effectId` (and its `presetId` prefix) through the effect
    alias map so a retired id resolves to its live replacement. Pure + idempotent — only
    touches graphs that actually reference an aliased id, so it's free when the map is empty. */
export function resolveGraphAliases(
  graphs: Record<string, TriggerGraph>,
): Record<string, TriggerGraph> {
  const out: Record<string, TriggerGraph> = {};
  for (const [key, graph] of Object.entries(graphs)) {
    let changed = false;
    const nodes = graph.nodes.map((n) => {
      if (n.kind !== 'play' || !n.effectId) return n;
      const resolved = resolveEffectAlias(n.effectId);
      if (resolved === n.effectId) return n;
      changed = true;
      // Retarget the preset ref to the new effect's Default unless it already points elsewhere
      // valid; the safe, always-resolvable choice is the replacement's `:default`.
      return { ...n, effectId: resolved, presetId: `${resolved}:default` };
    });
    out[key] = changed ? { ...graph, nodes } : graph;
  }
  return out;
}

/** The full graph back-compat pass the constructor + every show-load runs (idempotent): make
    every pad-bound graph's trigger source explicit, materialize formerly-linked play nodes' params
    and drop the `linked` flag, fold legacy velocity switches into the canonical value+bands form,
    migrate persisted envelope shapes to v2, and hydrate a friendly display name onto every
    pad-keyed graph. Returns the new `{ graphs, graphNames }` — the store assigns them back into its
    runes. */
export function normalizeGraphs(
  graphs: Record<string, TriggerGraph>,
  graphNames: Record<string, string>,
  pads: readonly Pad[],
  specsFor: SpecsFor,
  presetParamsFor: PresetParamsFor,
): { graphs: Record<string, TriggerGraph>; graphNames: Record<string, string> } {
  const padKeys = new Set(pads.map(padKey));
  // Consult the effect alias map FIRST (D1, locked decision 1): a show referencing a
  // retired effect id has its play nodes rewritten to the live target before anything
  // else resolves them. Empty map today (U3 populates it) → an identity pass for now.
  let next = resolveGraphAliases(graphs);
  next = unionTriggerSources(next, padKeys);
  // Materialize formerly-linked play nodes' params from their preset, then drop `linked` (S39) —
  // before the env/switch folds so every later pass sees node-local params.
  next = materializeLinkedNodesAll(next, presetParamsFor);
  next = foldVelocitySwitches(next);
  next = migrateGraphsEnvelopes(next);
  // AFTER the ADSR-v2 normalize (so envelope nodes carry v2 shapes): fold legacy play-node
  // env maps into envelope nodes + `param:<key>` mappings, then drop the legacy field (S35).
  next = migrateGraphsEnvMaps(next, specsFor);
  const names = hydratePadNames(next, graphNames, pads);
  return { graphs: next, graphNames: names };
}
