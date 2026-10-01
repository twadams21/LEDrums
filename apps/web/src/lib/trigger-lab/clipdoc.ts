/* ClipDoc — one portable envelope for copy/paste and save/load-to-file of sections, songs, Effect
   chains and the patch across browser sessions / servers (doc 11). A PURE module (no runes, no DOM,
   no clipboard IO) so the serialize / parse / remap contract is unit-testable in node, like
   persistence / setlist. The system clipboard (S44) and file IO are adapters over this format.

   THREE responsibilities:
     1. build + serialize — lift an authored thing plus the canvas scenes its Generators play (its
        only reusable dependency) into a versioned envelope.
     2. parse — defensively read arbitrary text into a ClipDoc, NEVER throwing: foreign / malformed
        / wrong-version text yields a typed {@link ClipParseError}, so the UI can toast rather than
        crash.
     3. remap-on-materialize — a carried scene whose content matches a local one reuses its id,
        otherwise it gets a fresh one; pasted sections and songs always get fresh ids. Effect ids
        and device uids are section-scoped, so they travel verbatim.

   The graph-editor kinds (`graph` / `node`) went with the graph model (effect chains S08): a file
   or clipboard payload of either kind now parses as an unknown kind. */

import type { Project, CanvasScene } from '@ledrums/core';
import { effectChain } from '@ledrums/core';
import type { SetlistSection, Song } from '../app/setlist';
import { freshId, nid } from './store/ids';

// ---- envelope ---------------------------------------------------------------

export const CLIPDOC_APP = 'ledrums';
/** Envelope version. {@link serialize} always stamps it. */
export const CLIPDOC_VERSION = 2;

/** The one prior envelope version {@link parse} still accepts (a graph-era v1 doc). Its section /
    song payloads carry no Effects, so they parse as empty sections. */
export const CLIPDOC_PRIOR_VERSION = 1;

export type ClipDocKind = 'section' | 'song' | 'patch' | 'effect' | 'cell' | 'device';

/** Provenance stamped on export — advisory only (never gates parse/remap). */
export interface ClipDocMeta {
  exportedAt: string;
  appVersion?: string;
  /** the show the content was copied FROM (for a "pasted from …" hint), when known. */
  sourceShow?: string;
}

/** The dependency closure carried beside an authored payload: the authored canvas scenes its Scene
    Generators play (a built-in scene exists in every show, so it is not carried). */
export interface ClipDocDeps {
  canvasScenes?: CanvasScene[];
}

/** The Project slices a patch ClipDoc carries (doc 11): kit geometry incl. outputs, the input
    map, and output settings. Whole-document — applied wholesale by S45, never remapped. */
export type PatchPayload = Pick<Project, 'kit' | 'inputMap' | 'output'> & { name?: string };

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

/** The effect-chain kinds: they go through {@link remapEffectsClipDoc}, not {@link remapClipDoc}. */
export type EffectsClipDoc = EffectClipDoc | CellClipDoc | DeviceClipDoc;

export type ClipDoc = SectionClipDoc | SongClipDoc | PatchClipDoc | EffectsClipDoc;

// ---- build (sections / songs / patch) -----------------------------------------

function meta(over?: Partial<ClipDocMeta>): ClipDocMeta {
  return { exportedAt: new Date().toISOString(), ...over };
}

function cloneJson<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

/** A section as its portable payload: the section fields only, deep-copied. */
function sectionPayload(section: SetlistSection): SetlistSection {
  const out: SetlistSection = { id: section.id, name: section.name, effects: cloneJson(section.effects), master: cloneJson(section.master) };
  if (section.bars !== undefined) out.bars = section.bars;
  if (section.bpm !== undefined) out.bpm = section.bpm;
  if (section.cellPlay?.length) out.cellPlay = cloneJson(section.cellPlay);
  return out;
}

/** Build a section ClipDoc: the section (its Effect stack + Master chain) is the payload, the scenes
    its Effects play the deps. */
export function buildSectionClipDoc(section: SetlistSection, sources: EffectsClipSources, over?: Partial<ClipDocMeta>): SectionClipDoc {
  const payload = { section: sectionPayload(section) };
  return {
    app: CLIPDOC_APP,
    v: CLIPDOC_VERSION,
    kind: 'section',
    payload,
    deps: { canvasScenes: scenesForGenerators(payload.section.effects.map((e) => e.generator), sources.canvasScenes) },
    meta: meta(over),
  };
}

/** Build a song ClipDoc: the song (its sections) is the payload, the scenes its Effects play the deps. */
export function buildSongClipDoc(song: Song, sources: EffectsClipSources, over?: Partial<ClipDocMeta>): SongClipDoc {
  const sections = song.sections.map(sectionPayload);
  return {
    app: CLIPDOC_APP,
    v: CLIPDOC_VERSION,
    kind: 'song',
    payload: { song: { id: song.id, name: song.name, sections } },
    deps: { canvasScenes: scenesForGenerators(sections.flatMap((s) => s.effects.map((e) => e.generator)), sources.canvasScenes) },
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
const isFiniteNumber = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);

function err(reason: ClipParseReason, message: string): ClipParseError {
  return { parseError: true, reason, message };
}

/**
 * Parse arbitrary text into a ClipDoc, NEVER throwing (the paste UI can only ever see a value or a
 * typed error). Version-tolerant + unknown-field-tolerant like the persistence loaders: the
 * envelope is validated (app tag, version, known kind, payload shape), each field coerced
 * defensively, and anything unrecognized becomes a {@link ClipParseError} the caller turns into a
 * friendly toast — a non-ClipDoc paste is a no-op, not a crash.
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
  return coerceKind(raw.kind, raw.payload, raw.deps, coerceMeta(raw.meta));
}

function coerceKind(kind: unknown, payload: Record<string, unknown>, deps: unknown, m: ClipDocMeta): ClipDoc | ClipParseError {
  switch (kind) {
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

function coerceMeta(raw: unknown): ClipDocMeta {
  if (!isObject(raw)) return { exportedAt: '' };
  const out: ClipDocMeta = { exportedAt: typeof raw.exportedAt === 'string' ? raw.exportedAt : '' };
  if (typeof raw.appVersion === 'string') out.appVersion = raw.appVersion;
  if (typeof raw.sourceShow === 'string') out.sourceShow = raw.sourceShow;
  return out;
}

/** Only authored scenes with an id survive as deps. */
function coerceSceneDeps(raw: unknown): ClipDocDeps {
  if (!isObject(raw) || !Array.isArray(raw.canvasScenes)) return {};
  const scenes = (raw.canvasScenes as unknown[]).filter(
    (scene): scene is CanvasScene => isObject(scene) && typeof scene.id === 'string' && scene.id !== '',
  );
  return { canvasScenes: scenes };
}

function coerceSectionDoc(payload: Record<string, unknown>, deps: unknown, m: ClipDocMeta): SectionClipDoc | ClipParseError {
  const section = coerceSection(payload.section);
  if (!section) return err('malformed', 'Section payload malformed.');
  return { app: CLIPDOC_APP, v: CLIPDOC_VERSION, kind: 'section', payload: { section }, deps: coerceSceneDeps(deps), meta: m };
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
  return { app: CLIPDOC_APP, v: CLIPDOC_VERSION, kind: 'song', payload: { song: { id: song.id, name, sections } }, deps: coerceSceneDeps(deps), meta: m };
}

function coercePatchDoc(payload: Record<string, unknown>, m: ClipDocMeta): PatchClipDoc | ClipParseError {
  if (!isObject(payload.patch)) return err('malformed', 'Patch payload missing.');
  // Deep validation is S45's server-side zod pass; here we only confirm the envelope carries a
  // patch object (kit at minimum) and round-trip it verbatim.
  const patch = payload.patch;
  if (!isObject(patch.kit)) return err('malformed', 'Patch payload missing kit.');
  return { app: CLIPDOC_APP, v: CLIPDOC_VERSION, kind: 'patch', payload: { patch: patch as unknown as PatchPayload }, meta: m };
}

/** Coerce a pasted section defensively: a non-object or id-less entry is unusable (null → dropped
    by the caller); otherwise each Effect / Master modifier that validates on its own survives (an
    invalid or duplicate-id Effect is dropped, the section survives). A graph-era section carries
    no Effects, so it reads as an empty section. */
function coerceSection(raw: unknown): SetlistSection | null {
  if (!isObject(raw) || typeof raw.id !== 'string' || !raw.id) return null;
  const effects: effectChain.Effect[] = [];
  const ids = new Set<string>();
  for (const entry of Array.isArray(raw.effects) ? raw.effects : []) {
    const parsed = effectChain.effectSchema.safeParse(entry);
    if (!parsed.success || ids.has(parsed.data.id)) continue;
    ids.add(parsed.data.id);
    effects.push(parsed.data);
  }
  const master: effectChain.ModifierDevice[] = [];
  for (const entry of Array.isArray(raw.master) ? raw.master : []) {
    const parsed = effectChain.modifierDeviceSchema.safeParse(entry);
    if (parsed.success) master.push(parsed.data);
  }
  const section: SetlistSection = { id: raw.id, name: typeof raw.name === 'string' ? raw.name : '', effects, master };
  if (isFiniteNumber(raw.bars)) section.bars = raw.bars;
  if (isFiniteNumber(raw.bpm)) section.bpm = raw.bpm;
  return section;
}

// ---- remap on materialize (sections / songs) ------------------------------------

/** The local show state a section / song paste reconciles against. */
export interface RemapContext {
  /** Local canvas scenes — for content-reuse: a pasted scene identical to a local one reuses its
      id (so A→B→A round-trips and double-pastes create no duplicate scene). */
  canvasScenes?: readonly CanvasScene[];
  /** Section ids already present in the destination resolved view. */
  sectionIds?: readonly string[];
  /** Fresh-id minter per domain. Defaults to the reservation-safe {@link makeDefaultMint}
      (real `nid`/`freshId`); injected in tests for determinism. */
  mint?: RemapMint;
}

export interface RemapMint {
  section(): string;
  song(): string;
  scene(): string;
}

/** The reservation-safe default minter — section/song ids come off the shared monotonic counter
    (skipping any section id the destination already has); scene ids survive reload via
    {@link freshId} against the local scenes and the ones minted earlier in the same pass. */
export function makeDefaultMint(ctx: Pick<RemapContext, 'canvasScenes' | 'sectionIds'>): RemapMint {
  const mintedSceneIds = new Set<string>();
  const usedSectionIds = new Set(ctx.sectionIds ?? []);
  return {
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

/** The materialized result of a section / song paste: the fresh scenes to union into the show plus
    the primary object under fresh ids with every scene ref rewritten. */
export interface RemapResult {
  kind: 'section' | 'song';
  /** fresh (non-reused) canvas scenes to add. */
  canvasScenes: CanvasScene[];
  /** kind 'section': the fresh section. */
  section?: SetlistSection;
  /** kind 'song': the fresh song with its sections re-keyed. */
  song?: Song;
}

/** Materialize a section / song ClipDoc against a local show: scenes reuse-or-mint, then the
    section(s) (and song) get fresh ids. A typed error for every other kind. */
export function remapClipDoc(doc: ClipDoc, ctx: RemapContext): RemapResult | ClipParseError {
  if (doc.kind === 'patch') return err('unknown-kind', 'Patch ClipDocs are applied wholesale, not remapped.');
  if (isEffectsClipDoc(doc)) return err('unknown-kind', 'Effect-chain ClipDocs are remapped by remapEffectsClipDoc.');
  const mint = ctx.mint ?? makeDefaultMint(ctx);
  const scenes = remapScenes(doc.deps, ctx.canvasScenes ?? [], mint.scene);
  const place = (sec: SetlistSection, id: string): SetlistSection => ({ ...sectionPayload(sec), id, effects: sec.effects.map(scenes.remapEffect) });
  if (doc.kind === 'section') {
    return { kind: 'section', canvasScenes: scenes.canvasScenes, section: place(doc.payload.section, mint.section()) };
  }
  const song: Song = { id: mint.song(), name: doc.payload.song.name, sections: doc.payload.song.sections.map((sec) => place(sec, mint.section())) };
  return { kind: 'song', canvasScenes: scenes.canvasScenes, song };
}

function withId<T extends { id: string }>(o: T, id: string): T {
  return { ...o, id };
}

/** Structural deep-equality (order-sensitive on arrays), used for content-reuse detection. Pure,
    handles the plain JSON shapes our payloads carry (no Dates/Maps/functions). */
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
// policy as the section / song kinds. Effect ids and device uids are section-scoped, so minting
// them is the placing caller's job (`effects-files.ts`), not this module's.

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

/** What a ClipDoc build reads from the show: its authored canvas scenes. */
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
 * Reconcile an effect-chain doc's scenes with the local show (see {@link remapScenes}) and rewrite
 * every Scene Generator in the payload through that map.
 */
export function remapEffectsClipDoc<D extends EffectsClipDoc>(doc: D, ctx: EffectsRemapContext): EffectsRemapResult<D> {
  const local = ctx.canvasScenes ?? [];
  const mintScene = ctx.mintScene ?? makeDefaultMint({ canvasScenes: local }).scene;
  const { canvasScenes, remapGenerator, remapEffect } = remapScenes(doc.deps, local, mintScene);
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

/** The shared scene reconciliation: a carried scene whose content matches a local one reuses its
    id (so A→B→A and double loads add no duplicate), otherwise it gets a fresh id. Every Scene
    Generator (incl. slot Generators) is rewritten through that map; a ref to a scene the doc did
    not carry (a built-in) stays verbatim. */
function remapScenes(deps: ClipDocDeps, local: readonly CanvasScene[], mintScene: () => string): {
  canvasScenes: CanvasScene[];
  remapGenerator: (generator: effectChain.GeneratorDevice) => effectChain.GeneratorDevice;
  remapEffect: (effect: effectChain.Effect) => effectChain.Effect;
} {
  const sceneMap = new Map<string, string>();
  const canvasScenes: CanvasScene[] = [];
  for (const scene of deps.canvasScenes ?? []) {
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
      const mapped = sceneMap.get(picked);
      if (mapped) next.params[SCENE_PARAM] = mapped;
    }
    if (generator.slots) next.slots = generator.slots.map((slot) => (slot.generator ? { ...slot, generator: remapGenerator(slot.generator) } : { ...slot }));
    return next;
  };
  const remapEffect = (effect: effectChain.Effect): effectChain.Effect => ({ ...structuredClone(effect), generator: remapGenerator(effect.generator) });
  return { canvasScenes, remapGenerator, remapEffect };
}
