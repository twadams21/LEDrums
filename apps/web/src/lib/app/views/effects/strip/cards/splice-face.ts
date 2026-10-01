/* The Splice Generator card's sections, as the graph-era Splice inspector laid them out (Tim,
   2026-10-01: "bring it back as close to that version, if not exactly the same … with the new
   layout"). Ported from `views/splice-options.ts` on `main` (v0.3.5) onto Generator params:
   the same labels, options and help text, the same merged timing dropdowns, the same MOVE THROUGH
   layer map. Pure TS, so the decisions are unit-tested without a DOM. */
import { voice } from '@ledrums/core';
import type { ParamValue, SpliceSlot } from './card-model';

type Params = Readonly<Record<string, ParamValue>>;
type Opt<T extends string = string> = { value: T; label: string };

export const SPLICE_PARTITION_OPTS: Opt[] = [
  { value: 'hoop', label: 'Hoop' },
  { value: 'drum', label: 'Drum' },
  { value: 'scope', label: 'Scope' },
];

export const SPLICE_CHASE_OPTS: Opt[] = [
  { value: 'off', label: 'Off' },
  { value: 'step', label: 'Chase' },
  { value: 'smooth', label: 'Spin' },
  { value: 'stagger', label: 'Stagger' },
];

/** One-line explanation of what each motion actually moves — the three are easy to confuse. */
export const SPLICE_CHASE_HINTS: Record<string, string> = {
  off: 'The splices hold still.',
  step: 'Each splice hands its content to the next one, a splice per interval.',
  smooth: 'The whole cut glides around, one full lap per interval.',
  stagger: 'The whole cut jumps by a set number of pixels each interval — the same movement as Spin, but landing on steps instead of gliding.',
};

export const SPLICE_MOTION_MODE_OPTS: Opt[] = [
  { value: 'restart', label: 'Restart' },
  { value: 'continuous', label: 'Continuous' },
  { value: 'latched', label: 'Latched' },
];

/** What a hit does to the motion — the pair is easy to mix up, so each says it outright. */
export const SPLICE_MOTION_MODE_HINTS: Record<string, string> = {
  restart: 'Every hit puts the movement back to its starting position.',
  continuous: 'The movement free-runs, even while the kit is dark — a hit lands wherever it has travelled unseen.',
  latched: 'The movement only runs while the lights are up: it stops where the fade left it, and the next hit carries on from there.',
};

export const SPLICE_DIRECTION_OPTS: Opt[] = [
  { value: '1', label: 'Forward' },
  { value: '-1', label: 'Reverse' },
];

export const SPLICE_WAIT_MODE_OPTS: Opt[] = [
  { value: 'lit', label: 'Lit' },
  { value: 'dark', label: 'Dark' },
  { value: 'fade', label: 'Fade' },
  { value: 'pulse', label: 'Pulse' },
];

/** What a unit does before the cascade reaches it — whether the LIGHT travels or only the movement. */
export const SPLICE_WAIT_MODE_HINTS: Record<string, string> = {
  lit: 'Everything lights at once and holds still until the movement reaches it.',
  dark: 'Nothing lights until its turn comes, so the light itself travels across the kit.',
  fade: 'Each one fades up as its turn arrives and then stays lit — so every colour eases in, not just the first.',
  pulse: 'Each one runs its own attack, hold and fade as the cascade reaches it, then goes dark again — a pulse travelling across the kit.',
};

/** The order the units start moving in when a cascade offset is set. */
export const SPLICE_ORDER_OPTS: Opt[] = [
  { value: 'up', label: 'Up' },
  { value: 'down', label: 'Down' },
  { value: 'outside-in', label: 'Outside in' },
  { value: 'random', label: 'Random' },
];

/** Round a hoop, Up and Down mean nothing: they read Forward and Reverse (the hoop's pixel order). */
export const SPLICE_AROUND_ORDER_OPTS: Opt[] = [
  { value: 'up', label: 'Forward' },
  { value: 'down', label: 'Reverse' },
  { value: 'outside-in', label: 'Outside in' },
  { value: 'random', label: 'Random' },
];

// ---- timing: one dropdown of divisions + "Free (ms)" ----------------------------------------

/** The Generator's "no offset" division value (core's `SPLICE_NO_DIVISION`). */
export const NO_DIVISION = 'none';
/** The dropdown value standing for free time in milliseconds. */
export const FREE_MS = '@ms';

/** A division as it reads: `1-bar` → 1 bar, `dotted-1/8` → 1/8 dotted. */
export function divisionLabel(d: string): string {
  if (d === '1-bar') return '1 bar';
  if (d.endsWith('-bars')) return d.replace('-bars', ' bars');
  if (d.startsWith('dotted-')) return `${d.replace('dotted-', '')} dotted`;
  if (d.startsWith('triplet-')) return `${d.replace('triplet-', '')} triplet`;
  return d;
}

const DIVISIONS: Opt[] = voice.DELAY_DIVISIONS.map((d) => ({ value: d, label: divisionLabel(d) }));

/** The params behind one timing: its mode (`beats` | `time`), division and milliseconds. */
export interface TimingKeys {
  mode: string;
  division: string;
  ms: string;
}
export const RATE_KEYS: TimingKeys = { mode: 'rateMode', division: 'division', ms: 'rateMs' };
export const HOOP_KEYS: TimingKeys = { mode: 'offsetMode', division: 'offsetDivision', ms: 'offsetMs' };
export const DRUM_KEYS: TimingKeys = { mode: 'drumOffsetMode', division: 'drumOffsetDivision', ms: 'drumOffsetMs' };
export const COLOUR_KEYS: TimingKeys = { mode: 'colorOffsetMode', division: 'colorOffsetDivision', ms: 'colorOffsetMs' };

/** The motion rate's dropdown: the divisions, then Free (ms). */
export const RATE_OPTIONS: Opt[] = [...DIVISIONS, { value: FREE_MS, label: 'Free (ms)' }];
/** A cascade offset's dropdown: None (together), the divisions, then Free (ms). */
export const OFFSET_OPTIONS: Opt[] = [{ value: NO_DIVISION, label: 'None (together)' }, ...DIVISIONS, { value: FREE_MS, label: 'Free (ms)' }];

const str = (params: Params, key: string): string | undefined => (typeof params[key] === 'string' ? (params[key] as string) : undefined);
const numOf = (params: Params, key: string, fallback: number): number => (typeof params[key] === 'number' ? (params[key] as number) : fallback);

/** What a timing dropdown shows for the stored mode + division. */
export function timingValue(params: Params, keys: TimingKeys, fallback: string): string {
  if (str(params, keys.mode) === 'time') return FREE_MS;
  return str(params, keys.division) ?? fallback;
}

/** The params a timing choice writes: Free flips the mode only (the division survives a round
    trip); a division sets it and puts the mode back to beats. */
export function timingPatch(choice: string, keys: TimingKeys): Record<string, ParamValue> {
  if (choice === FREE_MS) return { [keys.mode]: 'time' };
  return { [keys.mode]: 'beats', [keys.division]: choice };
}

/** Is this cascade sending light anywhere — a division chosen, or a free time above zero? The
    Order row shows only then: an order for a layer that is off is a control that does nothing. */
export function timingActive(params: Params, keys: TimingKeys): boolean {
  if (str(params, keys.mode) === 'time') return numOf(params, keys.ms, 0) > 0;
  const d = str(params, keys.division);
  return !!d && d !== NO_DIVISION;
}

// ---- MOVE THROUGH ----------------------------------------------------------------------------

/**
 * One MOVE THROUGH layer and the params it edits. The engine keeps its original axes — a primary
 * cascade across the cut's units, a drum cascade, a colour cascade — and this maps "where the
 * light is sent" onto them. THROUGH KIT is drum to drum: on a drum cut the drums ARE the units
 * (the primary axis), otherwise it is the drum axis. THROUGH DRUM is hoop to hoop (a hoop cut
 * only). AROUND is splice to splice within each unit.
 */
export interface ThroughLayer {
  keys: TimingKeys;
  /** The pattern param the order buttons set (a dragged sequence overrides it). */
  pattern: 'order' | 'drumOrder' | 'colorOrder';
  /** The dragged-sequence param (comma-separated ids), or null for a pattern-only layer. */
  sequence: 'drumSequence' | 'hoopSequence' | null;
}

export function throughKitLayer(partition: string): ThroughLayer {
  return partition === 'drum'
    ? { keys: HOOP_KEYS, pattern: 'order', sequence: 'drumSequence' }
    : { keys: DRUM_KEYS, pattern: 'drumOrder', sequence: 'drumSequence' };
}
export const THROUGH_DRUM_LAYER: ThroughLayer = { keys: HOOP_KEYS, pattern: 'order', sequence: 'hoopSequence' };
export const AROUND_LAYER: ThroughLayer = { keys: COLOUR_KEYS, pattern: 'colorOrder', sequence: null };

/** The AROUND row's label: the unit the splices go round. A scope cut is one run they lie along. */
export function aroundLabel(partition: string): string {
  return partition === 'drum' ? 'AROUND DRUM' : partition === 'scope' ? 'ALONG THE CUT' : 'AROUND HOOP';
}

/** A stored comma-separated sequence as ids. */
export function sequenceOf(params: Params, key: string | null): string[] {
  const v = key ? str(params, key) : undefined;
  return v ? v.split(',').map((s) => s.trim()).filter((s) => s.length > 0) : [];
}

/**
 * The ids in the order they will fire: a dragged sequence (completed exactly as the engine ranks
 * it — unknown ids dropped, missing ones appended), else the pattern's own order. What the chips
 * show, so the card always reads the way the lights will come on.
 */
export function effectiveOrder(ids: readonly string[], sequence: readonly string[], pattern: string, seed: number): string[] {
  if (sequence.length) {
    const ranks = voice.sequenceRanks(ids, sequence);
    const out = new Array<string>(ids.length);
    ids.forEach((id, i) => (out[ranks[i]!] = id));
    return out;
  }
  return voice.orderedByPattern(ids.length, pattern as voice.SpliceOrder, seed).map((i) => ids[i]!);
}

// ---- which layers apply ----------------------------------------------------------------------

/** How many drums the Effect's Target lights: the whole kit, the struck drum, or a selection. */
export function targetDrumCount(target: { kind: string; drums?: readonly unknown[] }, kitDrums: number): number {
  if (target.kind === 'kit') return kitDrums;
  if (target.kind === 'select') return target.drums?.length ?? 0;
  return 1;
}

/** THROUGH KIT needs more than one drum and a cut whose units can be drums. */
export const showThroughKit = (partition: string, drums: number): boolean => drums > 1 && partition !== 'scope';
/** THROUGH DRUM needs hoops as units. */
export const showThroughDrum = (partition: string): boolean => partition === 'hoop';
/** AROUND is a reveal: with Lit every splice is already on, so it has nothing to do. */
export const showAround = (waitMode: string): boolean => waitMode !== 'lit';

// ---- the Splices rows ------------------------------------------------------------------------

/** The band count, clamped as the engine clamps it. */
export function spliceCountOf(params: Params): number {
  const n = typeof params.count === 'number' ? params.count : voice.DEFAULT_SPLICE_COUNT;
  return Math.max(voice.MIN_SPLICE_COUNT, Math.min(voice.MAX_SPLICE_COUNT, Math.round(n)));
}

/**
 * The slots as exactly `count` rows: the authored ones, then copies of what the engine's cycling
 * fallback would render there (2 slots → 4 rows reads red, blue, red, blue) — so raising the count
 * reads as "cut finer", not "add gaps", and editing a cycled row changes nothing else on screen.
 * With nothing authored the rows are blank. Shrinking keeps the leading rows.
 */
export function slotsAtCount(slots: readonly SpliceSlot[], count: number): SpliceSlot[] {
  return Array.from({ length: count }, (_, i) => {
    if (i < slots.length) return slots[i]!;
    return slots.length ? (JSON.parse(JSON.stringify(slots[i % slots.length])) as SpliceSlot) : {};
  });
}

// ---- Slice ------------------------------------------------------------------------------------

/** Slice motion: the same four modes, named for what they do to SLABS (a slab sweeps along a
    straight axis; "spin" would promise a rotation the slice does not do). */
export const SLICE_CHASE_OPTS: Opt[] = [
  { value: 'off', label: 'Off' },
  { value: 'step', label: 'Chase' },
  { value: 'smooth', label: 'Sweep' },
  { value: 'stagger', label: 'Stagger' },
];

export const SLICE_CHASE_HINTS: Record<string, string> = {
  off: 'The slices hold still.',
  step: 'Each slice hands its content to the next one, a slice per interval.',
  smooth: 'The slices glide along the axis through the kit, one whole span per interval, wrapping round at the end.',
  stagger: 'The slices jump along the axis by a set share of the span each interval — the same movement as Sweep, landing on steps instead of gliding.',
};

/** What a slice cuts. SPACE is a box of the room you place and size. */
export const SLICE_ON_OPTS: Opt[] = [
  { value: 'kit', label: 'Kit' },
  { value: 'drum', label: 'Drum' },
  { value: 'space', label: 'Space' },
];

export const SLICE_AXIS_OPTS: Opt[] = [
  { value: 'x', label: 'X' },
  { value: 'y', label: 'Y' },
  { value: 'z', label: 'Z' },
];

/** The Space box's params: centre and size, mm. */
export const REGION_KEYS = ['regionCx', 'regionCy', 'regionCz', 'regionSx', 'regionSy', 'regionSz'] as const;
export type RegionKey = (typeof REGION_KEYS)[number];

export function hasRegion(params: Params): boolean {
  return REGION_KEYS.every((k) => typeof params[k] === 'number');
}

/** What the Slice cuts, read from its Target and Space box: Space > Kit > Drum. */
export function sliceOnOf(target: { kind: string }, params: Params): 'kit' | 'drum' | 'space' {
  if (hasRegion(params)) return 'space';
  return target.kind === 'kit' ? 'kit' : 'drum';
}

type Vec = { x: number; y: number; z: number };
/** A Space box that starts as the whole kit, so choosing Space changes nothing on the first frame. */
export function regionFromBounds(bounds: { min: Vec; max: Vec } | null): Record<RegionKey, number> {
  const min = bounds?.min ?? { x: -500, y: -500, z: -500 };
  const max = bounds?.max ?? { x: 500, y: 500, z: 500 };
  return {
    regionCx: Math.round((min.x + max.x) / 2),
    regionCy: Math.round((min.y + max.y) / 2),
    regionCz: Math.round((min.z + max.z) / 2),
    regionSx: Math.max(1, Math.round(max.x - min.x)),
    regionSy: Math.max(1, Math.round(max.y - min.y)),
    regionSz: Math.max(1, Math.round(max.z - min.z)),
  };
}

/** The params that clear the Space box. */
export const NO_REGION: Record<RegionKey, undefined> = {
  regionCx: undefined,
  regionCy: undefined,
  regionCz: undefined,
  regionSx: undefined,
  regionSy: undefined,
  regionSz: undefined,
};

/** THROUGH SLICES: the slabs are the slice's primary axis, ordered by pattern only. */
export const THROUGH_SLICES_LAYER: ThroughLayer = { keys: HOOP_KEYS, pattern: 'order', sequence: null };
