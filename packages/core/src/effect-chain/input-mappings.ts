import { z } from 'zod';
import { effectCellSchema } from './types';

/**
 * MIDI-map mode: an InputMapping binds one input source (a MIDI note / CC, an OSC address or a
 * computer key) to an authoring target. Mappings live on the show (`AuthoredV3.mappings`) and
 * in the runtime Show; a matched input is CONSUMED at global-control precedence (after global
 * controls, before zones and cues).
 *
 * Not to be confused with `ControlMapping` (types.ts): that is a Control device's modulation of
 * a param inside one Effect. This is the performer's controller surface.
 *
 * Contract file (effect-chains wave 5): the schemas and types here are fixed; matching and the
 * engine behaviour are implemented beside them by the `core-mappings` piece.
 */

/** Exactly one of the four source kinds. `key` is a `KeyboardEvent.code` ("KeyQ", "Digit1"). */
export const inputMappingSourceSchema = z.union([
  z.object({ midiNote: z.number().int().min(0).max(127) }).strict(),
  z.object({ midiCc: z.number().int().min(0).max(127) }).strict(),
  z.object({ oscAddress: z.string().trim().min(1) }).strict(),
  z.object({ key: z.string().min(1) }).strict(),
]);

/** Which device inside an Effect a `param` target drives: the Generator or a Modifier by uid. */
const deviceRefSchema = z.union([z.literal('generator'), z.string().min(1)]);

export const inputMappingTargetSchema = z.discriminatedUnion('kind', [
  /** Discrete: fire every Effect in a cell (the cell's stack). */
  z.object({ kind: z.literal('fireCell'), cell: effectCellSchema }),
  /** Discrete: fire one Effect. */
  z.object({ kind: z.literal('fireEffect'), effectId: z.string().min(1) }),
  /** Discrete: recall a section (songId absent = the section's own song). */
  z.object({ kind: z.literal('recallSection'), sectionId: z.string().min(1), songId: z.string().min(1).optional() }),
  /** Continuous: a generator / modifier param, scaled into [rangeMin, rangeMax]. */
  z.object({ kind: z.literal('param'), effectId: z.string().min(1), device: deviceRefSchema, param: z.string().min(1) }),
  /** Continuous: an Effect's opacity. */
  z.object({ kind: z.literal('opacity'), effectId: z.string().min(1) }),
  /** Continuous: a Modifier's mix. */
  z.object({ kind: z.literal('modifierMix'), effectId: z.string().min(1), modifierUid: z.string().min(1) }),
  /** Toggle (resolved in the web store): an Effect's bypass, or a Modifier's when a uid is given. */
  z.object({ kind: z.literal('bypass'), effectId: z.string().min(1), modifierUid: z.string().min(1).optional() }),
]);

export const inputMappingSchema = z.object({
  id: z.string().min(1),
  source: inputMappingSourceSchema,
  target: inputMappingTargetSchema,
  /** Continuous targets only: the value range a 0..1 input maps onto (defaults: the param's). */
  rangeMin: z.number().optional(),
  rangeMax: z.number().optional(),
});

export const inputMappingsSchema = z.array(inputMappingSchema).default([]);

export type InputMappingSource = z.output<typeof inputMappingSourceSchema>;
export type InputMappingTarget = z.output<typeof inputMappingTargetSchema>;
export type InputMappingTargetKind = InputMappingTarget['kind'];
export type InputMapping = z.output<typeof inputMappingSchema>;

/** Continuous targets take a 0..1 value every frame; the rest are discrete or toggles. */
export const CONTINUOUS_TARGET_KINDS: readonly InputMappingTargetKind[] = ['param', 'opacity', 'modifierMix'];

export function isContinuousTarget(target: InputMappingTarget): boolean {
  return CONTINUOUS_TARGET_KINDS.includes(target.kind);
}

/**
 * A stable identity for a target — one mapping per target. Two targets with the same id are the
 * same control (re-binding replaces the source).
 */
export function inputMappingTargetId(target: InputMappingTarget): string {
  switch (target.kind) {
    case 'fireCell': {
      const col = target.cell.column;
      return `fireCell:${target.cell.row}:${col.kind === 'zone' ? `zone${col.slot}` : col.kind}`;
    }
    case 'fireEffect':
      return `fireEffect:${target.effectId}`;
    case 'recallSection':
      return `recallSection:${target.songId ?? ''}:${target.sectionId}`;
    case 'param':
      return `param:${target.effectId}:${target.device}:${target.param}`;
    case 'opacity':
      return `opacity:${target.effectId}`;
    case 'modifierMix':
      return `modifierMix:${target.effectId}:${target.modifierUid}`;
    case 'bypass':
      return `bypass:${target.effectId}:${target.modifierUid ?? ''}`;
  }
}

/** A short human label for a source: "Note 60", "CC 21", "/osc/x", "Key Q". */
export function inputMappingSourceLabel(source: InputMappingSource): string {
  if ('midiNote' in source) return `Note ${source.midiNote}`;
  if ('midiCc' in source) return `CC ${source.midiCc}`;
  if ('oscAddress' in source) return source.oscAddress;
  return `Key ${source.key.replace(/^Key|^Digit/, '')}`;
}
