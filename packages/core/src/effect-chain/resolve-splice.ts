/**
 * Splice and Slice as Generators: a {@link GeneratorDevice} of kind `splice` / `slice` resolves
 * through the EXISTING splice machinery (`voice/splice.ts` `resolveSplices`, `voice/slice.ts`
 * `resolveSlice`), so every behaviour Tim built into the splice node — chases (MOVE
 * AROUND), hoop / drum / colour cascades and wait modes (MOVE THROUGH), orders and dragged
 * sequences, smudge, rotation, tint, motion modes, material regeneration — is the same code on
 * the Effect path. This module only translates device data into the node fields that machinery
 * already reads, and re-addresses the members for the Effect runtime.
 *
 * **Params.** The device's flat params are the node's `splice*` / `slice*` fields with the
 * prefix dropped and the first letter lowered (`spliceRateMs` → `rateMs`, `sliceRotX` → `rotX`).
 * The brightness envelope is NOT a device param: it is the Effect's own (its amp envelope —
 * attack, curve, sustain, decay), which `effectPlayAction` puts on the splice config, so a
 * pulsing part and the whole Effect run one envelope (Tim, 2026-10-01). Two node fields are not
 * scalars and are encoded:
 * - `drumSequence` / `hoopSequence` (arrays) → comma-separated strings (`"kick,snare"`, `"2,1"`).
 * - `sliceRegion` (a box) → `regionCx` … `regionSz`; the region applies only when all six are
 *   finite numbers.
 * Values of the wrong type or outside an enum are ignored, which leaves the machinery's own
 * default in force (never a throw).
 *
 * **Slots.** A slot is a colour, a nested non-splice Generator, or blank (`muted`, or neither).
 * A slot with both a colour and a Generator is the Generator tinted by the colour, exactly as a
 * splice slot with a colour and an effect always did. A nested Splice / Slice, or a nested Generator that
 * does not resolve, makes the slot blank. Fewer slots than `count` cycle, as today.
 *
 * **Members** name the Effect runtime's internal EffectDefs (`chainEffectDefId(generatorId)`,
 * see `runtime.ts`) — a colour fill hosts `solid-colour` — and carry their full params (spec
 * defaults under the resolved ones), the same layering the resolver gives a plain Generator.
 * The host effect is the first member's generator; its own params are empty because nothing
 * renders through the host of a composite voice.
 *
 * NOTE (import cycle): this module imports the registry (`./generators`) to resolve nested
 * slots, and `generators/splice.ts` / `slice.ts` import this module. That is safe because the
 * kind files only close over {@link resolveSpliceGenerator} (called at resolve time, never at
 * module init), and the kind files are only ever reached through `generators/index.ts`.
 */
import { canvasEffectId } from '../canvas/ids';
import { tryGetEffect } from '../effects/registry';
import type { ParamSpec } from '../effects/types';
import type { MixInputDraft } from '../voice/play-action';
import { SPLICE_FILL_GENERATOR_ID, resolveSplices, type ResolvedSplices } from '../voice/splice';
import { resolveSlice } from '../voice/slice';
import type {
  SpliceNode,
  SliceAxis,
  SpliceChaseMode,
  SpliceDef,
  SpliceMotionMode,
  SpliceOrder,
  SplicePartition,
  SpliceWaitMode,
} from '../voice/types';
import { DELAY_DIVISIONS } from '../voice/delay';
import { resolveGenerator } from './generators';
import type { ResolvedGenerator, StyleParams } from './generators/types';
import { chainEffectDefId } from './runtime';
import type { GeneratorDevice } from './types';

/** Fire-time context the splice machinery resolves bpm-synced timings against. */
export interface SpliceResolveOptions {
  /** Tempo for `beats` chase rates and cascade offsets. Absent / ≤ 0 → 120 (the machinery's fallback). */
  bpm?: number;
  beatsPerBar?: number;
  /**
   * Override for the per-unit envelope `pulse` / `fade` run. Absent → the splice defaults; on
   * the Effect path `effectPlayAction` replaces it with the Effect's own envelope anyway.
   */
  envelope?: { attackMs: number; sustainMs: number; releaseMs: number };
}

/** The splice-owned voice envelope, alongside the Generator resolution (for the resolver hook). */
export interface ResolvedSpliceGenerator extends ResolvedGenerator {
  envelope: { attackMs: number; sustainMs: number; releaseMs: number };
}

const PARTITIONS: readonly SplicePartition[] = ['hoop', 'drum', 'scope'];
const CHASES: readonly SpliceChaseMode[] = ['off', 'step', 'smooth', 'stagger'];
const ORDERS: readonly SpliceOrder[] = ['up', 'down', 'outside-in', 'random'];
const MOTION_MODES: readonly SpliceMotionMode[] = ['restart', 'continuous', 'latched'];
const WAIT_MODES: readonly SpliceWaitMode[] = ['lit', 'dark', 'fade', 'pulse'];
const RATE_MODES = ['beats', 'time'] as const;
const AXES: readonly SliceAxis[] = ['x', 'y', 'z'];
/** The "no division chosen" value of a cascade-offset division (→ no cascade in `beats` mode). */
export const SPLICE_NO_DIVISION = 'none';
const DIVISIONS: readonly string[] = DELAY_DIVISIONS;

type Params = GeneratorDevice['params'];

const num = (p: Params, key: string): number | undefined => {
  const v = p[key];
  return typeof v === 'number' && Number.isFinite(v) ? v : undefined;
};
const str = (p: Params, key: string): string | undefined => {
  const v = p[key];
  return typeof v === 'string' ? v : undefined;
};
function oneOf<T extends string>(p: Params, key: string, allowed: readonly T[]): T | undefined {
  const v = p[key];
  return typeof v === 'string' && (allowed as readonly string[]).includes(v) ? (v as T) : undefined;
}
const division = (p: Params, key: string): string | undefined => oneOf(p, key, DIVISIONS);

function csv(p: Params, key: string): string[] | undefined {
  const v = str(p, key);
  if (v === undefined) return undefined;
  return v.split(',').map((s) => s.trim()).filter((s) => s.length > 0);
}

function region(p: Params): SpliceNode['sliceRegion'] {
  const cx = num(p, 'regionCx');
  const cy = num(p, 'regionCy');
  const cz = num(p, 'regionCz');
  const sx = num(p, 'regionSx');
  const sy = num(p, 'regionSy');
  const sz = num(p, 'regionSz');
  if (cx === undefined || cy === undefined || cz === undefined || sx === undefined || sy === undefined || sz === undefined) {
    return undefined;
  }
  return { cx, cy, cz, sx, sy, sz };
}

/** Full params for `generatorId`: its spec defaults, then `params` (unknown keys kept). */
function withSpecDefaults(generatorId: string, params: StyleParams): StyleParams {
  const out: StyleParams = {};
  for (const spec of tryGetEffect(generatorId)?.paramSpec ?? []) out[spec.key] = spec.default;
  return Object.assign(out, params);
}

/** One slot → the SpliceDef the splice machinery reads (effect ids are chain def ids). */
function slotDef(slot: NonNullable<GeneratorDevice['slots']>[number]): SpliceDef {
  const color = typeof slot.color === 'string' && slot.color.length > 0 ? slot.color : null;
  const def: SpliceDef = { color };
  if (slot.muted) def.muted = true;
  const nested = slot.generator;
  if (!nested) return def;
  if (nested.kind === 'splice' || nested.kind === 'slice') return { ...def, muted: true };
  const gen = resolveGenerator(nested);
  const generatorId = gen ? (gen.canvasScene ? canvasEffectId(gen.canvasScene) : gen.effectId) : null;
  if (!gen || !generatorId || !tryGetEffect(generatorId)) return { ...def, muted: true };
  def.effectId = chainEffectDefId(generatorId);
  def.params = withSpecDefaults(generatorId, gen.params);
  return def;
}

/**
 * The {@link SpliceNode} view of a Splice / Slice device: exactly the fields `resolveSplices` /
 * `resolveSlice` read.
 */
export function spliceDeviceNode(device: GeneratorDevice): SpliceNode {
  const p = device.params;
  const direction = num(p, 'direction');
  const node: SpliceNode = {
    splices: (device.slots ?? []).map(slotDef),
    spliceCount: num(p, 'count'),
    // A slice has no partition: leaving it unset keeps the drum offset live (see `resolveSlice`).
    splicePartition: device.kind === 'slice' ? undefined : oneOf(p, 'partition', PARTITIONS),
    spliceJitter: num(p, 'jitter'),
    spliceSeed: num(p, 'seed'),
    spliceChase: oneOf(p, 'chase', CHASES),
    spliceRateMode: oneOf(p, 'rateMode', RATE_MODES),
    spliceRateMs: num(p, 'rateMs'),
    spliceDivision: division(p, 'division'),
    spliceDirection: direction === undefined ? undefined : direction < 0 ? -1 : 1,
    spliceIncrementPx: device.kind === 'slice' ? undefined : num(p, 'incrementPx'),
    spliceOffsetMode: oneOf(p, 'offsetMode', RATE_MODES),
    spliceOffsetMs: num(p, 'offsetMs'),
    spliceOffsetDivision: division(p, 'offsetDivision'),
    spliceOrder: oneOf(p, 'order', ORDERS),
    spliceDrumOffsetMode: oneOf(p, 'drumOffsetMode', RATE_MODES),
    spliceDrumOffsetMs: num(p, 'drumOffsetMs'),
    spliceDrumOffsetDivision: division(p, 'drumOffsetDivision'),
    spliceDrumOrder: oneOf(p, 'drumOrder', ORDERS),
    spliceSmudge: num(p, 'smudge'),
    spliceMotionMode: oneOf(p, 'motionMode', MOTION_MODES),
    spliceColorOffsetMode: oneOf(p, 'colorOffsetMode', RATE_MODES),
    spliceColorOffsetMs: num(p, 'colorOffsetMs'),
    spliceColorOffsetDivision: division(p, 'colorOffsetDivision'),
    spliceColorOrder: oneOf(p, 'colorOrder', ORDERS),
    spliceRotationDeg: num(p, 'rotationDeg'),
    spliceWaitMode: oneOf(p, 'waitMode', WAIT_MODES),
    spliceTint: num(p, 'tint'),
    spliceDrumSequence: csv(p, 'drumSequence'),
    spliceHoopSequence: csv(p, 'hoopSequence')?.map(Number),
  };
  if (device.kind === 'slice') {
    node.sliceAxis = oneOf(p, 'axis', AXES);
    node.sliceRotX = num(p, 'rotX');
    node.sliceRotY = num(p, 'rotY');
    node.sliceRotZ = num(p, 'rotZ');
    node.sliceRegion = region(p);
    // Velocity is the Velocity Control's job (the Generator standard): the Effect's Opacity, not
    // the Slice's own gain. The graph Slice node keeps its own.
    node.sliceVelocity = 0;
    node.sliceIncrementPct = num(p, 'incrementPct');
  }
  return node;
}

/**
 * Resolve a Splice / Slice device, or `null` when the kind is not splice / slice, the Style
 * is not the kind's own (`''` or the kind id), or every slot is blank (a splice with nothing
 * authored emits no voice, as today).
 */
export function resolveSpliceGenerator(device: GeneratorDevice, opts: SpliceResolveOptions = {}): ResolvedSpliceGenerator | null {
  if (device.kind !== 'splice' && device.kind !== 'slice') return null;
  if (device.style !== '' && device.style !== device.kind) return null;
  const node = spliceDeviceNode(device);
  const bpm = opts.bpm !== undefined && opts.bpm > 0 ? opts.bpm : 120;
  const beatsPerBar = opts.beatsPerBar ?? 4;
  const resolved: ResolvedSplices | null = device.kind === 'slice'
    ? resolveSlice(node, bpm, beatsPerBar)
    : resolveSplices(node, bpm, beatsPerBar);
  if (!resolved) return null;

  const envelope = opts.envelope ? { ...opts.envelope } : resolved.envelope;
  const members = resolved.members.map((member) => {
    // Colour fills come back as the reserved fill id; on the Effect path they host
    // `solid-colour` through its chain def, carrying the fill colour as their param.
    const isFill = !member.def.effectId;
    const effectId = isFill ? chainEffectDefId(SPLICE_FILL_GENERATOR_ID) : member.effectId;
    const params = isFill ? withSpecDefaults(SPLICE_FILL_GENERATOR_ID, member.params) : member.params;
    return { effectId, params, slot: member.slot };
  });
  const spliceInputs: MixInputDraft[] = members.map((m) => ({
    effectId: m.effectId,
    mode: 'oneshot',
    scope: 'kit',
    busId: '',
    params: m.params,
    opacity: 1,
    // Members carry this for provenance only; a slot index is what identifies one here.
    originNodeId: `splice-slot:${m.slot}`,
  }));
  const hostDefId = members[0]!.effectId;
  return {
    effectId: hostDefId.slice(hostDefId.indexOf(':') + 1),
    params: {},
    splice: { ...resolved.config, envelope },
    spliceInputs,
    envelope,
  };
}

const n = (key: string, label: string, def: number, min: number, max: number, step: number, unit?: string): ParamSpec => ({
  key, label, type: 'number', default: def, min, max, step, ...(unit ? { unit } : {}),
});
const e = (key: string, label: string, def: string, options: readonly string[]): ParamSpec => ({
  key, label, type: 'enum', default: def, options: [...options],
});

const DIVISION_OPTIONS = [SPLICE_NO_DIVISION, ...DELAY_DIVISIONS];

/** The scalar params a Splice card shows. Sequences (drag orders) have their own UI. */
const SPLICE_PARAM_SPEC: readonly ParamSpec[] = [
  n('count', 'Count', 4, 1, 64, 1),
  e('partition', 'Partition', 'hoop', PARTITIONS),
  n('jitter', 'Jitter', 0, 0, 1, 0.01),
  n('seed', 'Seed', 1, 0, 9999, 1),
  e('chase', 'Motion', 'off', CHASES),
  e('motionMode', 'On hit', 'restart', MOTION_MODES),
  e('rateMode', 'Rate mode', 'beats', RATE_MODES),
  e('division', 'Rate', '1/8', DELAY_DIVISIONS),
  n('rateMs', 'Rate', 250, 0, 10000, 1, 'ms'),
  n('direction', 'Direction', 1, -1, 1, 2),
  n('incrementPx', 'Stagger', 4, 0, 512, 1, 'px'),
  n('rotationDeg', 'Rotation', 0, 0, 360, 1, '°'),
  n('smudge', 'Smudge', 0, 0, 1, 0.01),
  n('tint', 'Tint', 1, 0, 1, 0.01),
  e('waitMode', 'While waiting', 'lit', WAIT_MODES),
  e('offsetMode', 'Hoop offset mode', 'beats', RATE_MODES),
  e('offsetDivision', 'Hoop offset', SPLICE_NO_DIVISION, DIVISION_OPTIONS),
  n('offsetMs', 'Hoop offset', 0, 0, 10000, 1, 'ms'),
  e('order', 'Hoop order', 'up', ORDERS),
  e('drumOffsetMode', 'Drum offset mode', 'beats', RATE_MODES),
  e('drumOffsetDivision', 'Drum offset', SPLICE_NO_DIVISION, DIVISION_OPTIONS),
  n('drumOffsetMs', 'Drum offset', 0, 0, 10000, 1, 'ms'),
  e('drumOrder', 'Drum order', 'up', ORDERS),
  e('colorOffsetMode', 'Colour offset mode', 'beats', RATE_MODES),
  e('colorOffsetDivision', 'Colour offset', SPLICE_NO_DIVISION, DIVISION_OPTIONS),
  n('colorOffsetMs', 'Colour offset', 0, 0, 10000, 1, 'ms'),
  e('colorOrder', 'Colour order', 'up', ORDERS),
];

/** Slice drops the partition (it cuts through space) and adds its geometry. */
const SLICE_PARAM_SPEC: readonly ParamSpec[] = [
  ...SPLICE_PARAM_SPEC.filter((p) => p.key !== 'partition' && p.key !== 'incrementPx'),
  e('axis', 'Axis', 'x', AXES),
  n('rotX', 'Tilt X', 0, 0, 360, 1, '°'),
  n('rotY', 'Tilt Y', 0, 0, 360, 1, '°'),
  n('rotZ', 'Tilt Z', 0, 0, 360, 1, '°'),
  n('incrementPct', 'Stagger', 10, 0, 100, 1, '%'),
];

/** The params a Splice / Slice card shows; empty for any other kind. */
export function spliceGeneratorParamSpec(kind: string): ParamSpec[] {
  if (kind === 'splice') return SPLICE_PARAM_SPEC.map((p) => ({ ...p }));
  if (kind === 'slice') return SLICE_PARAM_SPEC.map((p) => ({ ...p }));
  return [];
}
