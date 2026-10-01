/**
 * The authored **Effect chain** model (spec `docs/plans/2026-09-30-effect-chains/spec.md`,
 * "Domain model"). An Effect is a linear chain — Trigger → Generator → Modifiers → Target —
 * with optional Control devices mapped onto any device param, a built-in amplitude envelope,
 * and a per-Effect blend mode + opacity. A section carries an ordered `effects` stack (the
 * composition order) and a `master` modifier chain.
 *
 * Pure (no Node/DOM/IO). The zod schema is the single source of the shape AND its defaults,
 * so a minimal Effect (`id`, `cell`, `generator.kind`) parses into a fully-populated one. The
 * TypeScript types are inferred from the schema's OUTPUT, i.e. every defaulted field is
 * present on a parsed Effect.
 */
import { z } from 'zod';
import { BLEND_MODES } from '../color/blend';
import { AUDIO_BANDS } from '../voice/audio-features';
import { LFO_WAVEFORMS } from '../voice/lfo';

// ---- Primitives --------------------------------------------------------------

export const paramValueSchema = z.union([z.number(), z.boolean(), z.string()]);
const paramsSchema = z.record(paramValueSchema).default({});

const unit = z.number().min(0).max(1);
const nonNegMs = z.number().min(0);

/** Reuses the existing blend-mode library union (`color/blend.ts`). */
export const blendModeSchema = z.enum(BLEND_MODES);

// ---- Cell (grid identity) ------------------------------------------------------

/** A grid column: one of the row drum's zone slots (numeric slot identity, never the name),
    or one of the three trigger columns. */
export const effectColumnSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('zone'), slot: z.number().int().min(0) }),
  z.object({ kind: z.literal('always') }),
  z.object({ kind: z.literal('clock') }),
  z.object({ kind: z.literal('cue') }),
]);

/** A cell is identified by (row, column). `row` is `'kit'` or a drum id. */
export const effectCellSchema = z.object({
  row: z.string().min(1),
  column: effectColumnSchema,
});

// ---- Trigger -------------------------------------------------------------------

/** A clock grid period: every N beats, or every N bars (bars resolve against the transport's
    beats-per-bar at fire time). */
export const clockEverySchema = z.union([
  z.object({ beats: z.number().positive() }),
  z.object({ bars: z.number().positive() }),
]);

export const cueSourceSchema = z.object({
  midiNote: z.number().int().min(0).max(127).optional(),
  midiCc: z.number().int().min(0).max(127).optional(),
  oscAddress: z.string().min(1).optional(),
});

/** When an Effect fires. A zone trigger's drum and slot come from the cell. */
export const effectTriggerSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('zone') }),
  z.object({ kind: z.literal('always') }),
  z.object({
    kind: z.literal('clock'),
    every: clockEverySchema.default({ beats: 1 }),
    offsetBeats: z.number().default(0),
  }),
  z.object({ kind: z.literal('cue'), source: cueSourceSchema.default({}) }),
]);

/** What a repeated fire does while this Effect is already playing. */
export const retriggerSchema = z.enum(['overlap', 'restart', 'ignore']);

// ---- Amplitude envelope --------------------------------------------------------

/**
 * How long the Effect's gate stays open. `{ ms }` / `{ beats }` is the gate length measured
 * from the fire (the attack is inside it; beats resolve at the fire's bpm). `'hold'` stays up
 * until released (note-off of the firing note/zone, section change or panic). `'loop'` runs
 * until released and is what Always Effects always use.
 */
export const ampLengthSchema = z.union([
  z.object({ ms: nonNegMs }),
  z.object({ beats: z.number().min(0) }),
  z.literal('hold'),
  z.literal('loop'),
]);

/** The curve an attack rises on (an `ease()` family + direction). Absent / linear = a straight ramp. */
export const attackEaseSchema = z.object({
  fn: z.enum(['linear', 'quad', 'cubic', 'quart', 'expo', 'sine', 'circ', 'back', 'bounce', 'elastic']),
  dir: z.enum(['in', 'out', 'inOut']),
});

/**
 * An Effect's brightness envelope (Tim, 2026-10-01: the Splice / Slice "brightness envelope"
 * as THE way a hit lights — Attack · Curve · Sustain · Decay): `attackMs` up on `attackEase`,
 * full brightness until `length` ends, then `releaseMs` down. It also drives each part of a
 * Splice / Slice that pulses or fades in turn, so there is one envelope per Effect.
 * `decayMs` / `sustainLevel` are the old ADSR's drop to a lower level: kept, and honoured, so a
 * show that used them plays as before, but at their defaults (0 / 1) they do nothing and a new
 * Effect never sets them.
 */
export const ampEnvelopeSchema = z.object({
  attackMs: nonNegMs.default(10),
  /** The attack in beats instead (Tim, 2026-10-02: attack and decay "in beats as well as ms");
      when set it wins, resolved at the fire's tempo like a `{ beats }` length. */
  attackBeats: z.number().min(0).optional(),
  attackEase: attackEaseSchema.optional(),
  decayMs: nonNegMs.default(0),
  sustainLevel: unit.default(1),
  length: ampLengthSchema.default({ ms: 500 }),
  releaseMs: nonNegMs.default(300),
  /** The decay in beats instead; when set it wins, resolved at the fire's tempo. */
  releaseBeats: z.number().min(0).optional(),
});

// ---- Devices -------------------------------------------------------------------

/** The Generator ids (S03 completes their Style tables). */
export const GENERATOR_KINDS = [
  'solid', 'gradient', 'wave', 'noise', 'particles', 'pattern', 'meter', 'lightning', 'scene',
  'splice', 'slice',
] as const;
export const generatorKindSchema = z.enum(GENERATOR_KINDS);

export interface SpliceSlotInput {
  color?: string | null;
  generator?: GeneratorDeviceInput;
  muted?: boolean;
}
export interface GeneratorDeviceInput {
  kind: (typeof GENERATOR_KINDS)[number];
  style?: string;
  params?: Record<string, number | boolean | string>;
  slots?: SpliceSlotInput[];
}

/** A Splice / Slice slot: a colour, a nested Generator, or blank. S03 owns its semantics. */
export const spliceSlotSchema: z.ZodType<SpliceSlot, z.ZodTypeDef, SpliceSlotInput> = z.lazy(() =>
  z.object({
    color: z.string().nullable().optional(),
    generator: generatorDeviceSchema.optional(),
    muted: z.boolean().optional(),
  }),
);

export const generatorDeviceSchema: z.ZodType<GeneratorDevice, z.ZodTypeDef, GeneratorDeviceInput> = z.lazy(() =>
  z.object({
    kind: generatorKindSchema,
    style: z.string().default(''),
    params: paramsSchema,
    slots: z.array(spliceSlotSchema).optional(),
  }),
);

/** A per-modifier envelope over the voice's life (S02 implements its render semantics). */
export const modifierEnvelopeSchema = z.object({
  attackMs: nonNegMs.default(0),
  decayMs: nonNegMs.default(0),
  sustainLevel: unit.default(1),
  releaseMs: nonNegMs.default(0),
});

export const modifierDeviceSchema = z.object({
  uid: z.string().min(1),
  modifierId: z.string().min(1),
  params: paramsSchema,
  /** Dry/wet 0..1 (1 = fully wet, today's behaviour). */
  mix: unit.default(1),
  envelope: modifierEnvelopeSchema.optional(),
  bypass: z.boolean().default(false),
});

/** Which device (in the same Effect) a control mapping drives: the Generator, a Modifier by
    its `uid`, or the Effect itself (opacity — resolved by a later slice). */
export const controlMappingSchema = z.object({
  device: z.string().min(1),
  param: z.string().min(1),
  amount: unit.default(1),
  invert: z.boolean().default(false),
  rangeMin: z.number().optional(),
  rangeMax: z.number().optional(),
});

const channelSchema = z.number().int().min(1).max(16).nullable().default(null);
const envPointSchema = z.object({ t: z.number(), v: z.number() });

const controlBase = {
  uid: z.string().min(1),
  mappings: z.array(controlMappingSchema).default([]),
};

export const controlDeviceSchema = z.discriminatedUnion('kind', [
  z.object({
    ...controlBase,
    kind: z.literal('envelope'),
    settings: z.object({
      /** Envelope curve over the voice life (0..1 phase). Absent → a decay. */
      points: z.array(envPointSchema).optional(),
    }).default({}),
  }),
  z.object({
    ...controlBase,
    kind: z.literal('lfo'),
    settings: z.object({
      waveform: z.enum(LFO_WAVEFORMS).default('sine'),
      rateMode: z.enum(['hz', 'beats']).default('hz'),
      rateHz: z.number().min(0).default(1),
      division: z.string().default('1/4'),
      phase: z.number().default(0),
    }).default({}),
  }),
  z.object({ ...controlBase, kind: z.literal('velocity'), settings: z.object({}).default({}) }),
  z.object({
    ...controlBase,
    kind: z.literal('random'),
    settings: z.object({
      distribution: z.enum(['linear', 'gaussian', 'exponential', 'logarithmic', 'triangular', 'beta', 'stepped']).default('linear'),
      steps: z.number().int().min(2).max(64).default(4),
    }).default({}),
  }),
  z.object({
    ...controlBase,
    kind: z.literal('cc'),
    settings: z.object({ controller: z.number().int().min(0).max(127).default(1), channel: channelSchema }).default({}),
  }),
  z.object({
    ...controlBase,
    kind: z.literal('osc'),
    settings: z.object({ address: z.string().default('') }).default({}),
  }),
  z.object({
    ...controlBase,
    kind: z.literal('note'),
    settings: z.object({
      note: z.number().int().min(0).max(127).default(60),
      channel: channelSchema,
      mode: z.enum(['gate', 'velocity']).default('gate'),
      releaseMs: nonNegMs.default(0),
    }).default({}),
  }),
  z.object({
    ...controlBase,
    kind: z.literal('audio'),
    settings: z.object({ band: z.enum(AUDIO_BANDS).default('level') }).default({}),
  }),
]);

// ---- Target --------------------------------------------------------------------

/** Where an Effect's light shows. Hoop numbers are 1-based, as everywhere in the kit. */
export const effectTargetSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('kit') }),
  z.object({ kind: z.literal('hitDrum') }),
  z.object({
    kind: z.literal('select'),
    drums: z.array(z.object({ drumId: z.string().min(1), hoops: z.array(z.number().int().min(1)).optional() })).default([]),
  }),
]);

// ---- Effect --------------------------------------------------------------------

const effectObjectSchema = z.object({
  id: z.string().min(1),
  name: z.string().default(''),
  bypass: z.boolean().default(false),
  cell: effectCellSchema,
  /** Absent → derived from `cell.column` (a clock/cue trigger then takes its defaults). */
  trigger: effectTriggerSchema.optional(),
  retrigger: retriggerSchema.default('overlap'),
  amp: ampEnvelopeSchema.default({}),
  generator: generatorDeviceSchema,
  modifiers: z.array(modifierDeviceSchema).default([]),
  controls: z.array(controlDeviceSchema).default([]),
  /** Absent → from the row: the Kit row targets the whole kit, a drum row its own drum. */
  target: effectTargetSchema.optional(),
  blend: blendModeSchema.default('add'),
  opacity: unit.default(1),
});

/**
 * The Effect schema. Fills a trigger from the cell column and a target from the row when they
 * are absent, then refines the two invariants the grid depends on: the trigger kind always
 * matches `cell.column.kind`, and a zone column only exists on a drum row.
 */
export const effectSchema = effectObjectSchema
  .transform((e) => ({
    ...e,
    trigger: e.trigger ?? effectTriggerSchema.parse({ kind: e.cell.column.kind }),
    target: e.target ?? defaultTargetForRow(e.cell.row),
  }))
  .superRefine((e, ctx) => {
    if (e.trigger.kind !== e.cell.column.kind) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['trigger', 'kind'],
        message: `trigger kind '${e.trigger.kind}' does not match cell column '${e.cell.column.kind}'`,
      });
    }
    if (e.cell.column.kind === 'zone' && e.cell.row === KIT_ROW) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['cell'], message: 'the Kit row has no zone columns' });
    }
  });

/** The Kit row id in a cell. */
export const KIT_ROW = 'kit';

/** The default Target for a new Effect in `row` (spec story 54). */
export function defaultTargetForRow(row: string): EffectTarget {
  return row === KIT_ROW ? { kind: 'kit' } : { kind: 'select', drums: [{ drumId: row }] };
}

/** A section's master modifier chain. */
export const masterChainSchema = z.array(modifierDeviceSchema).default([]);

// ---- Inferred types ------------------------------------------------------------

export type EffectCell = z.output<typeof effectCellSchema>;
export type EffectColumn = z.output<typeof effectColumnSchema>;
export type EffectTrigger = z.output<typeof effectTriggerSchema>;
export type ClockEvery = z.output<typeof clockEverySchema>;
export type CueSource = z.output<typeof cueSourceSchema>;
export type Retrigger = z.output<typeof retriggerSchema>;
export type AmpLength = z.output<typeof ampLengthSchema>;
export type AmpEnvelope = z.output<typeof ampEnvelopeSchema>;
export type GeneratorKind = (typeof GENERATOR_KINDS)[number];
export interface GeneratorDevice {
  kind: GeneratorKind;
  style: string;
  params: Record<string, number | boolean | string>;
  slots?: SpliceSlot[];
}
export interface SpliceSlot {
  color?: string | null;
  generator?: GeneratorDevice;
  muted?: boolean;
}
export type ModifierEnvelopeSpec = z.output<typeof modifierEnvelopeSchema>;
export type ModifierDevice = z.output<typeof modifierDeviceSchema>;
export type ControlMapping = z.output<typeof controlMappingSchema>;
export type ControlDevice = z.output<typeof controlDeviceSchema>;
export type ControlKind = ControlDevice['kind'];
export type EffectTarget = z.output<typeof effectTargetSchema>;
export type Effect = z.output<typeof effectSchema>;
/** What a caller may hand the schema: every defaulted field optional. */
export type EffectInput = z.input<typeof effectSchema>;

/** Parse (and default) one authored Effect. Throws a ZodError on invalid input. */
export function parseEffect(input: unknown): Effect {
  return effectSchema.parse(input);
}
