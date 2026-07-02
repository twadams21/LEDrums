/* =============================================================================
   INPUT ACTIVITY — last-heard badge truth (S04).

   The pure half of the "did this binding actually hear anything?" surface. The
   store records each incoming MIDI/OSC event under a stable identity key (note or
   address); an inspector field then derives its badge from a single map lookup, so
   traffic for OTHER notes/addresses can never churn it.

   Purity: matching + formatting are pure functions of (binding, activity, now) — no
   clock, no globals. The store owns the reactive activity map + age clock and feeds
   them in; the age clock is what makes a badge "age out visually" between hits.

   Scope: MIDI notes and OSC addresses only. MIDI CC never rides the `input` wire
   with a matchable field, and drum-zone hits fire via the pad path, so both resolve
   to a null binding (no badge) — honest by construction. Channel is the GLOBAL MIDI
   channel filter (Settings), not a per-binding field (mirrors the engine's model).
   ============================================================================= */
import type { voice } from '@ledrums/core';
import { formatMidiNote } from '../midi/midi-note';

/** A last-heard input event, timestamped on receipt (the web mirror of the wire
    `input` message, narrowed to what a badge needs). `value` is MIDI velocity 0..127
    or the raw OSC argument; `channel` is present for MIDI notes when the wire carries
    it. */
export interface InputActivity {
  kind: 'midi' | 'osc';
  /** MIDI note number (kind === 'midi'). */
  note?: number;
  /** MIDI channel 1..16 when known (kind === 'midi'). */
  channel?: number;
  /** OSC address (kind === 'osc'). */
  address?: string;
  /** MIDI velocity 0..127, or the raw OSC argument. */
  value: number;
  /** Receipt time (ms epoch, `Date.now()`). */
  time: number;
}

/** What an inspector field listens for — the matchable subset of a binding. Callers
    map their field to this (or to `null` for drum/CC/empty fields, which never badge). */
export type InputBinding =
  | { kind: 'midi'; note: number }
  | { kind: 'osc'; address: string };

/** The render-ready badge view — a flat prop bag for {@link InputActivityBadge}. */
export interface InputBadgeView {
  /** Matched identity: MIDI note name (e.g. "C4") or the OSC address (e.g. "/kick"). */
  label: string;
  /** Human value: MIDI velocity as an integer ("92") or the trimmed OSC arg ("0.75"). */
  value: string;
  /** Compact age since last heard: "now" · "3s" · "1m" · "2h". */
  age: string;
  /** Fresh (recent hit) reads live; once past {@link STALE_MS} it fades to muted. */
  tone: 'live' | 'muted';
  /** Pulse the dot for a beat right after a hit ({@link LIVE_MS} window). */
  fresh: boolean;
  /** Full hover tooltip, kind-correct (velocity vs arg). */
  title: string;
}

/** Just-heard window — the badge dot pulses inside it. */
export const LIVE_MS = 1500;
/** Past this the badge reads muted ("heard a while ago") but still shows its age. */
export const STALE_MS = 60_000;

/** The identity a last-heard event is remembered under: MIDI keyed by note, OSC by
    address. An event and a binding map to the SAME key, so a binding's badge is one
    lookup and unrelated traffic can't touch it. */
export function activityKey(x: InputBinding): string {
  return x.kind === 'midi' ? `midi:note:${x.note}` : `osc:${x.address}`;
}

/** Does an event pass the global MIDI channel filter? `null` accepts every channel;
    otherwise the event must be on exactly that channel. Mirrors the store's firing
    gate so a badge appears iff the event would also have fired. */
export function acceptsChannel(filter: number | null, channel: number | undefined): boolean {
  return filter === null || channel === filter;
}

/** Map a graph's trigger source to the field's input binding: a MIDI note or an OSC
    address. Drum sources (pad-bound), CC sources (no matchable wire field), and an
    unset note/empty address all resolve to `null` — no badge. */
export function bindingFromSource(src: voice.TriggerSource | undefined): InputBinding | null {
  if (!src) return null;
  if (src.kind === 'midi' && src.note !== undefined) return { kind: 'midi', note: src.note };
  if (src.kind === 'osc' && src.address) return { kind: 'osc', address: src.address };
  return null;
}

/** Compact, monotonic age label — coarsens with age so it never jitters per-frame. */
function formatAge(ageMs: number): string {
  if (ageMs < 1000) return 'now';
  if (ageMs < 60_000) return `${Math.floor(ageMs / 1000)}s`;
  if (ageMs < 3_600_000) return `${Math.floor(ageMs / 60_000)}m`;
  return `${Math.floor(ageMs / 3_600_000)}h`;
}

/** Trim an OSC argument for display: up to 2 decimals, no trailing zeros ("1", "0.75"). */
function formatOscValue(value: number): string {
  return String(Math.round(value * 100) / 100);
}

/** Derive the last-heard badge for a binding from the recorded activity + the current
    time. Returns `null` when the binding is null or nothing matching has been heard.
    Pure: same (binding, activity snapshot, now) → same view. Reads a SINGLE map key,
    so it recomputes only when THIS binding's event or `now` changes. */
export function deriveInputBadge(
  binding: InputBinding | null,
  activity: ReadonlyMap<string, InputActivity>,
  now: number,
): InputBadgeView | null {
  if (!binding) return null;
  const hit = activity.get(activityKey(binding));
  if (!hit) return null;

  const ageMs = Math.max(0, now - hit.time);
  const age = formatAge(ageMs);
  const label = binding.kind === 'midi' ? formatMidiNote(binding.note) : binding.address;
  const isMidi = hit.kind === 'midi';
  const value = isMidi ? String(Math.round(hit.value)) : formatOscValue(hit.value);
  const title = isMidi
    ? `Last heard ${label} · velocity ${value} · ${age} ago`
    : `Last heard ${label} · ${value} · ${age} ago`;

  return {
    label,
    value,
    age,
    tone: ageMs <= STALE_MS ? 'live' : 'muted',
    fresh: ageMs <= LIVE_MS,
    title,
  };
}
