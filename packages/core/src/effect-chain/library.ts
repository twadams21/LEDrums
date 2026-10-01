/**
 * The v3 persisted **show library** and v2 **song library** (effect chains), and the ONE pure
 * builder that turns them into the runtime {@link Show} the engine runs.
 *
 * The envelopes are web-authored; the server stores them verbatim and only PROJECTS a runtime
 * Show from them (cold-start restore, backup restore). The web's own show-builder moves onto
 * {@link buildRuntimeShow} too, so both sides assemble the same Show from the same blob.
 *
 * Shape policy:
 * - The envelope structure the runtime needs (ids, names, containers) is validated; anything
 *   structurally unusable throws, so a restore fails closed before any live mutation.
 * - Every other authored field is preserved (`passthrough`) — this is a projection, not a
 *   rewrite of the stored blob.
 * - Each Effect and each master modifier is validated ON ITS OWN. An invalid one is dropped and
 *   reported as a {@link LibraryDiagnostic}; one bad Effect never sinks the show.
 *
 * Pure: no Node/DOM/IO.
 */
import { z } from 'zod';
import type { CanvasScene } from '../canvas/types';
import { SHOWS_VERSION_EFFECTS, SONGS_VERSION_EFFECTS } from '../model/library-versions';
import type { Show, SongSection } from '../voice/types';
import { cellPlaySchema, effectSchema, modifierDeviceSchema, type CellPlay, type Effect, type ModifierDevice } from './types';
import { parseInputMappings } from './input-mappings';

// ---- Persisted shapes ------------------------------------------------------------

/** An optional number that degrades to absent when malformed (not read by the runtime). */
const optionalNumber = z.number().optional().catch(undefined);

/**
 * One authored section. `effects` / `master` are kept as raw entries here and validated one by
 * one in {@link buildRuntimeShow}, so a single bad Effect is dropped rather than failing the
 * whole library parse.
 */
export const librarySectionV3Schema = z.object({
  id: z.string().min(1),
  name: z.string(),
  effects: z.array(z.unknown()).default([]),
  master: z.array(z.unknown()).default([]),
  cellPlay: z.array(z.unknown()).default([]),
  bars: optionalNumber,
  bpm: optionalNumber,
}).passthrough();

export const librarySongV3Schema = z.object({
  id: z.string().min(1),
  name: z.string(),
  sections: z.array(librarySectionV3Schema).default([]),
}).passthrough();

/** Canvas scenes are shape-gated by id only; their document schema is the canvas module's. */
const canvasSceneEntrySchema = z.object({ id: z.string().min(1), name: z.string() }).passthrough();

/** The per-show authored state the runtime reads. Every other field is passthrough. */
export const authoredV3Schema = z.object({
  songs: z.array(librarySongV3Schema).default([]),
  /** Ids into the song library, as an ordered set (duplicates / dangling refs are skipped). */
  songRefs: z.array(z.string()).default([]),
  canvasScenes: z.array(canvasSceneEntrySchema).default([]),
  activeSongId: z.string().nullable().optional(),
  activeSectionId: z.string().nullable().optional(),
  bpm: optionalNumber,
  beatsPerBar: optionalNumber,
  /** MIDI-map mappings (`InputMapping[]`). Lenient here: {@link buildRuntimeShow} validates each
      one on its own and drops the invalid ones with a diagnostic, like Effects. */
  mappings: z.unknown().optional(),
}).passthrough();

export const libraryShowV3Schema = z.object({
  id: z.string().optional(),
  name: z.string().optional(),
  authored: authoredV3Schema,
}).passthrough();

export const showLibraryV3Schema = z.object({
  version: z.literal(SHOWS_VERSION_EFFECTS),
  data: z.object({
    shows: z.record(libraryShowV3Schema),
    activeShowId: z.string().nullable().optional(),
  }).passthrough(),
}).passthrough();

/** A library song: its sections (already carrying effects / master) and the scenes they use. */
export const librarySongEntryV3Schema = librarySongV3Schema.extend({
  canvasScenes: z.array(canvasSceneEntrySchema).optional(),
}).passthrough();

export const songLibraryV2Schema = z.object({
  version: z.literal(SONGS_VERSION_EFFECTS),
  data: z.object({ songs: z.record(librarySongEntryV3Schema) }).passthrough(),
}).passthrough();

export type LibrarySectionV3 = z.output<typeof librarySectionV3Schema>;
export type LibrarySongV3 = z.output<typeof librarySongEntryV3Schema>;
export type AuthoredV3 = z.output<typeof authoredV3Schema>;
export type ShowLibraryV3 = z.output<typeof showLibraryV3Schema>;
export type SongLibraryV2 = z.output<typeof songLibraryV2Schema>;

/** Parse a v3 show library envelope. Throws (with the failing path) when it is unusable. */
export function parseShowLibraryV3(raw: unknown): ShowLibraryV3 {
  return parseOrThrow(showLibraryV3Schema, raw, 'show library v3');
}

/** Parse a v2 song library envelope. Throws (with the failing path) when it is unusable. */
export function parseSongLibraryV2(raw: unknown): SongLibraryV2 {
  return parseOrThrow(songLibraryV2Schema, raw, 'song library v2');
}

function parseOrThrow<T extends z.ZodTypeAny>(schema: T, raw: unknown, what: string): z.output<T> {
  const result = schema.safeParse(raw);
  if (result.success) return result.data;
  const issue = result.error.issues[0]!;
  throw new Error(`Invalid ${what} at ${issue.path.join('.') || '(root)'}: ${issue.message}`);
}

// ---- Runtime Show builder --------------------------------------------------------

/** Why an authored entry was left out of the runtime Show. */
export interface LibraryDiagnostic {
  kind: 'invalid-effect' | 'duplicate-effect-id' | 'invalid-master-modifier' | 'invalid-mapping';
  /** Empty for a show-level entry (`invalid-mapping`). */
  songId: string;
  /** Empty for a show-level entry (`invalid-mapping`). */
  sectionId: string;
  /** Index of the entry in the authored `effects` / `master` / `mappings` array. */
  index: number;
  /** The entry's id / uid when it had a readable one. */
  id?: string;
  message: string;
}

export interface RuntimeShowBuild {
  /** `null` when the library holds no show. */
  show: Show | null;
  /** Every Effect / master modifier that was dropped, in authored order. */
  diagnostics: LibraryDiagnostic[];
}

/**
 * Build the runtime {@link Show} from a v3 show library and (optionally) a v2 song library.
 *
 * - Selects the active show (falling back to the first).
 * - Songs are the show's own, then each referenced library song in `songRefs` order. A
 *   duplicate or dangling ref is skipped, and a library section whose id is already in the
 *   show is skipped — the same policy as the web's `resolveSongRefs`. Library songs are stored
 *   already re-keyed under their `lib:<songId>/` namespace by extraction, so their ids are used
 *   as-is (no second prefixing here).
 * - Every section carries its validated `effects` (unique ids, first wins) and `master`.
 * - Canvas scenes: the show's, then any a library song carries that the show does not already
 *   have (by id). The engine registers them; an Effect hosts one as `canvas:<sceneId>`.
 * - `mappings` carries the show's valid InputMappings (unique ids, first wins); each invalid
 *   one is dropped with an `invalid-mapping` diagnostic.
 *
 * Never throws for a bad Effect. The input objects are not mutated.
 */
export function buildRuntimeShow(showLib: ShowLibraryV3, songLib: SongLibraryV2 | null): RuntimeShowBuild {
  const diagnostics: LibraryDiagnostic[] = [];
  const shows = showLib.data.shows;
  const selected = (showLib.data.activeShowId != null ? shows[showLib.data.activeShowId] : undefined)
    ?? Object.values(shows)[0];
  if (!selected) return { show: null, diagnostics };
  const authored = selected.authored;

  const librarySongs = songLib?.data.songs ?? {};
  const songs: LibrarySongV3[] = [...authored.songs];
  const seenSectionIds = new Set(songs.flatMap((song) => song.sections.map((section) => section.id)));
  const scenes: CanvasScene[] = [];
  const sceneIds = new Set<string>();
  const addScene = (scene: { id: string }): void => {
    if (sceneIds.has(scene.id)) return;
    sceneIds.add(scene.id);
    scenes.push(structuredClone(scene) as unknown as CanvasScene);
  };
  for (const scene of authored.canvasScenes) addScene(scene);

  const seenRefs = new Set<string>();
  for (const ref of authored.songRefs) {
    if (seenRefs.has(ref)) continue;
    seenRefs.add(ref);
    const lib = librarySongs[ref];
    if (!lib) continue;
    const sections = lib.sections.filter((section) => {
      if (seenSectionIds.has(section.id)) return false;
      seenSectionIds.add(section.id);
      return true;
    });
    songs.push({ ...lib, sections });
    for (const scene of lib.canvasScenes ?? []) addScene(scene);
  }

  const runtimeSongs = songs.map((song) => ({
    id: song.id,
    name: song.name,
    sections: song.sections.map((section) => runtimeSection(song.id, section, diagnostics)),
  }));

  const { mappings, dropped } = parseInputMappings(authored.mappings);
  for (const d of dropped) {
    diagnostics.push({ kind: 'invalid-mapping', songId: '', sectionId: '', index: d.index, id: d.id, message: d.message });
  }

  const show: Show = { songs: runtimeSongs, canvasScenes: scenes, mappings };
  return { show, diagnostics };
}

function runtimeSection(songId: string, section: LibrarySectionV3, diagnostics: LibraryDiagnostic[]): SongSection {
  const effects: Effect[] = [];
  const effectIds = new Set<string>();
  section.effects.forEach((raw, index) => {
    const id = readId(raw, 'id');
    const parsed = effectSchema.safeParse(raw);
    if (!parsed.success) {
      diagnostics.push({ kind: 'invalid-effect', songId, sectionId: section.id, index, id, message: issueText(parsed.error) });
      return;
    }
    if (effectIds.has(parsed.data.id)) {
      diagnostics.push({ kind: 'duplicate-effect-id', songId, sectionId: section.id, index, id: parsed.data.id,
        message: `duplicate Effect id '${parsed.data.id}' in section '${section.id}'` });
      return;
    }
    effectIds.add(parsed.data.id);
    effects.push(parsed.data);
  });
  const master: ModifierDevice[] = [];
  section.master.forEach((raw, index) => {
    const parsed = modifierDeviceSchema.safeParse(raw);
    if (parsed.success) master.push(parsed.data);
    else diagnostics.push({ kind: 'invalid-master-modifier', songId, sectionId: section.id, index, id: readId(raw, 'uid'), message: issueText(parsed.error) });
  });
  // Cell play entries are settings, not content: an unreadable one is dropped (that cell layers).
  const cellPlay: CellPlay[] = [];
  for (const raw of section.cellPlay) {
    const parsed = cellPlaySchema.safeParse(raw);
    if (parsed.success && parsed.data.mode !== 'layer') cellPlay.push(parsed.data);
  }
  return cellPlay.length > 0 ? { id: section.id, name: section.name, effects, master, cellPlay } : { id: section.id, name: section.name, effects, master };
}

function readId(raw: unknown, key: 'id' | 'uid'): string | undefined {
  if (!raw || typeof raw !== 'object') return undefined;
  const value = (raw as Record<string, unknown>)[key];
  return typeof value === 'string' ? value : undefined;
}

function issueText(error: z.ZodError): string {
  const issue = error.issues[0]!;
  return `${issue.path.join('.') || '(root)'}: ${issue.message}`;
}
