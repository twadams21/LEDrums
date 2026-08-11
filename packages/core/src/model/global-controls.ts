/* =============================================================================
   GLOBAL CONTROL BINDINGS — app-general MIDI/OSC actions.

   A global control is an action that is independent of any song, section, or pad:
   "next song", "previous section", and (as the catalogue grows) panic blackout,
   stop-all-voices, master brightness, and friends. They are configured once, in
   Settings, exactly like the app-wide MIDI channel filter — NOT on a song or a
   section, because they are input ROUTING, not authored content.

   The model is deliberately a LIST keyed by action id, not a field per action: a
   new control is one {@link GLOBAL_CONTROL_CATALOG} entry plus its resolution, and
   the schema, the UI, and the precedence rule all pick it up for free.

   Precedence (PINNED): a note or address bound to a global control is CONSUMED — it
   resolves here, at input step 0, and never also fires a pad/zone or a trigger-source
   graph. This mirrors the CC #0 section-recall reservation. The binding editor
   surfaces a hint when a bound note collides with an existing zone mapping so the
   consumption is visible rather than mysterious.

   Purity: catalogue + schema + resolvers only. No engine state, no IO.
   ============================================================================= */
import { z } from 'zod';

/**
 * Every action a global control binding can drive. Ordered as it reads in Settings.
 *
 * EXTENSION POINT: a new control is an id here, an entry in
 * {@link GLOBAL_CONTROL_CATALOG}, and its resolution in the engine. Only add an id
 * once its resolution exists — an id with no resolution is a binding that silently
 * does nothing, which is worse than no binding at all.
 */
export const GLOBAL_CONTROL_ACTIONS = ['nextSong', 'prevSong', 'nextSection', 'prevSection'] as const;

export type GlobalControlAction = (typeof GLOBAL_CONTROL_ACTIONS)[number];

export const globalControlActionSchema = z.enum(GLOBAL_CONTROL_ACTIONS);

/**
 * How an action consumes its input.
 *
 * - `trigger` — fires once on a note-on / a nonzero OSC arg. The four navigation
 *   actions are all of this shape.
 *
 * Later kinds (`momentary` — active while held, needing note-off; `continuous` — a
 * 0..1 value from a CC or OSC arg) slot in beside it.
 */
export type GlobalControlKind = 'trigger';

/** A catalogue entry — what an action IS, for the UI and for validation. */
export interface GlobalControlDef {
  id: GlobalControlAction;
  /** Settings label. */
  label: string;
  /** One-line description of what firing it does. */
  hint: string;
  kind: GlobalControlKind;
}

/** The bindable global controls, in Settings display order. */
export const GLOBAL_CONTROL_CATALOG: readonly GlobalControlDef[] = [
  { id: 'nextSong', label: 'Next song', hint: 'Advance to the next song, at its first section', kind: 'trigger' },
  { id: 'prevSong', label: 'Previous song', hint: 'Go back a song, at its first section', kind: 'trigger' },
  { id: 'nextSection', label: 'Next section', hint: 'Advance a section within the active song', kind: 'trigger' },
  { id: 'prevSection', label: 'Previous section', hint: 'Go back a section within the active song', kind: 'trigger' },
];

/** Look up a catalogue entry by action id. */
export function globalControlDef(action: GlobalControlAction): GlobalControlDef {
  // Every action id has an entry by construction (the catalogue is exhaustive over the union).
  return GLOBAL_CONTROL_CATALOG.find((d) => d.id === action)!;
}

/**
 * One action's input bindings. Both are optional and independent — an action may be
 * bound to a MIDI note, an OSC address, both, or neither (the default).
 *
 * `midiCc` is reserved for `continuous` actions (master brightness) and is ignored
 * for `trigger` actions, which have no meaningful use for a continuous value.
 */
export const globalControlBindingSchema = z.object({
  /** MIDI note number 0..127 that fires this action. */
  midiNote: z.number().int().min(0).max(127).optional(),
  /** MIDI CC number 0..127 for `continuous` actions. Unused by `trigger` actions. */
  midiCc: z.number().int().min(0).max(127).optional(),
  /** OSC address that fires this action (exact match, e.g. `/ledrums/next_song`). */
  oscAddress: z.string().optional(),
});

export type GlobalControlBinding = z.infer<typeof globalControlBindingSchema>;

const KNOWN_ACTIONS = new Set<string>(GLOBAL_CONTROL_ACTIONS);

/**
 * The whole binding list: a PARTIAL map of action id → binding. Absent key = unbound,
 * which is the default for every action.
 *
 * Unknown keys are DROPPED, not rejected. `z.record` over an enum throws on a key
 * outside the enum, which would mean a project that once bound a control we later
 * renamed or removed fails to load AT ALL — losing the kit, the routing, and the whole
 * setlist over one dead binding. A stale binding is worth exactly its own removal and
 * nothing more, so it is filtered before validation.
 */
export const globalControlsSchema = z
  .preprocess((raw) => {
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return raw;
    return Object.fromEntries(Object.entries(raw as Record<string, unknown>).filter(([key]) => KNOWN_ACTIONS.has(key)));
  }, z.record(globalControlActionSchema, globalControlBindingSchema))
  .default({});

export type GlobalControls = z.infer<typeof globalControlsSchema>;

/**
 * Merge a patch into ONE action's binding, returning a new controls map.
 *
 * Setting a field to `undefined` clears it; an action left with nothing bound is
 * removed entirely, so "unbound" is a missing key rather than an empty object that
 * would litter every saved project. OSC addresses are trimmed, and a whitespace-only
 * address counts as cleared — otherwise it would be a binding that can never match.
 */
export function withGlobalControlBinding(
  controls: GlobalControls,
  action: GlobalControlAction,
  patch: GlobalControlBinding,
): GlobalControls {
  const merged: GlobalControlBinding = { ...controls[action], ...patch };
  const cleaned: GlobalControlBinding = {};
  if (merged.midiNote !== undefined) cleaned.midiNote = merged.midiNote;
  if (merged.midiCc !== undefined) cleaned.midiCc = merged.midiCc;
  const address = merged.oscAddress?.trim();
  if (address) cleaned.oscAddress = address;

  const next: GlobalControls = { ...controls };
  if (Object.keys(cleaned).length === 0) delete next[action];
  else next[action] = cleaned;
  return next;
}

/**
 * The action a MIDI note is bound to, or null when the note is free.
 *
 * A match means the note is CONSUMED at input step 0 — the caller must not also run
 * the zone-map or direct trigger-source resolution for it.
 *
 * Ties: if two actions somehow carry the same note (the editor allows it — nothing
 * stops a user typing the same number twice), the CATALOGUE order wins, so resolution
 * is deterministic rather than dependent on object key order.
 */
export function globalControlForNote(controls: GlobalControls, note: number): GlobalControlAction | null {
  for (const def of GLOBAL_CONTROL_CATALOG) {
    if (controls[def.id]?.midiNote === note) return def.id;
  }
  return null;
}

/**
 * The action an OSC address is bound to, or null when the address is free. Exact
 * match on the trimmed address; an empty binding never matches. Same consumption and
 * tie-break rules as {@link globalControlForNote}.
 */
export function globalControlForOsc(controls: GlobalControls, address: string): GlobalControlAction | null {
  const wanted = address.trim();
  if (!wanted) return null;
  for (const def of GLOBAL_CONTROL_CATALOG) {
    const bound = controls[def.id]?.oscAddress?.trim();
    if (bound && bound === wanted) return def.id;
  }
  return null;
}

/**
 * Does an OSC argument fire a `trigger` action? Senders differ: a button may send no
 * argument (which the OSC layer normalises to 1), a 1 on press and a 0 on release, or
 * a float. Firing on a zero would double-fire every press/release pair, so a trigger
 * fires on a NONZERO value only.
 */
export function oscArgFires(value: number): boolean {
  return value !== 0;
}
