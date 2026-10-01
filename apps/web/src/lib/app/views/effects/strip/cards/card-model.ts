/* The pure model behind the device cards (Generator / Modifier / Control).

   Every decision a card makes that is not layout lives here, so it is unit-testable without a
   DOM: which params a card shows (and which a mode hides), how a value reads, which params a
   control is driving (the "modulated" badge), the list a mapping can target, and the Envelope
   control's shape presets. No runes, no DOM. */
import { effectChain, tryGetEffect, tryGetModifier, voice, type ParamSpec } from '@ledrums/core';

type Effect = effectChain.Effect;
type GeneratorDevice = effectChain.GeneratorDevice;
type GeneratorKind = effectChain.GeneratorKind;
type ControlKind = effectChain.ControlKind;
type ControlMapping = effectChain.ControlMapping;
export type ParamValue = number | boolean | string;

/** One param as a card renders it (core's `type` is `kind` here, as on a node face). */
export interface CardParam {
  key: string;
  label: string;
  kind: 'number' | 'bool' | 'enum' | 'color';
  min?: number;
  max?: number;
  step?: number;
  unit?: string;
  options?: string[];
  default: ParamValue;
  /** A 0..1 amount read as a whole percent (`0.25` → `25`, unit `%`). */
  percent?: boolean;
  /** An explanation, shown behind an ⓘ beside the label (never as a paragraph under it). */
  info?: string;
}

export function toCardParam(spec: ParamSpec): CardParam {
  return {
    key: spec.key,
    label: spec.label,
    kind: spec.type,
    min: spec.min,
    max: spec.max,
    step: spec.step,
    unit: spec.unit,
    options: spec.options,
    default: spec.default,
  };
}

/** The device's own value for `p`, else the spec default (an unwritten param has no entry). */
export function paramValue(p: CardParam, params: Readonly<Record<string, ParamValue>> | undefined): ParamValue {
  const v = params?.[p.key];
  if (v === undefined) return p.default;
  if (p.kind === 'enum' && (typeof v !== 'string' || !(p.options ?? []).includes(v))) return p.default;
  return v;
}

/** A unit as it reads after a number: symbols hug (`90°`, `50%`), words get a space (`4 beats`). */
function unitSuffix(unit: string | undefined): string {
  if (!unit) return '';
  return /^[a-z]/i.test(unit) ? ` ${unit}` : unit;
}

/** The read-out for a value: numbers honour the step (2dp for sub-integer steps) and, unless
    `unit: false` (the card prints the unit beside the label so the field fits the number), the unit. */
export function formatParam(p: CardParam, v: ParamValue, opts: { unit?: boolean } = {}): string {
  if (typeof v === 'boolean') return v ? 'On' : 'Off';
  if (typeof v === 'string') return enumLabel(v);
  if (p.percent) return opts.unit === false ? String(Math.round(v * 100)) : `${Math.round(v * 100)}%`;
  const n = p.step !== undefined && p.step < 1 ? v.toFixed(2) : String(Math.round(v));
  return opts.unit === false ? n : `${n}${unitSuffix(p.unit)}`;
}

/** An enum value as a label: `outside-in` → `Outside in`, `1/8` stays `1/8`. */
export function enumLabel(v: string): string {
  if (!v) return v;
  const spaced = v.replace(/-/g, ' ');
  return spaced.charAt(0).toUpperCase() + spaced.slice(1);
}

/** A 0..1 ratio as a whole percent. */
/** A card face lists at most this many param rows top to bottom before it starts another column to
    the right (Tim, 2026-10-01: "something like 10 rows down as a maximum, then go across", then
    "maybe it can be a little more than 10 … to keep plugins as compact as possible"). */
export const PARAM_ROWS_MAX = 12;

/** How `count` param rows lay out: as few columns as keep each under {@link PARAM_ROWS_MAX}, the
    rows spread evenly across them (22 → 2 columns of 11; 30 → 3 of 10 — never 12, 12, 6). */
export function paramColumns(count: number): { columns: number; rows: number } {
  const columns = Math.max(1, Math.ceil(count / PARAM_ROWS_MAX));
  return { columns, rows: Math.max(1, Math.ceil(count / columns)) };
}

/** Does a card with this many param rows go landscape (more than one column)? */
export const isLandscape = (count: number): boolean => paramColumns(count).columns > 1;

export const pct = (v: number): string => `${Math.round(v * 100)}%`;

// ---- Generator ------------------------------------------------------------------------------

export interface KindOption {
  kind: GeneratorKind;
  label: string;
  description: string;
}

/** The Generator picker, in the registry's display order. */
export function generatorKinds(): KindOption[] {
  return effectChain.listGenerators().map((g) => ({ kind: g.id, label: g.label, description: g.description ?? '' }));
}

export function generatorLabel(kind: string): string {
  return effectChain.getGeneratorDef(kind)?.label ?? kind;
}

/** Style choices for a kind; empty for a kind without Styles (Splice / Slice). */
export function styleOptions(kind: string): { value: string; label: string }[] {
  return (effectChain.getGeneratorDef(kind)?.styles ?? []).map((s) => ({ value: s.id, label: s.label }));
}

/** The Style a device is on: its own, or the kind's first when it names none. */
export function currentStyle(device: GeneratorDevice): string {
  if (device.style) return device.style;
  return effectChain.getGeneratorDef(device.kind)?.styles[0]?.id ?? '';
}

export const isSlotted = (kind: string): boolean => kind === 'splice' || kind === 'slice';

/** The device param the Scene Generator reads its canvas scene from. */
export const SCENE_PARAM = 'sceneId';

/**
 * Which Splice / Slice params a mode makes meaningless, so the card hides them rather than
 * showing a dead control: a rate field for the rate mode not chosen, a direction / rate with
 * no motion, a stagger outside Stagger motion, a curve direction on a linear attack.
 */
function spliceParamHidden(key: string, params: Readonly<Record<string, ParamValue>>, all: readonly CardParam[]): boolean {
  const val = (k: string): ParamValue | undefined => {
    const own = params[k];
    return own !== undefined ? own : all.find((p) => p.key === k)?.default;
  };
  const chase = val('chase');
  if (chase === 'off' && ['rateMode', 'division', 'rateMs', 'direction', 'motionMode'].includes(key)) return true;
  if ((key === 'incrementPx' || key === 'incrementPct') && chase !== 'stagger') return true;
  const byMode: Record<string, [mode: string, beats: string, ms: string]> = {
    rate: ['rateMode', 'division', 'rateMs'],
    hoop: ['offsetMode', 'offsetDivision', 'offsetMs'],
    drum: ['drumOffsetMode', 'drumOffsetDivision', 'drumOffsetMs'],
    colour: ['colorOffsetMode', 'colorOffsetDivision', 'colorOffsetMs'],
  };
  for (const [mode, beats, ms] of Object.values(byMode)) {
    if (key === beats && val(mode) === 'time') return true;
    if (key === ms && val(mode) !== 'time') return true;
  }
  return false;
}

/**
 * The params the Generator card shows for this device, in declaration order. Splice / Slice
 * read their own list (mode-irrelevant fields hidden); Scene drops its picker param (the card
 * shows a scene Select for it); everything else is the chosen Style's params.
 */
export function generatorParams(device: GeneratorDevice): CardParam[] {
  if (isSlotted(device.kind)) {
    const all = effectChain.spliceGeneratorParamSpec(device.kind).map(toCardParam);
    return all.filter((p) => !spliceParamHidden(p.key, device.params, all));
  }
  return effectChain
    .generatorParamSpec(device.kind, device.style)
    .filter((s) => s.key !== SCENE_PARAM || device.kind !== 'scene')
    .map(toCardParam);
}

/** What the live thumbnail hosts: the resolved effect id + full params, or null (unknown Style,
    an unregistered scene, or a Splice / Slice — those preview through their slots instead). */
export function thumbSource(device: GeneratorDevice): { generatorId: string; params: Record<string, ParamValue> } | null {
  if (isSlotted(device.kind)) return null;
  const gen = effectChain.resolveGenerator(device);
  if (!gen || !tryGetEffect(gen.effectId)) return null;
  return { generatorId: gen.effectId, params: gen.params };
}

// ---- Splice / Slice slots -----------------------------------------------------------------

/** The value a slot's Generator Select uses for "no Generator". */
export const SLOT_NO_GENERATOR = 'none';

/** Kinds a slot may nest: any Generator but Splice / Slice (a nested splice renders blank). */
export function slotGeneratorOptions(): { value: string; label: string }[] {
  return [
    { value: SLOT_NO_GENERATOR, label: 'Colour only' },
    ...generatorKinds()
      .filter((k) => !isSlotted(k.kind))
      .map((k) => ({ value: k.kind, label: k.label })),
  ];
}

export type SpliceSlot = effectChain.SpliceSlot;

/** A short description of a slot for its row head. */
export function describeSlot(slot: SpliceSlot): string {
  if (slot.muted) return 'Off';
  const gen = slot.generator ? generatorLabel(slot.generator.kind) : '';
  const style = slot.generator ? styleOptions(slot.generator.kind).find((s) => s.value === currentStyle(slot.generator!))?.label : '';
  const genText = gen ? (style && style !== gen ? `${gen} · ${style}` : gen) : '';
  if (slot.color && genText) return `${genText}, tinted`;
  if (genText) return genText;
  if (slot.color) return slot.color.toUpperCase();
  return 'Blank';
}

export const isBlankSlot = (slot: SpliceSlot): boolean => !slot.muted && !slot.color && !slot.generator;

// ---- Modifiers ------------------------------------------------------------------------------

export function modifierLabel(modifierId: string): string {
  return tryGetModifier(modifierId)?.name ?? modifierId;
}

export function modifierParams(modifierId: string): CardParam[] {
  return (tryGetModifier(modifierId)?.paramSpec ?? []).map(toCardParam);
}

/** A tempo-synced modifier (Strobe): its speed is `rateMode` (`hz` | `beats`) + `division` + `rate`. */
export function isTempoSynced(modifierId: string): boolean {
  const keys = new Set((tryGetModifier(modifierId)?.paramSpec ?? []).map((s) => s.key));
  return keys.has('rateMode') && keys.has('division') && keys.has('rate');
}

/**
 * The params a Modifier card lists as rows. A tempo-synced modifier's speed is ONE "Rate"
 * dropdown instead (the divisions, then Free (Hz)), so its mode and division are not rows, and
 * its Hz rate is a row only while Free is picked — as Splice's and Slice's timings work.
 */
export function modifierFaceParams(modifierId: string, values: Readonly<Record<string, ParamValue>> | undefined): CardParam[] {
  const all = modifierParams(modifierId);
  if (!isTempoSynced(modifierId)) return all;
  const beats = (values?.rateMode ?? all.find((p) => p.key === 'rateMode')?.default) === 'beats';
  return all
    .filter((p) => p.key !== 'rateMode' && p.key !== 'division' && !(beats && p.key === 'rate'))
    // The dropdown is "Rate"; the Hz value under Free is its frequency.
    .map((p) => (p.key === 'rate' ? { ...p, label: 'Frequency' } : p));
}

export function modifierCategory(modifierId: string): string | undefined {
  return tryGetModifier(modifierId)?.category;
}

/** A default envelope for a modifier whose envelope is switched on: a short fade in and out. */
export const DEFAULT_MODIFIER_ENVELOPE: effectChain.ModifierEnvelopeSpec = {
  attackMs: 0,
  decayMs: 0,
  sustainLevel: 1,
  releaseMs: 200,
};

/** The four envelope fields as card params (the ADSR face). */
export const MODIFIER_ENVELOPE_PARAMS: readonly CardParam[] = [
  { key: 'attackMs', label: 'Attack', kind: 'number', min: 0, max: 5000, step: 1, unit: 'ms', default: 0 },
  { key: 'decayMs', label: 'Decay', kind: 'number', min: 0, max: 5000, step: 1, unit: 'ms', default: 0 },
  { key: 'sustainLevel', label: 'Sustain', kind: 'number', min: 0, max: 1, step: 0.01, default: 1 },
  { key: 'releaseMs', label: 'Release', kind: 'number', min: 0, max: 5000, step: 1, unit: 'ms', default: 0 },
];

/**
 * An SVG path of an ADSR shape over a `w`×`h` box: attack up to 1, decay to the sustain level,
 * a sustain plateau, release to 0. Segment widths are proportional to their times, with the
 * plateau a fixed share so a zero-time envelope still draws a readable shape.
 */
export function adsrPath(env: effectChain.ModifierEnvelopeSpec, w: number, h: number): string {
  const plateau = 0.3;
  const total = env.attackMs + env.decayMs + env.releaseMs;
  const share = (ms: number): number => (total > 0 ? (ms / total) * (1 - plateau) : (1 - plateau) / 3);
  const xa = share(env.attackMs) * w;
  const xd = xa + share(env.decayMs) * w;
  const xs = xd + plateau * w;
  const ys = h - env.sustainLevel * h;
  const f = (n: number): string => (Math.round(n * 10) / 10).toString();
  return `M0 ${f(h)} L${f(xa)} 0 L${f(xd)} ${f(ys)} L${f(xs)} ${f(ys)} L${f(w)} ${f(h)}`;
}

// ---- Controls + modulation --------------------------------------------------------------------

export const CONTROL_KIND_LABEL: Record<ControlKind, string> = {
  envelope: 'Envelope',
  lfo: 'LFO',
  velocity: 'Velocity',
  random: 'Random',
  cc: 'MIDI CC',
  osc: 'OSC',
  note: 'MIDI note',
  audio: 'Audio',
};

/** The param keys of `device` ('generator' or a modifier uid) that some control is driving. */
export function modulatedKeys(effect: Effect | undefined, device: string): Set<string> {
  const keys = new Set<string>();
  for (const c of effect?.controls ?? []) for (const m of c.mappings) if (m.device === device) keys.add(m.param);
  return keys;
}

/** One param a control mapping can drive. */
export interface MapTarget {
  device: string;
  param: string;
  /** "Wave · Speed", "Strobe 2 · Rate". */
  label: string;
  min: number;
  max: number;
}

export const mapTargetKey = (device: string, param: string): string => `${device}␟${param}`;

export function parseMapTargetKey(key: string): { device: string; param: string } | null {
  const at = key.indexOf('␟');
  if (at <= 0) return null;
  return { device: key.slice(0, at), param: key.slice(at + 1) };
}

/** A label per modifier uid, numbering repeats ("Strobe", "Strobe 2") so two are told apart. */
function modifierLabels(effect: Effect): Map<string, string> {
  const seen = new Map<string, number>();
  const out = new Map<string, string>();
  for (const m of effect.modifiers) {
    const base = modifierLabel(m.modifierId);
    const n = (seen.get(base) ?? 0) + 1;
    seen.set(base, n);
    out.set(m.uid, n === 1 ? base : `${base} ${n}`);
  }
  return out;
}

/**
 * Every param a control in this Effect can drive, in chain order: the Generator's numeric params,
 * then each Modifier's. Only numbers modulate (the resolver drops any other mapping), so enum,
 * bool and colour params are not offered.
 */
export function mappingTargets(effect: Effect): MapTarget[] {
  const out: MapTarget[] = [];
  const gen = generatorLabel(effect.generator.kind);
  for (const p of generatorParams(effect.generator)) {
    if (p.kind !== 'number') continue;
    out.push({ device: 'generator', param: p.key, label: `${gen} · ${p.label}`, min: p.min ?? 0, max: p.max ?? 1 });
  }
  const labels = modifierLabels(effect);
  for (const m of effect.modifiers) {
    for (const p of modifierParams(m.modifierId)) {
      if (p.kind !== 'number') continue;
      out.push({ device: m.uid, param: p.key, label: `${labels.get(m.uid)} · ${p.label}`, min: p.min ?? 0, max: p.max ?? 1 });
    }
  }
  return out;
}

/** The label for an existing mapping; a device no longer in the Effect reads as missing. */
export function describeMapping(effect: Effect, mapping: ControlMapping, targets: readonly MapTarget[] = mappingTargets(effect)): string {
  const t = targets.find((x) => x.device === mapping.device && x.param === mapping.param);
  if (t) return t.label;
  return `Missing · ${mapping.param}`;
}

/** A fresh mapping onto `target`: full amount, not inverted, the param's whole range. */
export function newMapping(target: MapTarget): ControlMapping {
  return { device: target.device, param: target.param, amount: 1, invert: false };
}

// ---- Control settings vocabularies ----------------------------------------------------------

export const LFO_WAVEFORM_OPTIONS = voice.LFO_WAVEFORMS.map((w) => ({
  value: w,
  label: w === 'sample-hold' ? 'S&H' : enumLabel(w),
}));

export const LFO_RATE_MODE_OPTIONS = [
  { value: 'hz', label: 'Hz' },
  { value: 'beats', label: 'Sync' },
];

export const DIVISION_OPTIONS = voice.DELAY_DIVISIONS.map((d) => ({ value: d, label: divisionLabel(d) }));

function divisionLabel(d: string): string {
  if (d.endsWith('-bars')) return d.replace('-bars', ' bars');
  if (d.startsWith('dotted-')) return `${d.replace('dotted-', '')} dotted`;
  if (d.startsWith('triplet-')) return `${d.replace('triplet-', '')} triplet`;
  return d;
}

export const RANDOM_DISTRIBUTION_OPTIONS = (
  ['linear', 'gaussian', 'exponential', 'logarithmic', 'triangular', 'beta', 'stepped'] as const
).map((d) => ({ value: d, label: enumLabel(d) }));

export const AUDIO_BAND_OPTIONS = voice.AUDIO_BANDS.map((b) => ({ value: b, label: enumLabel(b) }));

export const NOTE_MODE_OPTIONS = [
  { value: 'gate', label: 'Gate' },
  { value: 'velocity', label: 'Velocity' },
];

/** MIDI channel Select: "Any" (null) then 1–16. */
export const CHANNEL_ANY = 'any';
export const CHANNEL_OPTIONS = [
  { value: CHANNEL_ANY, label: 'Any' },
  ...Array.from({ length: 16 }, (_, i) => ({ value: String(i + 1), label: `Ch ${i + 1}` })),
];
export const channelValue = (ch: number | null): string => (ch === null ? CHANNEL_ANY : String(ch));
export const channelFromValue = (v: string): number | null => (v === CHANNEL_ANY ? null : Number(v));

// ---- Envelope control shapes -------------------------------------------------------------------

export type EnvelopeShape = 'decay' | 'rise' | 'pluck' | 'pulse';

export const ENVELOPE_SHAPE_OPTIONS: { value: EnvelopeShape; label: string }[] = [
  { value: 'decay', label: 'Decay' },
  { value: 'rise', label: 'Rise' },
  { value: 'pluck', label: 'Pluck' },
  { value: 'pulse', label: 'Pulse' },
];

type EnvPoint = { t: number; v: number };

/** The points an Envelope control stores for a shape. Decay is the default, stored as absent. */
export function envelopePoints(shape: EnvelopeShape): EnvPoint[] | undefined {
  return shape === 'decay' ? undefined : voice.presetPoints(shape);
}

/** Which preset a stored curve is; `custom` for points no preset produces (a file / import). */
export function envelopeShapeOf(points: readonly EnvPoint[] | undefined): EnvelopeShape | 'custom' {
  if (!points || points.length === 0) return 'decay';
  for (const o of ENVELOPE_SHAPE_OPTIONS) {
    const ref = voice.presetPoints(o.value);
    if (ref.length === points.length && ref.every((p, i) => Math.abs(p.t - points[i]!.t) < 1e-6 && Math.abs(p.v - points[i]!.v) < 1e-6)) {
      return o.value;
    }
  }
  return 'custom';
}

/** An SVG polyline for an envelope curve (t, v in 0..1) over a `w`×`h` box. */
export function envelopePolyline(points: readonly EnvPoint[] | undefined, w: number, h: number): string {
  const pts = points && points.length ? points : voice.presetPoints('decay');
  return pts.map((p) => `${Math.round(p.t * w * 10) / 10},${Math.round((1 - p.v) * h * 10) / 10}`).join(' ');
}

