/* Shared form-options + value formatters for the Trigger / Patch node editors — the
   SegmentedControl / Select option arrays and the small numeric/label `fmt` helpers
   that were duplicated between the Inspector and the (now-deleted) lab NodeCanvas.
   ONE source of truth so the Inspector split (S3.1) and the views read the same lists,
   in the same order, with the same labels. Co-located with `trigger-node-meta.ts` (the
   icon/tint/label maps it builds the iconed option arrays from).

   Pure TS — no Svelte runes / no `.svelte` — so it's unit-testable and importable
   anywhere. The Lucide icon imports are plain component references (same as
   `trigger-node-meta.ts`); they keep this UI-only but out of `packages/core`. */
import type { Component } from 'svelte';
import Zap from '@lucide/svelte/icons/zap';
import Repeat from '@lucide/svelte/icons/repeat';
import Hand from '@lucide/svelte/icons/hand';
import {
  NODE_KINDS,
  type NodeKind,
  type ParamSpec,
  type ParamValue,
  type SwitchOn,
  type TriggerSource,
  type ValueMode,
} from '../../trigger-lab/sim';
import { kindIcon, kindLabel, tint } from './trigger-node-meta';
import type { PixelSpan } from '../patch-routing';

// --- Output (Patch controller) options ------------------------------------------
export const PROTOCOL_OPTS = [
  { value: 'artnet', label: 'Art-Net' },
  { value: 'sacn', label: 'sACN (E1.31)' },
];
export const RGB_OPTS = (['RGB', 'RBG', 'GRB', 'GBR', 'BRG', 'BGR'] as const).map((o) => ({ value: o, label: o }));

// --- Play-node scope options ----------------------------------------------------------
export const SCOPE_OPTS: Array<{ value: 'kit' | 'drum' | 'hoop'; label: string }> = [
  { value: 'kit', label: 'Kit' },
  { value: 'drum', label: 'Drum' },
  { value: 'hoop', label: 'Hoop' },
];

// --- Play-node options (iconed play-mode + link + layer-poly) --------------------
// iconed play-mode group (Zap/Repeat/Hand) — same SegmentedControl, just an icon per
// option (ported from the old node header).
export const MODE_OPTS: Array<{ value: 'oneshot' | 'loop' | 'hold'; label: string; icon: Component }> = [
  { value: 'oneshot', label: 'One-shot', icon: Zap },
  { value: 'loop', label: 'Loop', icon: Repeat },
  { value: 'hold', label: 'Hold', icon: Hand },
];
export const LINK_OPTS = [
  { value: 'instance', label: 'Instance' },
  { value: 'linked', label: 'Linked' },
];
export const POLY_OPTS = [
  { value: 'mono', label: 'mono' },
  { value: 'poly', label: 'poly' },
];

// --- Node-kind selector + switch / value routing options -------------------------
// kind selector (every node but the trigger root) — the iconed variant built from the
// shared `trigger-node-meta` maps.
export const KIND_OPTS = NODE_KINDS.map((k) => ({ value: k, label: kindLabel[k], icon: kindIcon[k], iconColor: tint[k] }));
export const SWITCH_OPTS: Array<{ value: SwitchOn; label: string }> = [
  { value: 'value', label: 'value' },
  { value: 'section', label: 'section' },
  { value: 'beat', label: 'beat' },
];
export const VALUEMODE_OPTS: Array<{ value: ValueMode; label: string }> = [
  { value: 'gate', label: 'Gate' },
  { value: 'bands', label: 'Bands' },
];

// --- Trigger-node source editor options (U2) -------------------------------------
export const SOURCE_OPTS: Array<{ value: TriggerSource['kind']; label: string }> = [
  { value: 'drum', label: 'Drum' },
  { value: 'midi', label: 'MIDI' },
  { value: 'osc', label: 'OSC' },
];
export const MIDI_OPTS = [
  { value: 'note', label: 'Note' },
  { value: 'cc', label: 'CC' },
];

// --- Value formatters ------------------------------------------------------------
/** A 0–1 ratio as a whole-percent label (e.g. 0.5 → "50%"). */
export const pct = (v: number): string => `${Math.round(v * 100)}%`;

/** Coerce a possibly-boolean param value to a number, falling back to `d`. */
export function num(v: ParamValue | undefined, d: number): number {
  return typeof v === 'number' ? v : d;
}

/** Format a param value for a read-out: numbers honour the spec's step (2dp for
    sub-integer steps) + unit; booleans render as "on" / "off". */
export function fmt(spec: ParamSpec, v: ParamValue | undefined): string {
  if (typeof v === 'number') return `${spec.step && spec.step < 1 ? v.toFixed(2) : Math.round(v)}${spec.unit ?? ''}`;
  return v ? 'on' : 'off';
}

/** A pixel span read-out ("first – last"), or an em-dash when there is none. */
export const fmtSpan = (s: PixelSpan | null | undefined): string => (s ? `${s.first} – ${s.last}` : '—');

/** A universe-snap read-out: an explicit universe ("u3"), or "dense" when auto-packing. */
export const uLabel = (u: number | undefined): string => (u === undefined ? 'dense' : `u${u}`);
