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
     3. remap-on-materialize — re-key every incoming id through the id-reservation discipline
        (`nid`/`freshId`), EXCEPT (a) a dep whose CONTENT already exists locally (reuse it — so
        A->B->A round-trips and double-pastes create no duplicate closure), and (b) built-in
        effect ids (registry-backed shared vocabulary — never re-keyed even when content
        differs). Every internal ref (section->graph keys, play-node effect/preset ids,
        preset->effect, look effect ids) is rewritten through the remap table; node/edge ids
        and modulation `param:`/`mod` ports are graph-internal and travel verbatim, so modifier
        wiring and modulation edges survive intact.

   Scope (S43): the pure module + tests. Clipboard IO + context menus are S44; the patch
   `setProject` server apply is S45 — here the `patch` kind only round-trips (no remap). */

import type { EffectDef, Preset, TriggerGraph } from './sim';
import type { SetlistSection, Song } from '../app/setlist';
import type { Project } from '@ledrums/core';
import { extractSongClosure, songNamespace, type ClosureSources } from './store/song-library';
import { freshEffectId } from './store/objects';
import { freshId, nid } from './store/ids';

// ---- envelope ---------------------------------------------------------------

export const CLIPDOC_APP = 'ledrums';
export const CLIPDOC_VERSION = 1;

export type ClipDocKind = 'graph' | 'section' | 'song' | 'patch';

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

export type ClipDoc = GraphClipDoc | SectionClipDoc | SongClipDoc | PatchClipDoc;
/** The authored kinds that carry a dependency closure and go through {@link remapClipDoc}. */
export type AuthoredClipDoc = GraphClipDoc | SectionClipDoc | SongClipDoc;

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
  return { app: CLIPDOC_APP, v: CLIPDOC_VERSION, kind: 'graph', payload, deps: { effects: raw.effects, presets: raw.presets }, meta: meta(over) };
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
    deps: { graphs: raw.graphs, graphNames: raw.graphNames, effects: raw.effects, presets: raw.presets },
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
    deps: { graphs: raw.graphs, graphNames: raw.graphNames, effects: raw.effects, presets: raw.presets },
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

export type ClipParseReason = 'not-json' | 'not-object' | 'foreign' | 'unsupported-version' | 'unknown-kind' | 'malformed';

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
  if (raw.v !== CLIPDOC_VERSION) return err('unsupported-version', `Unsupported ClipDoc version: ${String(raw.v)}.`);
  if (!isObject(raw.payload)) return err('malformed', 'ClipDoc payload missing.');

  const metaOut = coerceMeta(raw.meta);
  switch (raw.kind) {
    case 'graph':
      return coerceGraphDoc(raw.payload, raw.deps, metaOut);
    case 'section':
      return coerceSectionDoc(raw.payload, raw.deps, metaOut);
    case 'song':
      return coerceSongDoc(raw.payload, raw.deps, metaOut);
    case 'patch':
      return coercePatchDoc(raw.payload, metaOut);
    default:
      return err('unknown-kind', `Unknown ClipDoc kind: ${String(raw.kind)}.`);
  }
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
  for (const raw of song.sections) {
    const sec = coerceSection(raw);
    if (sec) sections.push(sec);
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
  if (!isObject(raw) || typeof raw.id !== 'string') return null;
  const graphs = Array.isArray(raw.graphs) ? raw.graphs.filter((k): k is string => typeof k === 'string') : [];
  const looks: Record<string, string | null> = {};
  if (isObject(raw.looks)) {
    for (const [busId, v] of Object.entries(raw.looks)) {
      if (typeof v === 'string' || v === null) looks[busId] = v;
    }
  }
  return { id: raw.id, name: typeof raw.name === 'string' ? raw.name : '', graphs, looks };
}

// ---- remap on materialize ---------------------------------------------------

/** The local show state a paste reconciles against — its graphs/effects/presets (for
    content-reuse) and which effect ids are built-in registry vocabulary (never re-keyed). */
export interface RemapContext {
  graphs: Record<string, TriggerGraph>;
  effects: readonly EffectDef[];
  presets: readonly Preset[];
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
}

/** The reservation-safe default minter — graph/preset ids survive reload via {@link freshId}
    against the (post-merge) local sets; effect ids stay name-derived + unique; section/song ids
    come off the shared monotonic counter. Effect minting also dedups against ids minted EARLIER
    in the same pass (`freshEffectId` is name-derived, not counter-backed, so without this two
    same-name effects in one closure would mint the same id — the other minters are immune). */
export function makeDefaultMint(ctx: Pick<RemapContext, 'graphs' | 'effects' | 'presets'>): RemapMint {
  const mintedEffectIds = new Set<string>();
  return {
    graph: () => freshId('graph', (k) => k in ctx.graphs),
    effect: (name) => {
      const id = freshEffectId([...ctx.effects, ...[...mintedEffectIds].map((eid) => ({ id: eid }) as EffectDef)], name);
      mintedEffectIds.add(id);
      return id;
    },
    preset: () => freshId('preset', (k) => ctx.presets.some((p) => p.id === k)),
    section: () => nid('section'),
    song: () => nid('song'),
  };
}

/** The materialized result of a paste: the NEW closure objects to union into the show (reused
    ones are absent) plus the primary object with every ref rewritten to its final local id. The
    store (S44) unions the closure and inserts the primary; this function stays pure. */
export interface RemapResult {
  kind: 'graph' | 'section' | 'song';
  /** fresh graphs to add (key -> graph, refs already remapped). Reused graphs are absent. */
  graphs: Record<string, TriggerGraph>;
  graphNames: Record<string, string>;
  /** fresh (non-builtin, non-reused) effects to add. */
  effects: EffectDef[];
  /** fresh/derived presets to add. */
  presets: Preset[];
  /** kind 'graph': the final graph key (reused or fresh) to reference. */
  graphKey?: string;
  /** kind 'section': the fresh section with graph refs + looks remapped. */
  section?: SetlistSection;
  /** kind 'song': the fresh song with its sections remapped. */
  song?: Song;
}

/**
 * Materialize an authored ClipDoc against a local show: re-key + reuse. Builds the remap table
 * in dependency order (effects -> presets -> graphs -> sections/song); every incoming id is
 * mapped to a fresh local id EXCEPT (a) a built-in effect id (kept verbatim) and (b) a dep whose
 * content already exists locally (mapped to the existing id, emitting nothing — the reuse that
 * makes A->B->A round-trips and double-pastes create no duplicate closure). Node/edge ids and
 * modulation `param:`/`mod` ports are graph-internal and copied verbatim, so modifier wiring and
 * modulation edges survive. Returns a typed error for the non-authored `patch` kind (S45 owns it).
 */
export function remapClipDoc(doc: ClipDoc, ctx: RemapContext): RemapResult | ClipParseError {
  if (doc.kind === 'patch') return err('unknown-kind', 'Patch ClipDocs are applied wholesale, not remapped.');
  const mint = ctx.mint ?? makeDefaultMint(ctx);

  const out: RemapResult = { kind: doc.kind, graphs: {}, graphNames: {}, effects: [], presets: [] };

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

  // (3) Graphs (deps): remap internal refs, then reuse-or-mint by content.
  const graphMap = new Map<string, string>();
  for (const [oldKey, g] of Object.entries(doc.deps.graphs ?? {})) {
    const remapped = remapGraph(g, remapEffectRef, remapPresetRef);
    const reuseKey = findLocalGraphKey(ctx.graphs, remapped);
    if (reuseKey) {
      graphMap.set(oldKey, reuseKey);
      continue;
    }
    const newKey = mint.graph();
    graphMap.set(oldKey, newKey);
    out.graphs[newKey] = remapped;
    const name = doc.deps.graphNames?.[oldKey];
    if (typeof name === 'string') out.graphNames[newKey] = name;
  }
  const remapGraphRef = (key: string): string => graphMap.get(key) ?? key;

  // (4) Payload materialization.
  if (doc.kind === 'graph') {
    // The graph IS the payload — treat it as a dep leaf (reuse-or-mint by content) so pasting an
    // identical graph twice creates exactly one.
    const remapped = remapGraph(doc.payload.graph, remapEffectRef, remapPresetRef);
    const reuseKey = findLocalGraphKey(ctx.graphs, remapped) ?? findLocalGraphKey(out.graphs, remapped);
    if (reuseKey) {
      out.graphKey = reuseKey;
    } else {
      const newKey = mint.graph();
      out.graphKey = newKey;
      out.graphs[newKey] = remapped;
      if (doc.payload.name !== undefined) out.graphNames[newKey] = doc.payload.name;
    }
  } else if (doc.kind === 'section') {
    out.section = remapSection(doc.payload.section, mint.section(), remapGraphRef, remapEffectRef);
  } else {
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
function remapGraph(g: TriggerGraph, remapEffectRef: (id: string) => string, remapPresetRef: (id: string) => string): TriggerGraph {
  return {
    nodes: g.nodes.map((n) => ({
      ...n,
      effectId: n.effectId ? remapEffectRef(n.effectId) : n.effectId,
      presetId: n.presetId ? remapPresetRef(n.presetId) : n.presetId,
    })),
    edges: g.edges.map((e) => ({ ...e })),
  };
}

/** Re-key a section under a fresh id, rewriting graph refs + look effect ids through the tables. */
function remapSection(sec: SetlistSection, newId: string, remapGraphRef: (k: string) => string, remapEffectRef: (id: string) => string): SetlistSection {
  return {
    id: newId,
    name: sec.name,
    graphs: sec.graphs.map(remapGraphRef),
    looks: mapLooks(sec.looks, remapEffectRef),
  };
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
