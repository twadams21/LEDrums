/* Pure view-model helpers for the device strip (effect chains, S06b). No runes, no DOM: the
   Trigger / Target cards, the Effect header and the reorder drags all route their decisions
   through here so the rules are unit-tested once and the components stay thin. */

import { effectChain, voice, type PixelModel } from '@ledrums/core';
import type { EffectsAuthoringApi, GridRow } from '../../../../trigger-lab/effects-api';

type Effect = effectChain.Effect;
type EffectTarget = effectChain.EffectTarget;
type EffectTrigger = effectChain.EffectTrigger;
type ClockEvery = effectChain.ClockEvery;
type AmpLength = effectChain.AmpLength;
type Retrigger = effectChain.Retrigger;
type TriggerKind = EffectTrigger['kind'];

export interface Option<V extends string = string> {
  value: V;
  label: string;
  disabled?: boolean;
}

// ---- reorder ----------------------------------------------------------------------------

/**
 * Turn a drop GAP in the original list (0 = before the first item, `length` = after the last)
 * into the FINAL index the store's move ops take (`moveEffect` / `moveModifier` both address
 * the position after the item is lifted out). Null when the drop leaves the item where it is.
 */
export function gapToIndex(from: number, gap: number, length: number): number | null {
  if (from < 0 || from >= length) return null;
  const g = Math.max(0, Math.min(length, Math.trunc(gap)));
  if (g === from || g === from + 1) return null;
  return g > from ? g - 1 : g;
}

/** A keyboard nudge (−1 / +1) as a final index; null at either end. */
export function nudgeIndex(from: number, delta: -1 | 1, length: number): number | null {
  const to = from + delta;
  return from < 0 || from >= length || to < 0 || to >= length ? null : to;
}

/** Which gap a pointer at `pos` over an item spanning `[start, start + size)` points at. */
export function gapAt(index: number, pos: number, start: number, size: number): number {
  return pos > start + size / 2 ? index + 1 : index;
}

// ---- Effect header ------------------------------------------------------------------------

const BLEND_LABEL: Record<Effect['blend'], string> = {
  normal: 'Normal',
  add: 'Add',
  screen: 'Screen',
  multiply: 'Multiply',
  lighten: 'Lighten',
  max: 'Max',
};

export const BLEND_OPTIONS: Option<Effect['blend']>[] = effectChain.blendModeSchema.options.map((value) => ({
  value,
  label: BLEND_LABEL[value],
}));

export const RETRIGGER_OPTIONS: Option<Retrigger>[] = [
  { value: 'overlap', label: 'Overlap' },
  { value: 'restart', label: 'Restart' },
  { value: 'ignore', label: 'Ignore' },
  { value: 'cut', label: 'Cut' },
];

/** The Retrigger ⓘ: what each option does to light already playing. */
export const RETRIGGER_INFO =
  'What a hit does to light already playing. Overlap: plays on top. Restart: this Effect’s earlier light fades out on its release. Ignore: skips the hit while this Effect is still lit. Cut: stops all earlier light in this cell at once, with no fade — including the previous step of a Sequence or Random cell.';

/** The name the header shows: the authored name, else the Generator's default label. */
export function effectDisplayName(effect: Effect): string {
  if (effect.name.trim()) return effect.name;
  const def = effectChain.getGeneratorDef(effect.generator.kind);
  return def?.label ?? effect.generator.kind;
}

export function percent(v: number): string {
  return `${Math.round(v * 100)}%`;
}

// ---- Trigger card -----------------------------------------------------------------------

export const TRIGGER_KIND_LABEL: Record<TriggerKind, string> = {
  zone: 'Zone',
  always: 'Always',
  clock: 'Clock',
  cue: 'Cue',
};

/** The trigger kinds offered for an Effect in `row` — zone is disabled on the Kit row. */
export function triggerKindOptions(row: string): Option<TriggerKind>[] {
  return (['zone', 'always', 'clock', 'cue'] as const).map((value) => ({
    value,
    label: TRIGGER_KIND_LABEL[value],
    disabled: value === 'zone' && row === effectChain.KIT_ROW,
  }));
}

/** The trigger an Effect gets when its kind is switched (the kind's schema defaults). */
export function defaultTrigger(kind: TriggerKind): EffectTrigger {
  return effectChain.effectTriggerSchema.parse({ kind });
}

/** Clock divisions offered on the Trigger card, as stable string values. */
const CLOCK_DIVISIONS: readonly { value: string; label: string; every: ClockEvery }[] = [
  { value: 'b0.25', label: '1/16', every: { beats: 0.25 } },
  { value: 'b0.5', label: '1/8', every: { beats: 0.5 } },
  { value: 'b1', label: '1 beat', every: { beats: 1 } },
  { value: 'b2', label: '2 beats', every: { beats: 2 } },
  { value: 'r1', label: '1 bar', every: { bars: 1 } },
  { value: 'r2', label: '2 bars', every: { bars: 2 } },
  { value: 'r4', label: '4 bars', every: { bars: 4 } },
  { value: 'r8', label: '8 bars', every: { bars: 8 } },
];

export function clockEveryValue(every: ClockEvery): string {
  return 'beats' in every ? `b${every.beats}` : `r${every.bars}`;
}

/** The division options; an authored period the list doesn't carry is kept as its own option. */
export function clockEveryOptions(current: ClockEvery): Option[] {
  const options: Option[] = CLOCK_DIVISIONS.map(({ value, label }) => ({ value, label }));
  const value = clockEveryValue(current);
  if (!options.some((o) => o.value === value)) {
    const label = 'beats' in current ? `${current.beats} beats` : `${current.bars} bars`;
    options.push({ value, label });
  }
  return options;
}

export function clockEveryFromValue(value: string): ClockEvery | null {
  const known = CLOCK_DIVISIONS.find((d) => d.value === value);
  if (known) return known.every;
  const n = Number(value.slice(1));
  if (!Number.isFinite(n) || n <= 0) return null;
  return value.startsWith('r') ? { bars: n } : value.startsWith('b') ? { beats: n } : null;
}

/** Parse a committed CommitInput value into a MIDI 0–127 number, `undefined` when cleared,
    or null when it is not a valid entry (the caller ignores it). */
export function parseMidi(raw: string): number | undefined | null {
  if (raw.trim() === '') return undefined;
  const n = Number(raw);
  return Number.isInteger(n) && n >= 0 && n <= 127 ? n : null;
}

// ---- Amp envelope -------------------------------------------------------------------------

export type AmpLengthMode = 'ms' | 'beats' | 'hold' | 'loop' | 'auto';

export const AMP_LENGTH_OPTIONS: Option<AmpLengthMode>[] = [
  { value: 'ms', label: 'Time' },
  { value: 'beats', label: 'Beats' },
  { value: 'hold', label: 'While held' },
  { value: 'loop', label: 'Loop' },
];

/** The Sustain choices for this Generator: the four, plus "until it ends" first where the
    Generator can say when its content ends (Dot: "Until dots end" — Tim, 2026-10-05). */
export function ampLengthOptions(device: effectChain.GeneratorDevice): Option<AmpLengthMode>[] {
  if (!effectChain.supportsAutoLength(device)) return AMP_LENGTH_OPTIONS;
  return [{ value: 'auto', label: device.kind === 'dot' ? 'Until dots end' : 'Until it ends' }, ...AMP_LENGTH_OPTIONS];
}

export function ampLengthMode(length: AmpLength): AmpLengthMode {
  if (length === 'hold' || length === 'loop' || length === 'auto') return length;
  return 'ms' in length ? 'ms' : 'beats';
}

/** Switch the length mode, carrying a sensible value into a timed mode. */
export function ampLengthFor(mode: AmpLengthMode, current: AmpLength): AmpLength {
  if (mode === 'hold' || mode === 'loop' || mode === 'auto') return mode;
  if (mode === ampLengthMode(current)) return current;
  return mode === 'ms' ? { ms: 500 } : { beats: 1 };
}

export function formatMs(ms: number): string {
  return ms >= 1000 ? `${(ms / 1000).toFixed(ms % 1000 === 0 ? 0 : 2)}s` : `${Math.round(ms)}ms`;
}

const MS_PER_BEAT_AT_120 = 500;
/** A stage's length in ms: its beats at 120 bpm when it is in beats. */
export const stageMs = (ms: number, beats: number | undefined): number => (beats !== undefined ? beats * MS_PER_BEAT_AT_120 : ms);

/** A beat count as it reads on a face: a common division under a beat (`0.25` → `1/16`), else `N bt`. */
export function beatsLabel(beats: number): string {
  const divisions: Array<[number, string]> = [
    [0.125, '1/32'], [1 / 6, '1/16t'], [0.1875, '1/32.'], [0.25, '1/16'], [1 / 3, '1/8t'], [0.375, '1/16.'],
    [0.5, '1/8'], [2 / 3, '1/4t'], [0.75, '1/8.'],
  ];
  for (const [value, label] of divisions) if (Math.abs(beats - value) < 1e-6) return label;
  return `${Number(beats.toFixed(3))} bt`;
}

/** The amp patch that switches a stage between ms and beats, keeping its length (at 120 bpm). */
export function stageUnitPatch(
  stage: 'attack' | 'release',
  unit: 'ms' | 'beats',
  amp: effectChain.AmpEnvelope,
): Partial<effectChain.AmpEnvelope> {
  const msKey = stage === 'attack' ? 'attackMs' : 'releaseMs';
  const beatsKey = stage === 'attack' ? 'attackBeats' : 'releaseBeats';
  const beats = amp[beatsKey];
  if (unit === 'beats') {
    if (beats !== undefined) return {};
    // The nearest sixteenth of a beat, so a converted value reads as a clean division.
    return { [beatsKey]: Math.max(0, Math.round((amp[msKey] / MS_PER_BEAT_AT_120) * 16) / 16) };
  }
  if (beats === undefined) return {};
  return { [msKey]: Math.round(beats * MS_PER_BEAT_AT_120), [beatsKey]: undefined };
}

/**
 * The brightness envelope's outline for a `width`×`height` preview, as an SVG path: the attack
 * on its curve, the old ADSR drop (only when an Effect still uses one), the sustain, the decay.
 * Timed stages are scaled so the whole envelope fits; the sustain gets a fixed share so a 0 ms
 * envelope still reads.
 */
export function ampPath(input: effectChain.AmpEnvelope, width: number, height: number, pad = 2): string {
  // A stage in beats is drawn at 120 bpm — the outline shows the shape, not the tempo.
  const amp = { ...input, attackMs: stageMs(input.attackMs, input.attackBeats), releaseMs: stageMs(input.releaseMs, input.releaseBeats) };
  const w = width - pad * 2;
  const h = height - pad * 2;
  const hold = typeof amp.length === 'object' && 'ms' in amp.length ? Math.max(0, amp.length.ms - amp.attackMs - amp.decayMs) : 0;
  const timed = amp.attackMs + amp.decayMs + amp.releaseMs + hold;
  const plateau = 0.25;
  const scale = timed > 0 ? (w * (1 - plateau)) / timed : 0;
  const bottom = pad + h;
  const top = pad;
  const sustainY = pad + h * (1 - amp.sustainLevel);
  const x1 = pad + amp.attackMs * scale;
  const x2 = x1 + amp.decayMs * scale;
  const x3 = x2 + w * plateau + hold * scale;
  const x4 = x3 + amp.releaseMs * scale;
  const f = (n: number) => n.toFixed(1);
  // The attack on its curve: sampled, so an ease-in swell reads as one.
  const curve = amp.attackEase && amp.attackEase.fn !== 'linear' ? amp.attackEase : null;
  let attack = `L${f(x1)} ${f(top)}`;
  if (curve && x1 > pad) {
    const pts: string[] = [];
    for (let i = 1; i <= 12; i++) {
      const t = i / 12;
      pts.push(`L${f(pad + (x1 - pad) * t)} ${f(bottom - (bottom - top) * voice.ease(curve, t))}`);
    }
    attack = pts.join(' ');
  }
  return `M${f(pad)} ${f(bottom)} ${attack} L${f(x2)} ${f(sustainY)} L${f(x3)} ${f(sustainY)} L${f(Math.min(x4, pad + w))} ${f(bottom)}`;
}

// ---- Target card --------------------------------------------------------------------------

export type TargetKind = EffectTarget['kind'];

export const TARGET_KIND_OPTIONS: Option<TargetKind>[] = [
  { value: 'kit', label: 'Kit' },
  { value: 'hitDrum', label: 'Hit drum' },
  { value: 'select', label: 'Select' },
];

/** The target a kind switch produces. Select starts from the row's drum (or every drum on the Kit row). */
export function targetForKind(kind: TargetKind, effect: Effect, drums: readonly GridRow[]): EffectTarget {
  if (kind !== 'select') return { kind };
  if (effect.target.kind === 'select') return effect.target;
  const row = effect.cell.row;
  const ids = row === effectChain.KIT_ROW ? drums.map((d) => d.id) : [row];
  return { kind: 'select', drums: ids.map((drumId) => ({ drumId })) };
}

type SelectTarget = Extract<EffectTarget, { kind: 'select' }>;

/** Toggle a drum in a Select target, keeping kit order. */
export function toggleTargetDrum(target: SelectTarget, drumId: string, drums: readonly GridRow[]): SelectTarget {
  const has = target.drums.some((d) => d.drumId === drumId);
  const next = has
    ? target.drums.filter((d) => d.drumId !== drumId)
    : [...target.drums, { drumId }];
  const order = new Map(drums.map((d, i) => [d.id, i]));
  next.sort((a, b) => (order.get(a.drumId) ?? 1e9) - (order.get(b.drumId) ?? 1e9));
  return { kind: 'select', drums: next };
}

/**
 * Toggle one hoop (1-based) of a selected drum. A drum with no `hoops` list is the whole drum:
 * toggling a hoop there narrows it to every OTHER hoop. Toggling the last hoop off, or every
 * hoop on, returns to the whole drum (no `hoops`), so there is one spelling of "whole drum".
 */
export function toggleTargetHoop(target: SelectTarget, drumId: string, hoop: number, hoopCount: number): SelectTarget {
  const all = Array.from({ length: hoopCount }, (_, i) => i + 1);
  return {
    kind: 'select',
    drums: target.drums.map((d) => {
      if (d.drumId !== drumId) return d;
      const current = d.hoops ?? all;
      const next = current.includes(hoop) ? current.filter((h) => h !== hoop) : [...current, hoop].sort((a, b) => a - b);
      return next.length === 0 || next.length >= hoopCount ? { drumId } : { drumId, hoops: next };
    }),
  };
}

/** Whether hoop `hoop` of `drumId` is lit by a Select target. */
export function targetHoopOn(target: SelectTarget, drumId: string, hoop: number): boolean {
  const drum = target.drums.find((d) => d.drumId === drumId);
  return !!drum && (!drum.hoops || drum.hoops.includes(hoop));
}

/**
 * Optional strip extension (reported gap): `EffectsAuthoringApi` does not expose a drum's hoop
 * count, which the Target card needs to offer per-hoop picking. A host that has the kit may add
 * `drumHoopCount(drumId)`; without it the card offers whole-drum selection only.
 */
export interface StripKitInfo {
  drumHoopCount(drumId: string): number;
  /** The kit's bounds in mm, when the host knows its geometry (a Slice's Space box). */
  kitBounds?(): { min: { x: number; y: number; z: number }; max: { x: number; y: number; z: number } };
  /** How many pixels hoop `hoop` (1-based) of a drum has (Dot's Start pixel). */
  hoopPixelCount?(drumId: string, hoop: number): number;
  /** The kit laid out for a point picker: its bounds and each drum's extent (Dot's Start point). */
  kitPlan?(): KitPlan;
}

type Vec3 = { x: number; y: number; z: number };
/** The kit in plan: its bounds and every drum's extent, mm (z up). */
export interface KitPlan {
  bounds: { min: Vec3; max: Vec3 };
  drums: { id: string; label: string; min: Vec3; max: Vec3 }[];
}

/** A kit plan from a pixel model: each drum's extent is the box round its pixels. */
export function kitPlanOf(model: PixelModel): KitPlan {
  const drums = model.drums.map((d) => {
    const min = { x: Infinity, y: Infinity, z: Infinity };
    const max = { x: -Infinity, y: -Infinity, z: -Infinity };
    for (let i = d.pixelStart; i < d.pixelStart + d.pixelCount; i++) {
      const w = model.pixels[i]!.world;
      for (const k of ['x', 'y', 'z'] as const) {
        min[k] = Math.min(min[k], w[k]);
        max[k] = Math.max(max[k], w[k]);
      }
    }
    return { id: d.drumId, label: d.label, min, max };
  });
  return { bounds: { min: { ...model.bounds.min }, max: { ...model.bounds.max } }, drums: drums.filter((d) => d.min.x <= d.max.x) };
}

/** A hoop's pixel count from a host that reports it, else 0. */
export function hoopPixelCount(api: EffectsAuthoringApi, drumId: string, hoop: number): number {
  const fn = (api as Partial<StripKitInfo>).hoopPixelCount;
  const n = typeof fn === 'function' ? fn.call(api, drumId, hoop) : 0;
  return Number.isInteger(n) && n > 0 ? n : 0;
}

/** The kit plan from a host that reports it, else null. */
export function kitPlan(api: EffectsAuthoringApi): KitPlan | null {
  const fn = (api as Partial<StripKitInfo>).kitPlan;
  return typeof fn === 'function' ? fn.call(api) : null;
}

/** The kit's bounds from a host that reports them, else null. */
export function kitBounds(api: EffectsAuthoringApi): { min: { x: number; y: number; z: number }; max: { x: number; y: number; z: number } } | null {
  const fn = (api as Partial<StripKitInfo>).kitBounds;
  return typeof fn === 'function' ? fn.call(api) : null;
}

export function drumHoopCount(api: EffectsAuthoringApi, drumId: string): number {
  const fn = (api as Partial<StripKitInfo>).drumHoopCount;
  if (typeof fn !== 'function') return 0;
  const n = fn.call(api, drumId);
  return Number.isInteger(n) && n > 0 ? n : 0;
}

// ---- highlight toggling -----------------------------------------------------------------------

/** What counts as a control inside a highlightable area: a press on one edits, it never toggles. */
const CONTROL_SELECTOR =
  'button, input, select, textarea, a[href], [role], [draggable="true"], [contenteditable="true"], svg, .facectl, .colorfield';

/**
 * Is this press on a control inside `root` (a card, an Effect's name bar) rather than on the area
 * itself — its title, labels, blank space? A second click on the AREA un-highlights it (Tim,
 * 2026-10-01); a click on a control must not, or editing a highlighted card would keep switching it
 * off. `surface` names elements inside `root` that count as the area even though they are controls
 * (the Effect's name, a button only for keyboard focus and double-click rename).
 */
export function isControlPress(target: EventTarget | null, root: Element, surface?: string): boolean {
  if (!(target instanceof Element) || !root.contains(target)) return false;
  if (surface && target.closest(surface)) return false;
  const hit = target.closest(CONTROL_SELECTOR);
  return !!hit && hit !== root && root.contains(hit);
}
