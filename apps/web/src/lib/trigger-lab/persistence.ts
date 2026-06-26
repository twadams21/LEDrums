/* Live persistence for AUTHORED state — a PURE module (no runes, no DOM) so the
   serialize/deserialize contract + its version gate are unit-testable in node,
   like setlist / shell-nav / show-builder. The store (store.svelte.ts) owns the
   localStorage I/O + the reactive autosave; this module only knows the persisted
   shape + the versioned envelope.

   Contract: serializeAuthored wraps a slice in a versioned envelope.
   deserializeAuthored returns null on a version mismatch or a malformed blob (so
   a stale/corrupt payload can never wedge boot — the store keeps its seed), and
   otherwise a PARTIAL slice carrying only the fields that were present and
   well-typed. The store merges that over its seed defaults, so missing fields
   (older blob) and unknown fields (newer blob) are both tolerated without a
   version bump — bump VERSION only when an existing field changes incompatibly. */

import type { Bus, EffectDef, Preset, TriggerGraph } from './sim';
import type { Song } from '../app/setlist';

/** localStorage key — carries the schema version so old payloads are namespaced
    (a future v2 writes to a different key, leaving v1 untouched). */
export const STORAGE_KEY = 'ledrums:authored:v1';

/** Payload schema version. Bump only on an INCOMPATIBLE change to an existing
    field; additive fields are tolerated by deserialize without a bump. Older
    payloads then fail the version gate and are ignored (boot falls back to seed). */
export const VERSION = 1;

/** The persisted slice of the store — AUTHORED content only (never transient
    voice/frame/link/transport-playing state). */
export interface AuthoredState {
  graphs: Record<string, TriggerGraph>;
  /** human labels for AUTHORED graph keys (pad-derived graphs label from the kit).
      Kept beside `graphs` so a created graph keeps its name across reloads. */
  graphNames: Record<string, string>;
  songs: Song[];
  buses: Bus[];
  presets: Preset[];
  effects: EffectDef[];
  selectedPadKey: string | null;
  activeSongId: string;
  arrangeSectionId: string | null;
  bpm: number;
  velocity: number;
  beatsPerBar: number;
  /** Persisted shell pane sizes in px (keyed by a stable pane id) — added for the
      resizable docks (step 3); tolerated when absent so older blobs still load. */
  paneSizes?: Record<string, number>;
  /** Per-node display-label overrides for the Patch graph, keyed by flow-node id —
      a UI-only rename (the device topology ids aren't server state), so it lives here
      beside the other authored prefs. Tolerated when absent (older blobs). */
  patchLabels?: Record<string, string>;
}

/** Versioned envelope written to storage. */
export interface PersistedAuthored {
  version: number;
  data: AuthoredState;
}

/** Wrap a slice in the versioned envelope (JSON-safe; the caller stringifies). */
export function serializeAuthored(state: AuthoredState): PersistedAuthored {
  return { version: VERSION, data: state };
}

const isObject = (v: unknown): v is Record<string, unknown> =>
  typeof v === 'object' && v !== null && !Array.isArray(v);

const isFiniteNumber = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);

/**
 * Validate a parsed blob and return the authored fields it carries. Returns null
 * only when the envelope itself is unusable (not an object, or a version other
 * than VERSION) — that is the "never wedge boot" gate. When the version matches,
 * each field is included only if it is present and the right container/primitive
 * type, so a partially-corrupt blob degrades to the fields that survived rather
 * than discarding everything.
 */
export function deserializeAuthored(raw: unknown): Partial<AuthoredState> | null {
  if (!isObject(raw)) return null;
  if (raw.version !== VERSION) return null;
  const data = raw.data;
  if (!isObject(data)) return null;

  const out: Partial<AuthoredState> = {};

  // containers — included only when the expected shape (records vs arrays)
  if (isObject(data.graphs)) out.graphs = data.graphs as Record<string, TriggerGraph>;
  if (isObject(data.graphNames)) out.graphNames = data.graphNames as Record<string, string>;
  if (Array.isArray(data.songs)) out.songs = data.songs as Song[];
  if (Array.isArray(data.buses)) out.buses = data.buses as Bus[];
  if (Array.isArray(data.presets)) out.presets = data.presets as Preset[];
  if (Array.isArray(data.effects)) out.effects = data.effects as EffectDef[];
  if (isObject(data.paneSizes)) out.paneSizes = data.paneSizes as Record<string, number>;
  if (isObject(data.patchLabels)) out.patchLabels = data.patchLabels as Record<string, string>;

  // scalars — typeof-gated; the nullable ids also accept an explicit null
  if (typeof data.selectedPadKey === 'string' || data.selectedPadKey === null) {
    out.selectedPadKey = data.selectedPadKey as string | null;
  }
  if (typeof data.activeSongId === 'string') out.activeSongId = data.activeSongId;
  if (typeof data.arrangeSectionId === 'string' || data.arrangeSectionId === null) {
    out.arrangeSectionId = data.arrangeSectionId as string | null;
  }
  if (isFiniteNumber(data.bpm)) out.bpm = data.bpm;
  if (isFiniteNumber(data.velocity)) out.velocity = data.velocity;
  if (isFiniteNumber(data.beatsPerBar)) out.beatsPerBar = data.beatsPerBar;

  return out;
}
