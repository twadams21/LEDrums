/* ClipDoc — one portable envelope for copy/paste of trigger graphs, sections, songs, and the
   patch across browser sessions / servers (doc 11). A PURE module (no runes, no DOM, no
   clipboard IO) so the serialize / parse / remap contract is unit-testable in node, like
   persistence / setlist / song-library. The system clipboard (S44) and a future file
   export/import are just adapters over this format — this module is the seam.

   THREE responsibilities:
     1. build + serialize — lift an authored thing (graph/section/song) plus its dependency
        CLOSURE into a versioned envelope. The closure is extracted through the SHARED S40
        code (`extractSongClosure`), so the clipboard closure can never drift from the library
        closure; we un-namespace its output so the envelope carries the source's raw ids
        (built-in effect ids stay recognizable, remap stays simple).
     2. parse — defensively read arbitrary clipboard text into a ClipDoc, NEVER throwing
        (mirrors `deserializeShowLibrary`): foreign / malformed / wrong-version text yields a
        typed {@link ClipParseError}, so the paste UI can toast rather than crash.
     3. remap-on-materialize — graph placements always receive fresh graph keys and detached graph
        objects. Other reusable dependencies may reuse local content, and built-in effect ids stay
        canonical. Explicit linking is a section-placement action, never an implicit paste result.
        Every graph source key is cloned once per paste operation, so repeated references remain
        links inside the pasted section/song.
        (`nid`/`freshId`), EXCEPT (a) a dep whose CONTENT already exists locally (reuse it), and (b) built-in
        effect ids (registry-backed shared vocabulary — never re-keyed even when content
        differs). Every internal ref (section->graph keys, play-node effect/preset ids,
        preset->effect, look effect ids) is rewritten through the remap table; node/edge ids
        and modulation `param:`/`mod` ports are graph-internal and travel verbatim, so modifier
        wiring and modulation edges survive intact.

   Scope (S43): the pure module + tests. Clipboard IO + context menus are S44; the patch
   `setProject` server apply is S45 — here the `patch` kind only round-trips (no remap). */

import type { EffectDef, Preset, TriggerGraph, GraphNode } from './sim';
import { makeSection, type SetlistSection, type Song } from '../app/setlist';
import type { Project, CanvasScene } from '@ledrums/core';
import { canvasEffectId, canvasSceneIdOf, effectChain } from '@ledrums/core';
import { extractSongClosure, songNamespace, type ClosureSources } from './store/song-library';
import { migrateGraphHoopTargets, migrateGraphsHoopTargets } from './persistence';
import { freshEffectId } from './store/objects';
import { freshId, nid } from './store/ids';

// ---- envelope ---------------------------------------------------------------

export const CLIPDOC_APP = 'ledrums';
/** Envelope version. v2 (B6/A1): hoop-scoped node targetIds moved 0-based → 1-based. A v1 doc is
    still accepted on {@link parse} and its hoop targetIds shifted +1 (see {@link CLIPDOC_PRIOR_VERSION});
    a foreign/newer version is rejected. {@link serialize} always stamps the current version. */
export const CLIPDOC_VERSION = 2;

/** The one prior envelope version {@link parse} still accepts, upgrading a pasted v1 doc's hoop
    targetIds in place (0-based → 1-based) rather than rejecting it as unsupported. */
export const CLIPDOC_PRIOR_VERSION = 1;

export type ClipDocKind = 'graph' | 'node' | 'section' | 'song' | 'patch' | 'effect' | 'cell' | 'device';

/** Provenance stamped on export — advisory only (never gates parse/remap). */
export interface ClipDocMeta {
  exportedAt: string;
  appVersion?: string;
  /** the show the content was copied FROM (for a "pasted from …" hint), when known. */
  sourceShow?: string;
}

/** The dependency closure carried beside an authored payload — exactly the reusable
    building blocks the payload references (a graph's effects/presets; a section/song's graphs
    + their effects/presets). Every field optional so a defensively-parsed doc degrades to what
    survived. Keyed/typed identically to a {@link import('./store/song-library').LibrarySong}
    closure (they are extracted by the same code) minus the namespacing. */
export interface ClipDocDeps {
  graphs?: Record<string, TriggerGraph>;
  graphNames?: Record<string, string>;
  effects?: EffectDef[];
  presets?: Preset[];
  /** Canvas scene docs referenced by any canvas play node in the payload/deps graphs (U5), so a
      pasted graph/section/song renders on another show/server (its `canvas:<id>` resolves). */
  canvasScenes?: CanvasScene[];
}

/** Scene ids referenced by a graph's canvas play nodes (`node.canvasScene`, or the scene id
    inside a `canvas:<id>` effect id for older nodes). */
function graphSceneRefs(graph: TriggerGraph): Set<string> {
  const out = new Set<string>();
  for (const node of graph.nodes) {
    if (node.kind !== 'play' && node.kind !== 'effect') continue;
    const sceneId = node.canvasScene ?? canvasSceneIdOf(node.effectId) ?? undefined;
    if (sceneId) out.add(sceneId);
  }
  return out;
}

/** Custom effects a graph's SPLICE slots host. A slot names its effect directly (it has no
    preset), and the shared closure walk only follows Effect nodes, so without this a saved Splice
    would arrive in another show pointing at an effect that isn't there. Built-ins are harmless to
    carry: remap keeps their ids. Canvas slots are left out — their `canvas:<id>` is a scene ref. */
function spliceSlotEffects(graphs: Record<string, TriggerGraph>, sources: ClosureSources, carried: readonly EffectDef[]): EffectDef[] {
  const have = new Set(carried.map((effect) => effect.id));
  const out: EffectDef[] = [];
  for (const graph of Object.values(graphs)) {
    for (const node of graph.nodes) {
      for (const slot of node.splices ?? []) {
        if (!slot.effectId || slot.canvasScene || have.has(slot.effectId)) continue;
        const def = sources.effects.find((effect) => effect.id === slot.effectId);
        if (!def) continue;
        have.add(def.id);
        out.push(structuredClone(def));
      }
    }
  }
  return out;
}

/** The scene docs referenced across a set of graphs (deep-copied for the envelope). */
function scenesForGraphs(
  graphs: Record<string, TriggerGraph>,
  scenes: readonly CanvasScene[] | undefined,
): CanvasScene[] {
  const wanted = new Set<string>();
  for (const graph of Object.values(graphs)) for (const id of graphSceneRefs(graph)) wanted.add(id);
  if (wanted.size === 0) return [];
  return (scenes ?? []).filter((scene) => wanted.has(scene.id)).map((scene) => structuredClone(scene));
}

/** The Project slices a patch ClipDoc carries (doc 11): kit geometry incl. outputs, the input
    map, and output settings. Whole-document — applied wholesale by S45, never remapped. */
export type PatchPayload = Pick<Project, 'kit' | 'inputMap' | 'output'> & { name?: string };

export interface GraphClipDoc {
  app: typeof CLIPDOC_APP;
  v: typeof CLIPDOC_VERSION;
  kind: 'graph';
  /** the graph is the payload; its effects/presets ride in {@link deps}. */
  payload: { key: string; graph: TriggerGraph; name?: string };
  deps: ClipDocDeps;
  meta: ClipDocMeta;
}

/** One node and the effects/presets/scenes it uses — what the inspector's Save node writes. Its
    wires are not carried: they name nodes that only exist in the graph it came from. */
export interface NodeClipDoc {
  app: typeof CLIPDOC_APP;
  v: typeof CLIPDOC_VERSION;
  kind: 'node';
  payload: { node: GraphNode };
  deps: ClipDocDeps;
  meta: ClipDocMeta;
}

export interface SectionClipDoc {
  app: typeof CLIPDOC_APP;
  v: typeof CLIPDOC_VERSION;
  kind: 'section';
  payload: { section: SetlistSection };
  deps: ClipDocDeps;
  meta: ClipDocMeta;
}

export interface SongClipDoc {
  app: typeof CLIPDOC_APP;
  v: typeof CLIPDOC_VERSION;
  kind: 'song';
  payload: { song: Song };
  deps: ClipDocDeps;
  meta: ClipDocMeta;
}

export interface PatchClipDoc {
  app: typeof CLIPDOC_APP;
  v: typeof CLIPDOC_VERSION;
  kind: 'patch';
  payload: { patch: PatchPayload };
  meta: ClipDocMeta;
}

/** One authored Effect (effect chains) and the canvas scenes its Generators play. */
export interface EffectClipDoc {
  app: typeof CLIPDOC_APP;
  v: typeof CLIPDOC_VERSION;
  kind: 'effect';
  payload: { effect: effectChain.Effect };
  deps: ClipDocDeps;
  meta: ClipDocMeta;
}

/** A cell's whole stack, in stack order, and the scenes it plays. `cell` is where it was saved
    from — advisory: a load places the stack into whichever cell the user picked. */
export interface CellClipDoc {
  app: typeof CLIPDOC_APP;
  v: typeof CLIPDOC_VERSION;
  kind: 'cell';
  payload: { cell: effectChain.EffectCell; effects: effectChain.Effect[] };
  deps: ClipDocDeps;
  meta: ClipDocMeta;
}

/** A single device of an Effect chain. */
export type EffectDevicePayload =
  | { device: 'generator'; generator: effectChain.GeneratorDevice }
  | { device: 'modifier'; modifier: effectChain.ModifierDevice }
  | { device: 'control'; control: effectChain.ControlDevice };

export interface DeviceClipDoc {
  app: typeof CLIPDOC_APP;
  v: typeof CLIPDOC_VERSION;
  kind: 'device';
  payload: EffectDevicePayload;
  deps: ClipDocDeps;
  meta: ClipDocMeta;
}

/** The effect-chain kinds: they carry only canvas scenes as deps and go through
    {@link remapEffectsClipDoc}, not {@link remapClipDoc}. */
export type EffectsClipDoc = EffectClipDoc | CellClipDoc | DeviceClipDoc;

export type ClipDoc = GraphClipDoc | NodeClipDoc | SectionClipDoc | SongClipDoc | PatchClipDoc | EffectsClipDoc;
/** The authored kinds that carry a dependency closure and go through {@link remapClipDoc}. */
export type AuthoredClipDoc = GraphClipDoc | NodeClipDoc | SectionClipDoc | SongClipDoc;

// ---- build (authored kinds) -------------------------------------------------

/* The namespace root fed to the SHARED closure extraction. Its only job is a collision-free id
   space during the walk; we strip it right back out (see stripNamespace), so the value is
   irrelevant to the envelope — it never appears in the serialized doc. */
const CLIP_NS_ID = 'clip';
const CLIP_PREFIX = songNamespace(CLIP_NS_ID);

function meta(over?: Partial<ClipDocMeta>): ClipDocMeta {
  return { exportedAt: new Date().toISOString(), ...over };
}

/** Extract a song's closure through the SHARED S40 code, then un-namespace it so the envelope
    carries the source's RAW ids. Equivalence with `extractSongClosure` is by construction — this
    IS that function, followed by a mechanical prefix strip. */
function rawClosure(song: Song, sources: ClosureSources): {
  sections: SetlistSection[];
  graphs: Record<string, TriggerGraph>;
  graphNames: Record<string, string>;
  effects: EffectDef[];
  presets: Preset[];
} {
  const closure = extractSongClosure(song, sources, CLIP_NS_ID);
  return stripNamespace(closure, CLIP_PREFIX);
}

/** Remove the closure namespace prefix from every id/ref extractSongClosure added, recovering
    the source's raw ids. Fields the extraction leaves un-prefixed (busId keys, modifierId,
    generatorId, source, node/edge ids) are untouched here too. */
function stripNamespace(
  closure: ReturnType<typeof extractSongClosure>,
  prefix: string,
): { sections: SetlistSection[]; graphs: Record<string, TriggerGraph>; graphNames: Record<string, string>; effects: EffectDef[]; presets: Preset[] } {
  const s = (v: string): string => (v.startsWith(prefix) ? v.slice(prefix.length) : v);

  const graphs: Record<string, TriggerGraph> = {};
  for (const [key, g] of Object.entries(closure.graphs)) {
    graphs[s(key)] = {
      nodes: g.nodes.map((n) => ({ ...n, effectId: s(n.effectId), presetId: s(n.presetId) })),
      edges: g.edges.map((e) => ({ ...e })),
    };
  }
  const graphNames: Record<string, string> = {};
  for (const [key, name] of Object.entries(closure.graphNames)) graphNames[s(key)] = name;

  const effects = closure.effects.map((e) => ({ ...e, id: s(e.id) }));
  const presets = closure.presets.map((p) => ({ ...p, id: s(p.id), effectId: s(p.effectId) }));
  const sections = closure.sections.map((sec) => ({
    id: s(sec.id),
    name: sec.name,
    graphs: sec.graphs.map(s),
    looks: mapLooks(sec.looks, s),
  }));
  return { sections, graphs, graphNames, effects, presets };
}

function mapLooks(looks: Record<string, string | null>, fn: (v: string) => string): Record<string, string | null> {
  const out: Record<string, string | null> = {};
  for (const [busId, v] of Object.entries(looks)) out[busId] = v === null ? null : fn(v);
  return out;
}

/** Build a graph ClipDoc: the graph is the payload, its reached effects/presets are the deps.
    `key` must exist in `sources.graphs`. */
export function buildGraphClipDoc(key: string, sources: ClosureSources, over?: Partial<ClipDocMeta>): GraphClipDoc {
  const synthetic: Song = { id: CLIP_NS_ID, name: '', sections: [{ id: `${CLIP_NS_ID}-s`, name: '', graphs: [key], looks: {} }] };
  const raw = rawClosure(synthetic, sources);
  const graph = raw.graphs[key] ?? { nodes: [], edges: [] };
  const payload: GraphClipDoc['payload'] = { key, graph };
  if (raw.graphNames[key] !== undefined) payload.name = raw.graphNames[key];
  const effects = [...raw.effects, ...spliceSlotEffects(raw.graphs, sources, raw.effects)];
  return {
    app: CLIPDOC_APP,
    v: CLIPDOC_VERSION,
    kind: 'graph',
    payload,
    deps: { effects, presets: raw.presets, canvasScenes: scenesForGraphs(raw.graphs, sources.canvasScenes) },
    meta: meta(over),
  };
}

/** Build a node ClipDoc: the node is the payload, the effects/presets/scenes it reaches the deps.
    Rides the graph builder on a one-node graph, so a node's closure is extracted by exactly the
    code a graph's is. */
export function buildNodeClipDoc(node: GraphNode, sources: ClosureSources, over?: Partial<ClipDocMeta>): NodeClipDoc {
  const key = `${CLIP_NS_ID}-node`;
  const graphDoc = buildGraphClipDoc(key, { ...sources, graphs: { [key]: { nodes: [node], edges: [] } } }, over);
  return {
    app: CLIPDOC_APP,
    v: CLIPDOC_VERSION,
    kind: 'node',
    payload: { node: graphDoc.payload.graph.nodes[0] ?? node },
    deps: graphDoc.deps,
    meta: graphDoc.meta,
  };
}

/** Build a section ClipDoc: the section is the payload, its graphs' closure are the deps. */
export function buildSectionClipDoc(section: SetlistSection, sources: ClosureSources, over?: Partial<ClipDocMeta>): SectionClipDoc {
  const synthetic: Song = { id: CLIP_NS_ID, name: '', sections: [section] };
  const raw = rawClosure(synthetic, sources);
  return {
    app: CLIPDOC_APP,
    v: CLIPDOC_VERSION,
    kind: 'section',
    payload: { section: raw.sections[0] ?? { id: section.id, name: section.name, graphs: [], looks: {} } },
    deps: {
      graphs: raw.graphs,
      graphNames: raw.graphNames,
      effects: [...raw.effects, ...spliceSlotEffects(raw.graphs, sources, raw.effects)],
      presets: raw.presets,
      canvasScenes: scenesForGraphs(raw.graphs, sources.canvasScenes),
    },
    meta: meta(over),
  };
}

/** Build a song ClipDoc: the song (its sections) is the payload, its full closure the deps. */
export function buildSongClipDoc(song: Song, sources: ClosureSources, over?: Partial<ClipDocMeta>): SongClipDoc {
  const raw = rawClosure(song, sources);
  return {
    app: CLIPDOC_APP,
    v: CLIPDOC_VERSION,
    kind: 'song',
    payload: { song: { id: song.id, name: song.name, sections: raw.sections } },
    deps: {
      graphs: raw.graphs,
      graphNames: raw.graphNames,
      effects: [...raw.effects, ...spliceSlotEffects(raw.graphs, sources, raw.effects)],
      presets: raw.presets,
      canvasScenes: scenesForGraphs(raw.graphs, sources.canvasScenes),
    },
    meta: meta(over),
  };
}

/** Build a patch ClipDoc from the Project slices. Whole-document; carried verbatim (S45 applies). */
export function buildPatchClipDoc(patch: PatchPayload, over?: Partial<ClipDocMeta>): PatchClipDoc {
  return { app: CLIPDOC_APP, v: CLIPDOC_VERSION, kind: 'patch', payload: { patch }, meta: meta(over) };
}

/** Serialize a ClipDoc to clipboard text (JSON). The inverse of {@link parse}. */
export function serialize(doc: ClipDoc): string {
  return JSON.stringify(doc);
}

// ---- parse (defensive, never throws) ----------------------------------------

export type ClipParseReason = 'not-json' | 'not-object' | 'foreign' | 'unsupported-version' | 'unknown-kind' | 'malformed' | 'unresolved-dependency';

export interface ClipParseError {
  parseError: true;
  reason: ClipParseReason;
  message: string;
}

export function isClipParseError(x: unknown): x is ClipParseError {
  return typeof x === 'object' && x !== null && (x as ClipParseError).parseError === true;
}

const isObject = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);

function err(reason: ClipParseReason, message: string): ClipParseError {
  return { parseError: true, reason, message };
}

/**
 * Parse arbitrary clipboard text into a ClipDoc, NEVER throwing (the paste UI can only ever
 * see a value or a typed error). Version-tolerant + unknown-field-tolerant like the persistence
 * loaders: the envelope is validated (app tag, version, known kind, payload shape), each field
 * coerced defensively, and anything unrecognized becomes a {@link ClipParseError} the caller
 * turns into a friendly toast — a non-ClipDoc paste is a no-op, not a crash.
 */
export function parse(text: string): ClipDoc | ClipParseError {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    return err('not-json', 'Clipboard did not contain JSON.');
  }
  if (!isObject(raw)) return err('not-object', 'Clipboard JSON was not an object.');
  if (raw.app !== CLIPDOC_APP) return err('foreign', 'Not a LEDrums clipboard payload.');
  if (raw.v !== CLIPDOC_VERSION && raw.v !== CLIPDOC_PRIOR_VERSION)
    return err('unsupported-version', `Unsupported ClipDoc version: ${String(raw.v)}.`);
  if (!isObject(raw.payload)) return err('malformed', 'ClipDoc payload missing.');

  const metaOut = coerceMeta(raw.meta);
  const doc = coerceKind(raw.kind, raw.payload, raw.deps, metaOut);
  if (isClipParseError(doc)) return doc;
  // v1 → v2: a pasted doc authored before A1 carries 0-based hoop targetIds; shift them +1 so the
  // pasted clip lights the SAME physical hoop. Version-gated (v2 docs are already 1-based → no
  // double shift); serialize re-stamps CLIPDOC_VERSION so a re-copied clip is v2.
  return raw.v === CLIPDOC_PRIOR_VERSION ? migrateClipDocHoopTargets(doc) : doc;
}

function coerceKind(kind: unknown, payload: Record<string, unknown>, deps: unknown, m: ClipDocMeta): ClipDoc | ClipParseError {
  switch (kind) {
    case 'graph':
      return coerceGraphDoc(payload, deps, m);
    case 'node':
      return coerceNodeDoc(payload, deps, m);
    case 'section':
      return coerceSectionDoc(payload, deps, m);
    case 'song':
      return coerceSongDoc(payload, deps, m);
    case 'patch':
      return coercePatchDoc(payload, m);
    case 'effect':
      return coerceEffectDoc(payload, deps, m);
    case 'cell':
      return coerceCellDoc(payload, deps, m);
    case 'device':
      return coerceDeviceDoc(payload, deps, m);
    default:
      return err('unknown-kind', `Unknown ClipDoc kind: ${String(kind)}.`);
  }
}

/** Shift a parsed doc's hoop targetIds 0-based → 1-based (B6/A1). Graph node data lives only in a
    graph payload and in `deps.graphs` (section/song payloads reference graph keys, not inline
    nodes); a patch doc carries no trigger graphs. Reuses the persistence-layer graph walker so the
    show-schema and clipboard migrations can never drift. */
function migrateClipDocHoopTargets(doc: ClipDoc): ClipDoc {
  // Effect-chain kinds post-date v2 and carry 1-based hoop numbers by schema; nothing to shift.
  if (doc.kind === 'patch' || isEffectsClipDoc(doc)) return doc;
  const deps: ClipDocDeps = doc.deps.graphs
    ? { ...doc.deps, graphs: migrateGraphsHoopTargets(doc.deps.graphs) }
    : doc.deps;
  if (doc.kind === 'graph') {
    return { ...doc, payload: { ...doc.payload, graph: migrateGraphHoopTargets(doc.payload.graph) }, deps };
  }
  if (doc.kind === 'node') {
    const node = migrateGraphHoopTargets({ nodes: [doc.payload.node], edges: [] }).nodes[0] ?? doc.payload.node;
    return { ...doc, payload: { node }, deps };
  }
  return { ...doc, deps };
}

function coerceMeta(raw: unknown): ClipDocMeta {
  if (!isObject(raw)) return { exportedAt: '' };
  const out: ClipDocMeta = { exportedAt: typeof raw.exportedAt === 'string' ? raw.exportedAt : '' };
  if (typeof raw.appVersion === 'string') out.appVersion = raw.appVersion;
  if (typeof raw.sourceShow === 'string') out.sourceShow = raw.sourceShow;
  return out;
}

function coerceDeps(raw: unknown): ClipDocDeps {
  if (!isObject(raw)) return {};
  const out: ClipDocDeps = {};
  if (isObject(raw.graphs)) out.graphs = raw.graphs as Record<string, TriggerGraph>;
  if (isObject(raw.graphNames)) out.graphNames = raw.graphNames as Record<string, string>;
  if (Array.isArray(raw.effects)) out.effects = raw.effects as EffectDef[];
  if (Array.isArray(raw.presets)) out.presets = raw.presets as Preset[];
  if (Array.isArray(raw.canvasScenes)) out.canvasScenes = raw.canvasScenes as CanvasScene[];
  return out;
}

function coerceGraphDoc(payload: Record<string, unknown>, deps: unknown, m: ClipDocMeta): GraphClipDoc | ClipParseError {
  if (typeof payload.key !== 'string' || !isObject(payload.graph)) return err('malformed', 'Graph payload missing key/graph.');
  const graph = payload.graph as unknown as TriggerGraph;
  if (!Array.isArray(graph.nodes) || !Array.isArray(graph.edges)) return err('malformed', 'Graph payload malformed.');
  const out: GraphClipDoc = { app: CLIPDOC_APP, v: CLIPDOC_VERSION, kind: 'graph', payload: { key: payload.key, graph }, deps: coerceDeps(deps), meta: m };
  if (typeof payload.name === 'string') out.payload.name = payload.name;
  return out;
}

function coerceNodeDoc(payload: Record<string, unknown>, deps: unknown, m: ClipDocMeta): NodeClipDoc | ClipParseError {
  const raw = payload.node;
  if (!isObject(raw) || typeof raw.kind !== 'string' || typeof raw.id !== 'string') return err('malformed', 'Node payload missing kind/id.');
  // `play` is the legacy Effect kind — hydrate renames it in a graph, so rename it here too.
  const node = (raw.kind === 'play' ? { ...raw, kind: 'effect' } : raw) as unknown as GraphNode;
  return { app: CLIPDOC_APP, v: CLIPDOC_VERSION, kind: 'node', payload: { node }, deps: coerceDeps(deps), meta: m };
}

function coerceSectionDoc(payload: Record<string, unknown>, deps: unknown, m: ClipDocMeta): SectionClipDoc | ClipParseError {
  const section = coerceSection(payload.section);
  if (!section) return err('malformed', 'Section payload malformed.');
  return { app: CLIPDOC_APP, v: CLIPDOC_VERSION, kind: 'section', payload: { section }, deps: coerceDeps(deps), meta: m };
}

function coerceSongDoc(payload: Record<string, unknown>, deps: unknown, m: ClipDocMeta): SongClipDoc | ClipParseError {
  if (!isObject(payload.song)) return err('malformed', 'Song payload missing.');
  const song = payload.song;
  if (typeof song.id !== 'string' || !Array.isArray(song.sections)) return err('malformed', 'Song payload malformed.');
  const sections: SetlistSection[] = [];
  const sectionIds = new Set<string>();
  for (const raw of song.sections) {
    const sec = coerceSection(raw);
    if (sec && !sectionIds.has(sec.id)) {
      sectionIds.add(sec.id);
      sections.push(sec);
    }
  }
  const name = typeof song.name === 'string' ? song.name : '';
  return { app: CLIPDOC_APP, v: CLIPDOC_VERSION, kind: 'song', payload: { song: { id: song.id, name, sections } }, deps: coerceDeps(deps), meta: m };
}

function coercePatchDoc(payload: Record<string, unknown>, m: ClipDocMeta): PatchClipDoc | ClipParseError {
  if (!isObject(payload.patch)) return err('malformed', 'Patch payload missing.');
  // Deep validation is S45's server-side zod pass; here we only confirm the envelope carries a
  // patch object (kit at minimum) and round-trip it verbatim.
  const patch = payload.patch;
  if (!isObject(patch.kit)) return err('malformed', 'Patch payload missing kit.');
  return { app: CLIPDOC_APP, v: CLIPDOC_VERSION, kind: 'patch', payload: { patch: patch as unknown as PatchPayload }, meta: m };
}

/** Coerce a persisted/pasted section defensively — mirrors persistence.coerceLooks / migrateSongs:
    a non-object or id-less entry is unusable (null → dropped by the caller); otherwise keep the
    string graph refs + the string|null look values that survived. */
function coerceSection(raw: unknown): SetlistSection | null {
  if (!isObject(raw) || typeof raw.id !== 'string' || !raw.id) return null;
  const graphs = Array.isArray(raw.graphs) ? raw.graphs.filter((k): k is string => typeof k === 'string') : [];
  const looks: Record<string, string | null> = {};
  if (isObject(raw.looks)) {
    for (const [busId, v] of Object.entries(raw.looks)) {
      if (typeof v === 'string' || v === null) looks[busId] = v;
    }
  }
  // External ClipDocs use the same ordered-set identity as the in-app model. Sanitizing here keeps
  // a malformed payload from manufacturing two UI rows for one `(song, section, graphKey)`.
  return makeSection(raw.id, typeof raw.name === 'string' ? raw.name : '', graphs, looks);
}

// ---- remap on materialize ---------------------------------------------------

/** The local show state a paste reconciles against — its graphs/effects/presets and which effect
    ids are built-in registry vocabulary (never re-keyed). Graphs themselves are always detached. */
export interface RemapContext {
  graphs: Record<string, TriggerGraph>;
  effects: readonly EffectDef[];
  presets: readonly Preset[];
  /** Local canvas scenes — for content-reuse: a pasted scene identical to a local one reuses its
      id (so A→B→A round-trips and double-pastes create no duplicate scene). */
  canvasScenes?: readonly CanvasScene[];
  /** Section ids already present in the destination resolved view. */
  sectionIds?: readonly string[];
  /** True for a registry-backed effect id (pattern + generator fixtures) — shared vocabulary
      present in every show, so its id is kept verbatim even if the incoming content differs. */
  isBuiltInEffectId: (id: string) => boolean;
  /** Fresh-id minter per domain. Defaults to the reservation-safe {@link makeDefaultMint}
      (real `nid`/`freshId`); injected in tests for determinism. */
  mint?: RemapMint;
}

export interface RemapMint {
  graph(): string;
  effect(name: string): string;
  preset(): string;
  section(): string;
  song(): string;
  scene(): string;
}

/** The reservation-safe default minter — graph/preset ids survive reload via {@link freshId}
    against the (post-merge) local sets; effect ids stay name-derived + unique; section/song ids
    come off the shared monotonic counter. Effect minting also dedups against ids minted EARLIER
    in the same pass (`freshEffectId` is name-derived, not counter-backed, so without this two
    same-name effects in one closure would mint the same id — the other minters are immune). */
export function makeDefaultMint(ctx: Pick<RemapContext, 'graphs' | 'effects' | 'presets' | 'canvasScenes' | 'sectionIds'>): RemapMint {
  const mintedEffectIds = new Set<string>();
  const mintedSceneIds = new Set<string>();
  const usedSectionIds = new Set(ctx.sectionIds ?? []);
  return {
    graph: () => freshId('graph', (k) => k in ctx.graphs),
    effect: (name) => {
      const id = freshEffectId([...ctx.effects, ...[...mintedEffectIds].map((eid) => ({ id: eid }) as EffectDef)], name);
      mintedEffectIds.add(id);
      return id;
    },
    preset: () => freshId('preset', (k) => ctx.presets.some((p) => p.id === k)),
    section: () => {
      let id = nid('section');
      while (usedSectionIds.has(id)) id = nid('section');
      usedSectionIds.add(id);
      return id;
    },
    song: () => nid('song'),
    scene: () => {
      const id = freshId('scene', (k) => (ctx.canvasScenes ?? []).some((s) => s.id === k) || mintedSceneIds.has(k));
      mintedSceneIds.add(id);
      return id;
    },
  };
}

/** The materialized result of a paste: the NEW detached graph closure to union into the show plus
    the primary object with every ref rewritten to its final local id. The
    store (S44) unions the closure and inserts the primary; this function stays pure. */
export interface RemapResult {
  kind: 'graph' | 'node' | 'section' | 'song';
  /** fresh graphs to add (key -> graph, refs already remapped). Every pasted graph is fresh. */
  graphs: Record<string, TriggerGraph>;
  graphNames: Record<string, string>;
  /** fresh (non-builtin, non-reused) effects to add. */
  effects: EffectDef[];
  /** fresh/derived presets to add. */
  presets: Preset[];
  /** fresh (non-reused) canvas scenes to add. */
  canvasScenes: CanvasScene[];
  /** kind 'graph': the fresh graph key to reference. */
  graphKey?: string;
  /** kind 'node': the node with its effect/preset/scene refs rewritten (its id is the file's —
      the caller mints or keeps a local one). */
  node?: GraphNode;
  /** kind 'section': the fresh section with graph refs + looks remapped. */
  section?: SetlistSection;
  /** kind 'song': the fresh song with its sections remapped. */
  song?: Song;
}

/**
 * Materialize an authored ClipDoc against a local show. Builds the remap table in dependency
 * order (effects -> presets -> graphs -> sections/song); every incoming graph is mapped to a
 * fresh local id, while reusable library dependencies may retain their canonical/local id.
 * Node/edge ids and
 * modulation `param:`/`mod` ports are graph-internal and copied verbatim, so modifier wiring and
 * modulation edges survive. Returns a typed error for the non-authored `patch` kind (S45 owns it).
 */
export function remapClipDoc(doc: ClipDoc, ctx: RemapContext): RemapResult | ClipParseError {
  if (doc.kind === 'patch') return err('unknown-kind', 'Patch ClipDocs are applied wholesale, not remapped.');
  if (isEffectsClipDoc(doc)) return err('unknown-kind', 'Effect-chain ClipDocs are remapped by remapEffectsClipDoc.');
  const mint = ctx.mint ?? makeDefaultMint(ctx);

  const out: RemapResult = { kind: doc.kind, graphs: {}, graphNames: {}, effects: [], presets: [], canvasScenes: [] };

  // (0) Canvas scenes: reuse a content-identical local scene, else mint a fresh id. Canvas play
  //     nodes are then rewritten (canvasScene + `canvas:<id>` effect/preset ids) through this map.
  const sceneMap = new Map<string, string>();
  for (const scene of doc.deps.canvasScenes ?? []) {
    const reuse = (ctx.canvasScenes ?? []).find((l) => contentEqual(withId(l, ''), withId(scene, '')));
    if (reuse) {
      sceneMap.set(scene.id, reuse.id);
      continue;
    }
    const newId = mint.scene();
    sceneMap.set(scene.id, newId);
    out.canvasScenes.push({ ...structuredClone(scene), id: newId });
  }
  const remapSceneRef = (id: string): string => sceneMap.get(id) ?? id;

  // (1) Effects: built-in -> keep id; content-equal local -> reuse id; else fresh.
  const effMap = new Map<string, string>();
  const emittedEffectIds = new Set<string>();
  for (const e of doc.deps.effects ?? []) {
    if (ctx.isBuiltInEffectId(e.id)) {
      effMap.set(e.id, e.id);
      continue;
    }
    const reuse = ctx.effects.find((l) => contentEqual(withId(l, ''), withId(e, '')));
    if (reuse) {
      effMap.set(e.id, reuse.id);
      continue;
    }
    const newId = mint.effect(e.name);
    effMap.set(e.id, newId);
    emittedEffectIds.add(newId);
    out.effects.push({ ...e, id: newId });
  }
  const remapEffectRef = (id: string): string => effMap.get(id) ?? id;

  // (2) Presets: a `<effect>:default` id tracks its effect's new id (the engine seeds looks from
  //     `${effectId}:default`); user presets reuse-or-mint. Emit a preset only when it isn't
  //     already present locally (a reused/built-in effect already carries its default).
  const presetMap = new Map<string, string>();
  for (const p of doc.deps.presets ?? []) {
    const effNew = remapEffectRef(p.effectId);
    if (p.id === `${p.effectId}:default`) {
      const newId = `${effNew}:default`;
      presetMap.set(p.id, newId);
      if (emittedEffectIds.has(effNew)) out.presets.push({ ...p, id: newId, effectId: effNew });
      continue;
    }
    const reuse = ctx.presets.find((l) => l.effectId === effNew && contentEqual(withId(l, ''), { ...withId(p, ''), effectId: effNew }));
    if (reuse) {
      presetMap.set(p.id, reuse.id);
      continue;
    }
    const newId = mint.preset();
    presetMap.set(p.id, newId);
    out.presets.push({ ...p, id: newId, effectId: effNew });
  }
  const remapPresetRef = (id: string): string => {
    const mapped = presetMap.get(id);
    if (mapped) return mapped;
    if (id.endsWith(':default')) return `${remapEffectRef(id.slice(0, -':default'.length))}:default`;
    return id;
  };

  // (3) Graphs (deps): remap internal refs, then always mint a detached graph key. This is the
  // default copy boundary for external ClipDocs; users can link placements explicitly afterward.
  const graphMap = new Map<string, string>();
  for (const [oldKey, g] of Object.entries(doc.deps.graphs ?? {})) {
    const remapped = remapGraph(g, remapEffectRef, remapPresetRef, remapSceneRef);
    const newKey = mint.graph();
    graphMap.set(oldKey, newKey);
    out.graphs[newKey] = remapped;
    const name = doc.deps.graphNames?.[oldKey];
    if (typeof name === 'string') out.graphNames[newKey] = name;
  }
  const remapGraphRef = (key: string): string => graphMap.get(key) ?? key;

  // (4) Payload materialization.
  if (doc.kind === 'graph') {
    // The graph IS the payload — always detach it, even when identical content already exists in
    // this show. A later explicit Link action can intentionally share the resulting key.
    const remapped = remapGraph(doc.payload.graph, remapEffectRef, remapPresetRef, remapSceneRef);
    const newKey = mint.graph();
    out.graphKey = newKey;
    out.graphs[newKey] = remapped;
    if (doc.payload.name !== undefined) out.graphNames[newKey] = doc.payload.name;
  } else if (doc.kind === 'node') {
    out.node = remapGraph({ nodes: [doc.payload.node], edges: [] }, remapEffectRef, remapPresetRef, remapSceneRef).nodes[0];
  } else if (doc.kind === 'section') {
    if (doc.payload.section.graphs.some((key) => !graphMap.has(key))) {
      return err('unresolved-dependency', 'Section payload references a graph that is missing from its dependency closure.');
    }
    out.section = remapSection(doc.payload.section, mint.section(), remapGraphRef, remapEffectRef);
  } else {
    if (doc.payload.song.sections.some((section) => section.graphs.some((key) => !graphMap.has(key)))) {
      return err('unresolved-dependency', 'Song payload references a graph that is missing from its dependency closure.');
    }
    out.song = {
      id: mint.song(),
      name: doc.payload.song.name,
      sections: doc.payload.song.sections.map((sec) => remapSection(sec, mint.section(), remapGraphRef, remapEffectRef)),
    };
  }

  return out;
}

/** Rewrite a graph's dependency refs (play-node effect/preset ids) through the remap tables.
    Node/edge ids, `fromPort`/`toPort` (band handles, `mod`, `param:<key>`), `modInputs`,
    `modifierId`/`generatorId`, `busId`, and `source` are graph-internal or global and copied
    verbatim — so modifier wiring and modulation edges survive the re-key. */
function remapGraph(
  g: TriggerGraph,
  remapEffectRef: (id: string) => string,
  remapPresetRef: (id: string) => string,
  remapSceneRef: (id: string) => string,
): TriggerGraph {
  return {
    nodes: g.nodes.map((n) => remapSpliceSlots(remapCanvasNode(n, remapSceneRef) ?? {
      ...n,
      effectId: n.effectId ? remapEffectRef(n.effectId) : n.effectId,
      presetId: n.presetId ? remapPresetRef(n.presetId) : n.presetId,
    }, remapEffectRef)),
    edges: g.edges.map((e) => ({ ...e })),
  };
}

/** Point a Splice's slots at their effects' local ids (see {@link spliceSlotEffects}). */
function remapSpliceSlots(node: GraphNode, remapEffectRef: (id: string) => string): GraphNode {
  if (!node.splices?.some((slot) => slot.effectId && !slot.canvasScene)) return node;
  return {
    ...node,
    splices: node.splices.map((slot) => (slot.effectId && !slot.canvasScene ? { ...slot, effectId: remapEffectRef(slot.effectId) } : slot)),
  };
}

/** Rewrite a canvas play node's scene binding through the scene remap. Canvas effect/preset ids
    are derived from the scene id (`canvas:<id>` / `canvas:<id>:default`) — NOT registry effects —
    so they're rewritten here rather than through the effect/preset maps. Returns null for a
    non-canvas node (so the caller applies the generic effect/preset remap instead). */
function remapCanvasNode(node: GraphNode, remapSceneRef: (id: string) => string): GraphNode | null {
  if (node.kind !== 'play' && node.kind !== 'effect') return null;
  const oldSceneId = node.canvasScene ?? canvasSceneIdOf(node.effectId) ?? undefined;
  if (!oldSceneId) return null;
  const nextSceneId = remapSceneRef(oldSceneId);
  const oldDefault = `${canvasEffectId(oldSceneId)}:default`;
  return {
    ...node,
    playType: 'canvas',
    canvasScene: nextSceneId,
    effectId: canvasEffectId(nextSceneId),
    presetId: node.presetId === oldDefault ? `${canvasEffectId(nextSceneId)}:default` : node.presetId,
  };
}

/** Re-key a section under a fresh id, rewriting graph refs + look effect ids through the tables. */
function remapSection(sec: SetlistSection, newId: string, remapGraphRef: (k: string) => string, remapEffectRef: (id: string) => string): SetlistSection {
  return makeSection(newId, sec.name, sec.graphs.map(remapGraphRef), mapLooks(sec.looks, remapEffectRef));
}

function findLocalGraphKey(graphs: Record<string, TriggerGraph>, remapped: TriggerGraph): string | undefined {
  for (const [key, g] of Object.entries(graphs)) {
    if (contentEqual(g, remapped)) return key;
  }
  return undefined;
}

function withId<T extends { id: string }>(o: T, id: string): T {
  return { ...o, id };
}

/** Structural deep-equality (order-sensitive on arrays), used for content-reuse detection. Pure,
    handles the plain JSON shapes our closures carry (no Dates/Maps/functions). */
function contentEqual(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (typeof a !== typeof b) return false;
  if (a === null || b === null) return a === b;
  if (Array.isArray(a) || Array.isArray(b)) {
    if (!Array.isArray(a) || !Array.isArray(b) || a.length !== b.length) return false;
    return a.every((v, i) => contentEqual(v, b[i]));
  }
  if (typeof a === 'object' && typeof b === 'object') {
    const ak = Object.keys(a as object);
    const bk = Object.keys(b as object);
    if (ak.length !== bk.length) return false;
    return ak.every((k) => contentEqual((a as Record<string, unknown>)[k], (b as Record<string, unknown>)[k]));
  }
  return false;
}

// ---- effect-chain kinds (effect / cell / device) ------------------------------
//
// An Effect chain is self-contained: its only reusable dependency is the canvas scene a Scene
// Generator plays (`params.sceneId`, also inside Splice / Slice slot Generators). So these kinds
// carry just `deps.canvasScenes`, and their remap only reconciles scenes — the same reuse-or-mint
// policy as the graph kinds. Effect ids and device uids are section-scoped, so minting them is
// the placing caller's job (`effects-files.ts`), not this module's.

/** True for the effect-chain ClipDoc kinds. */
export function isEffectsClipDoc(doc: ClipDoc): doc is EffectsClipDoc {
  return doc.kind === 'effect' || doc.kind === 'cell' || doc.kind === 'device';
}

const SCENE_PARAM = 'sceneId';

/** Scene ids a Generator (and its Splice / Slice slot Generators) plays. */
function generatorSceneRefs(generator: effectChain.GeneratorDevice, out: Set<string>): void {
  const picked = generator.params[SCENE_PARAM];
  if (generator.kind === 'scene' && typeof picked === 'string' && picked) out.add(picked);
  for (const slot of generator.slots ?? []) if (slot.generator) generatorSceneRefs(slot.generator, out);
}

/** The authored scenes the given Generators play, deep-copied. A scene not in `scenes` (a
    built-in, or a dangling ref) is not carried: a built-in exists in every show. */
function scenesForGenerators(generators: readonly effectChain.GeneratorDevice[], scenes: readonly CanvasScene[] | undefined): CanvasScene[] {
  const wanted = new Set<string>();
  for (const generator of generators) generatorSceneRefs(generator, wanted);
  if (wanted.size === 0) return [];
  return (scenes ?? []).filter((scene) => wanted.has(scene.id)).map((scene) => structuredClone(scene));
}

/** What an effect-chain ClipDoc build reads from the show: its authored canvas scenes. */
export interface EffectsClipSources {
  canvasScenes?: readonly CanvasScene[];
}

/** Build an Effect ClipDoc: the Effect is the payload, the scenes it plays the deps. */
export function buildEffectClipDoc(effect: effectChain.Effect, sources: EffectsClipSources, over?: Partial<ClipDocMeta>): EffectClipDoc {
  const payload = { effect: structuredClone(effect) };
  return {
    app: CLIPDOC_APP,
    v: CLIPDOC_VERSION,
    kind: 'effect',
    payload,
    deps: { canvasScenes: scenesForGenerators([payload.effect.generator], sources.canvasScenes) },
    meta: meta(over),
  };
}

/** Build a cell ClipDoc from a cell's stack (in stack order). */
export function buildCellClipDoc(
  cell: effectChain.EffectCell,
  effects: readonly effectChain.Effect[],
  sources: EffectsClipSources,
  over?: Partial<ClipDocMeta>,
): CellClipDoc {
  const payload = { cell: structuredClone(cell), effects: effects.map((effect) => structuredClone(effect)) };
  return {
    app: CLIPDOC_APP,
    v: CLIPDOC_VERSION,
    kind: 'cell',
    payload,
    deps: { canvasScenes: scenesForGenerators(payload.effects.map((effect) => effect.generator), sources.canvasScenes) },
    meta: meta(over),
  };
}

/** Build a device ClipDoc. A control's mappings name devices of the Effect it came from; they
    travel as-is and the loading side keeps only the ones that still resolve. */
export function buildDeviceClipDoc(device: EffectDevicePayload, sources: EffectsClipSources, over?: Partial<ClipDocMeta>): DeviceClipDoc {
  const payload = structuredClone(device);
  const generators = payload.device === 'generator' ? [payload.generator] : [];
  return {
    app: CLIPDOC_APP,
    v: CLIPDOC_VERSION,
    kind: 'device',
    payload,
    deps: { canvasScenes: scenesForGenerators(generators, sources.canvasScenes) },
    meta: meta(over),
  };
}

/** Only the scenes survive as deps of an effect-chain doc; graph-model deps are meaningless here. */
function coerceSceneDeps(raw: unknown): ClipDocDeps {
  const scenes = coerceDeps(raw).canvasScenes;
  if (!scenes) return {};
  return { canvasScenes: scenes.filter((scene) => isObject(scene) && typeof scene.id === 'string' && scene.id !== '') };
}

function coerceEffectDoc(payload: Record<string, unknown>, deps: unknown, m: ClipDocMeta): EffectClipDoc | ClipParseError {
  const parsed = effectChain.effectSchema.safeParse(payload.effect);
  if (!parsed.success) return err('malformed', 'Effect payload malformed.');
  return { app: CLIPDOC_APP, v: CLIPDOC_VERSION, kind: 'effect', payload: { effect: parsed.data }, deps: coerceSceneDeps(deps), meta: m };
}

/** A cell doc keeps every Effect that validates on its own (like the library builder: one bad
    Effect never sinks the rest). A stack with Effects but none valid is malformed. */
function coerceCellDoc(payload: Record<string, unknown>, deps: unknown, m: ClipDocMeta): CellClipDoc | ClipParseError {
  const cell = effectChain.effectCellSchema.safeParse(payload.cell);
  if (!cell.success || !Array.isArray(payload.effects)) return err('malformed', 'Cell payload malformed.');
  const effects: effectChain.Effect[] = [];
  for (const raw of payload.effects) {
    const parsed = effectChain.effectSchema.safeParse(raw);
    if (parsed.success) effects.push(parsed.data);
  }
  if (payload.effects.length > 0 && effects.length === 0) return err('malformed', 'Cell payload holds no readable Effect.');
  return { app: CLIPDOC_APP, v: CLIPDOC_VERSION, kind: 'cell', payload: { cell: cell.data, effects }, deps: coerceSceneDeps(deps), meta: m };
}

function coerceDeviceDoc(payload: Record<string, unknown>, deps: unknown, m: ClipDocMeta): DeviceClipDoc | ClipParseError {
  const doc = (device: EffectDevicePayload): DeviceClipDoc => ({ app: CLIPDOC_APP, v: CLIPDOC_VERSION, kind: 'device', payload: device, deps: coerceSceneDeps(deps), meta: m });
  switch (payload.device) {
    case 'generator': {
      const parsed = effectChain.generatorDeviceSchema.safeParse(payload.generator);
      return parsed.success ? doc({ device: 'generator', generator: parsed.data }) : err('malformed', 'Generator payload malformed.');
    }
    case 'modifier': {
      const parsed = effectChain.modifierDeviceSchema.safeParse(payload.modifier);
      return parsed.success ? doc({ device: 'modifier', modifier: parsed.data }) : err('malformed', 'Modifier payload malformed.');
    }
    case 'control': {
      const parsed = effectChain.controlDeviceSchema.safeParse(payload.control);
      return parsed.success ? doc({ device: 'control', control: parsed.data }) : err('malformed', 'Control payload malformed.');
    }
    default:
      return err('malformed', `Unknown device: ${String(payload.device)}.`);
  }
}

/** The local show state an effect-chain load reconciles its scenes against. */
export interface EffectsRemapContext {
  canvasScenes?: readonly CanvasScene[];
  /** Fresh scene-id minter; defaults to the reservation-safe {@link makeDefaultMint} one. */
  mintScene?: () => string;
}

export interface EffectsRemapResult<D extends EffectsClipDoc = EffectsClipDoc> {
  /** The doc with every scene ref rewritten to its local id. */
  doc: D;
  /** Fresh (non-reused) scenes to add to the show. */
  canvasScenes: CanvasScene[];
}

/**
 * Reconcile an effect-chain doc's scenes with the local show: a carried scene whose content
 * matches a local one reuses its id (so A→B→A and double loads add no duplicate), otherwise it
 * gets a fresh id. Every Scene Generator in the payload (incl. slot Generators) is rewritten
 * through that map; a ref to a scene the doc did not carry (a built-in) stays verbatim.
 */
export function remapEffectsClipDoc<D extends EffectsClipDoc>(doc: D, ctx: EffectsRemapContext): EffectsRemapResult<D> {
  const local = ctx.canvasScenes ?? [];
  const mintScene = ctx.mintScene ?? makeDefaultMint({ graphs: {}, effects: [], presets: [], canvasScenes: local }).scene;
  const sceneMap = new Map<string, string>();
  const canvasScenes: CanvasScene[] = [];
  for (const scene of doc.deps.canvasScenes ?? []) {
    if (sceneMap.has(scene.id)) continue;
    const reuse = local.find((l) => contentEqual(withId(l, ''), withId(scene, '')));
    if (reuse) {
      sceneMap.set(scene.id, reuse.id);
      continue;
    }
    const id = mintScene();
    sceneMap.set(scene.id, id);
    canvasScenes.push({ ...structuredClone(scene), id });
  }
  const remapGenerator = (generator: effectChain.GeneratorDevice): effectChain.GeneratorDevice => {
    const next: effectChain.GeneratorDevice = { ...structuredClone(generator) };
    const picked = generator.params[SCENE_PARAM];
    if (generator.kind === 'scene' && typeof picked === 'string') {
      const local = sceneMap.get(picked);
      if (local) next.params[SCENE_PARAM] = local;
    }
    if (generator.slots) next.slots = generator.slots.map((slot) => (slot.generator ? { ...slot, generator: remapGenerator(slot.generator) } : { ...slot }));
    return next;
  };
  const remapEffect = (effect: effectChain.Effect): effectChain.Effect => ({ ...structuredClone(effect), generator: remapGenerator(effect.generator) });

  let out: EffectsClipDoc;
  if (doc.kind === 'effect') out = { ...doc, payload: { effect: remapEffect(doc.payload.effect) } };
  else if (doc.kind === 'cell') out = { ...doc, payload: { cell: { ...doc.payload.cell }, effects: doc.payload.effects.map(remapEffect) } };
  else {
    const payload: EffectDevicePayload = doc.payload.device === 'generator'
      ? { device: 'generator', generator: remapGenerator(doc.payload.generator) }
      : structuredClone(doc.payload);
    out = { ...doc, payload };
  }
  return { doc: out as D, canvasScenes };
}
