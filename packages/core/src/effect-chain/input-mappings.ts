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

// ---- Matching (core-mappings, effect chains wave 5) -------------------------------------------

/**
 * One input, in the terms a mapping source matches on. The engine builds it from a note / CC /
 * OSC event; the web builds `key` from a key press (key mappings resolve in the web).
 */
export interface InputMappingEvent {
  midiNote?: number;
  midiCc?: number;
  oscAddress?: string;
  key?: string;
}

/** Does `source` match `event`? Only the source's own kind is compared. */
export function inputMappingSourceMatches(source: InputMappingSource, event: InputMappingEvent): boolean {
  if ('midiNote' in source) return event.midiNote !== undefined && source.midiNote === event.midiNote;
  if ('midiCc' in source) return event.midiCc !== undefined && source.midiCc === event.midiCc;
  if ('oscAddress' in source) return event.oscAddress !== undefined && source.oscAddress === event.oscAddress;
  return event.key !== undefined && source.key === event.key;
}

/**
 * The mapping `event` performs, or `null`. The first match in authored order wins; the
 * binding-claims guard refuses a second mapping on one source, so a tie only exists in
 * hand-edited data. Pure and allocation-free (the engine calls it per input).
 */
export function matchInputMapping(mappings: readonly InputMapping[], event: InputMappingEvent): InputMapping | null {
  for (const mapping of mappings) {
    if (inputMappingSourceMatches(mapping.source, event)) return mapping;
  }
  return null;
}

/**
 * Scale a 0..1 input into `[rangeMin, rangeMax]` (a reversed range runs the control
 * backwards), then clamp to the target's own `[lo, hi]`. A non-finite input reads as 0, so a
 * malformed value can never poison a param.
 */
export function scaleInputMappingValue(value01: number, rangeMin: number, rangeMax: number, lo: number, hi: number): number {
  const v = Number.isFinite(value01) ? (value01 < 0 ? 0 : value01 > 1 ? 1 : value01) : 0;
  const out = rangeMin + v * (rangeMax - rangeMin);
  return out < lo ? lo : out > hi ? hi : out;
}

/** A stored mapping {@link parseInputMappings} left out, and why. */
export interface DroppedInputMapping {
  /** Index in the stored array (-1 when the field itself is not an array). */
  index: number;
  id?: string;
  message: string;
}

/**
 * Validate stored mappings one by one (the library keeps the field lenient, like Effects): an
 * invalid entry is dropped and reported, never fatal. Ids are unique (first wins). Absent
 * (`undefined` / `null`) reads as no mappings.
 */
export function parseInputMappings(raw: unknown): { mappings: InputMapping[]; dropped: DroppedInputMapping[] } {
  const mappings: InputMapping[] = [];
  const dropped: DroppedInputMapping[] = [];
  if (raw === undefined || raw === null) return { mappings, dropped };
  if (!Array.isArray(raw)) {
    dropped.push({ index: -1, message: 'mappings is not an array' });
    return { mappings, dropped };
  }
  const ids = new Set<string>();
  raw.forEach((entry: unknown, index) => {
    const rawId = entry && typeof entry === 'object' ? (entry as { id?: unknown }).id : undefined;
    const id = typeof rawId === 'string' ? rawId : undefined;
    const parsed = inputMappingSchema.safeParse(entry);
    if (!parsed.success) {
      const issue = parsed.error.issues[0]!;
      dropped.push({ index, id, message: `${issue.path.join('.') || '(root)'}: ${issue.message}` });
      return;
    }
    if (ids.has(parsed.data.id)) {
      dropped.push({ index, id, message: `duplicate mapping id '${parsed.data.id}'` });
      return;
    }
    ids.add(parsed.data.id);
    mappings.push(parsed.data);
  });
  return { mappings, dropped };
}
