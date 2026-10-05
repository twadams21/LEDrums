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
  /** `false`: this ms / Hz param has its own tempo control, so no ms ⇄ beats switch. */
  tempo?: false;
  /** The section it sits under, shown as a capitalised header (core `ParamSpec.section`). */
  section?: string;
  /** An enum whose choices are the kit's drums, filled in by the card (core `optionsFrom`). */
  optionsFrom?: 'drums';
  /** A richer control the card draws (core `widget`): a hoop's pixel ring, drum-order chips, a
      point in the kit's space. */
  widget?: ParamSpec['widget'];
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
    // A 0..1 amount whose core unit is `%` reads as a whole percent (0.15 → 15).
    ...(spec.unit === '%' && spec.max !== undefined && spec.max <= 1 ? { percent: true } : {}),
    ...(spec.info ? { info: spec.info } : {}),
    ...(spec.section ? { section: spec.section } : {}),
    ...(spec.optionsFrom ? { optionsFrom: spec.optionsFrom } : {}),
    ...(spec.widget ? { widget: spec.widget } : {}),
  };
}

/** The kit, as the card reads it to size a param's range (core `rangeFrom`). */
export interface KitRanges {
  drumIds: readonly string[];
  hoops(drumId: string): number;
  pixels(drumId: string, hoop: number): number;
}

/**
 * Params sized to the kit (Tim, 2026-10-05: "the start hoop param should only have 4 options, as
 * there are only 4 hoops"): `start-hoops` tops out at the start drum's hoop count, `start-pixels`
 * at its start hoop's pixel count. With the drum you hit (no drum chosen) — the most any drum has.
 * A host that can't say leaves the spec's range.
 */
export function withKitRanges(
  device: GeneratorDevice,
  params: readonly CardParam[],
  kit: KitRanges,
): CardParam[] {
  const specs = effectChain.generatorParamSpec(device.kind, device.style);
  const val = (key: string) => device.params[key] ?? specs.find((s) => s.key === key)?.default;
  const chosen = String(val('startDrum') ?? '');
  const drums = kit.drumIds.includes(chosen) ? [chosen] : [...kit.drumIds];
  const hoop = Math.max(1, Math.round(Number(val('startHoop') ?? 1)));
  return params.map((p) => {
    const rangeFrom = specs.find((s) => s.key === p.key)?.rangeFrom;
    if (!rangeFrom) return p;
    const max = Math.max(0, ...drums.map((d) => (rangeFrom === 'start-hoops' ? kit.hoops(d) : kit.pixels(d, Math.min(hoop, Math.max(1, kit.hoops(d)))))));
    return max > 0 ? { ...p, max: Math.max(p.min ?? 1, max) } : p;
  });
}

/** Is this param shown for these values — every `showIf` condition met (its param holding one of
    `is`, none of `not`)? (Tim, 2026-10-05: a setting that does nothing in the current mode reads
    as broken.) */
function shown(spec: ParamSpec, specs: readonly ParamSpec[], values: Readonly<Record<string, ParamValue>>): boolean {
  if (!spec.showIf) return true;
  const conditions = Array.isArray(spec.showIf) ? spec.showIf : [spec.showIf];
  return conditions.every(({ key, is, not }) => {
    const v = values[key] ?? specs.find((s) => s.key === key)?.default;
    if (v === undefined) return false;
    if (is && !is.includes(v)) return false;
    return !(not && not.includes(v));
  });
}

/** The "Drum" choices for an `optionsFrom: 'drums'` param: the drum you hit, then the kit's drums. */
export const HIT_DRUM = '@hit';
export function drumParamOptions(drums: readonly { id: string; label: string }[]): { value: string; label: string }[] {
  return [{ value: HIT_DRUM, label: 'Drum you hit' }, ...drums.map((d) => ({ value: d.id, label: d.label }))];
}

/** The device's own value for `p`, else the spec default (an unwritten param has no entry). */
export function paramValue(p: CardParam, params: Readonly<Record<string, ParamValue>> | undefined): ParamValue {
  const v = params?.[p.key];
  if (v === undefined) return p.default;
  // An enum outside its options reads as its default — except one whose choices come from the kit
  // (a drum id) or a widget (a drum order), which its fixed options can't list.
  const open = !!p.optionsFrom || p.widget?.kind === 'drum-order';
  if (p.kind === 'enum' && (typeof v !== 'string' || (!open && !(p.options ?? []).includes(v)))) return p.default;
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

/** A run of params under one capitalised header (Tim, 2026-10-04: "the sections are not very
    clearly visible. Can you make some headers in capitals?"). */
export interface ParamSection {
  label: string;
  params: CardParam[];
}

/** The params in their sections, in order — or null when none of them names a section. A param
    without one joins the section before it (or an unnamed first one). */
export function paramSections(params: readonly CardParam[]): ParamSection[] | null {
  if (!params.some((p) => p.section)) return null;
  const out: ParamSection[] = [];
  for (const p of params) {
    const last = out[out.length - 1];
    if (last && (!p.section || p.section === last.label)) last.params.push(p);
    else out.push({ label: p.section ?? '', params: [p] });
  }
  return out;
}

/** How many row-heights a param takes: a widget is taller than a row (a hoop's ring ~3 more, a
    point picker's two views ~4, drum chips ~1). */
function rowLines(p: CardParam): number {
  switch (p.widget?.kind) {
    case 'hoop-pixel': return 4;
    case 'space-point': return 5;
    case 'drum-order': return 2;
    default: return 1;
  }
}

/**
 * Sections packed into columns, left to right: a section joins the column above it while the
 * column stays within {@link PARAM_ROWS_MAX} + 2 lines (a header counts as one — it is shorter
 * than a row), else starts the next. Short sections share a column, so the card stays compact; a
 * section longer than that has a column to itself.
 */
export function sectionColumns(sections: readonly ParamSection[]): ParamSection[][] {
  const max = PARAM_ROWS_MAX + 2;
  const columns: ParamSection[][] = [];
  let lines = Infinity;
  for (const s of sections) {
    const size = s.params.reduce((n, p) => n + rowLines(p), 0) + 1;
    if (lines + size > max) {
      columns.push([s]);
      lines = size;
    } else {
      columns[columns.length - 1]!.push(s);
      lines += size;
    }
  }
  return columns;
}

/** Does this param list go landscape — by its sections' columns when it has sections? */
export function paramsLandscape(params: readonly CardParam[]): boolean {
  const sections = paramSections(params);
  return sections ? sectionColumns(sections).length > 1 : isLandscape(params.length);
}

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
 * shows a scene Select for it); everything else is the chosen Style's params, less any whose
 * `showIf` the current values don't meet.
 */
export function generatorParams(device: GeneratorDevice): CardParam[] {
  if (isSlotted(device.kind)) {
    const all = effectChain.spliceGeneratorParamSpec(device.kind).map(toCardParam);
    return all.filter((p) => !spliceParamHidden(p.key, device.params, all));
  }
  const specs = effectChain.generatorParamSpec(device.kind, device.style);
  return specs
    .filter((s) => s.key !== SCENE_PARAM || device.kind !== 'scene')
    .filter((s) => shown(s, specs, device.params))
    // A param another param's widget edits has no row of its own (Dot's Start depth / height).
    .filter((s) => !s.partOf)
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
    // The dropdown is "Rate"; the Hz value under Free is its frequency — already tempo-able
    // through that dropdown, so it gets no ms / Hz ⇄ beats switch of its own.
    .map((p) => (p.key === 'rate' ? { ...p, label: 'Frequency', tempo: false as const } : p));
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

/** The LFO's Rate dropdown value standing for free Hz (its Frequency row). */
export const LFO_FREE_HZ = '@hz';

export const DIVISION_OPTIONS = voice.DELAY_DIVISIONS.map((d) => ({ value: d, label: divisionLabel(d) }));
/** The LFO's one Rate dropdown: the divisions, then Free (Hz). */
export const LFO_RATE_OPTIONS = [...DIVISION_OPTIONS, { value: LFO_FREE_HZ, label: 'Free (Hz)' }];

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

// ---- ms / Hz ⇄ beats (Tim, 2026-10-02: beats "everywhere there is a measurement of time") ------

/** A ms / Hz number that can be switched to beats (a `<key>:beats` companion — core `tempo.ts`). */
export function isTempoParam(p: CardParam): boolean {
  return p.kind === 'number' && p.tempo !== false && effectChain.isTempoUnit(p.unit);
}

/** The param's beats companion value, or undefined while it is in ms / Hz. */
export function tempoBeats(p: CardParam, values: Readonly<Record<string, ParamValue>> | undefined): number | undefined {
  const v = values?.[effectChain.tempoKey(p.key)];
  return typeof v === 'number' ? v : undefined;
}

const sixteenth = (beats: number): number => Math.max(1 / 16, Math.round(beats * 16) / 16);

/**
 * The patch that switches a param between its unit and beats, keeping what it does at 120 bpm:
 * a duration keeps its length (500 ms = 1 beat), a rate keeps its speed (2 Hz = one cycle a
 * beat), rounded to the nearest sixteenth of a beat. Back to the unit, the companion is removed.
 */
export function tempoTogglePatch(p: CardParam, values: Readonly<Record<string, ParamValue>> | undefined): Record<string, ParamValue | undefined> {
  const key = effectChain.tempoKey(p.key);
  const beats = tempoBeats(p, values);
  if (beats === undefined) {
    const v = Number(paramValue(p, values));
    return { [key]: sixteenth(p.unit === 'Hz' ? (v > 0 ? 2 / v : 1) : v / 500) };
  }
  const at120 = effectChain.tempoValue(p.unit, beats, 120) ?? Number(p.default);
  const clamped = Math.min(p.max ?? Infinity, Math.max(p.min ?? -Infinity, at120));
  return { [key]: undefined, [p.key]: Number(clamped.toFixed(p.step !== undefined && p.step < 1 ? 2 : 0)) };
}
