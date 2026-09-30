/* MIDI-map InputMappings — the store's pure half (effect chains S07, wave 5b).

   The store keeps the show's `InputMapping[]` as one rune and implements `MapModeApi` over the
   pure ops here: one mapping per target (re-binding replaces the source), range edits, the
   global-control read / write shapes, the source kinds a target can take, and the edge rule a
   bypass toggle fires on. No runes, no DOM, no store: unit-tested in isolation. */

import { effectChain, type GlobalControlBinding } from '@ledrums/core';
import type { MapTarget } from '../map-api';

type InputMapping = effectChain.InputMapping;
type InputMappingSource = effectChain.InputMappingSource;
type InputMappingTarget = effectChain.InputMappingTarget;

/** The `mapTargetId` of any map target: core `inputMappingTargetId`, or `global:<action>`. */
export function mapTargetId(target: MapTarget): string {
  return target.kind === 'globalControl' ? `global:${target.action}` : effectChain.inputMappingTargetId(target);
}

/** The mapping bound to a target id, or undefined. */
export function mappingForTarget(mappings: readonly InputMapping[], targetId: string): InputMapping | undefined {
  return mappings.find((m) => effectChain.inputMappingTargetId(m.target) === targetId);
}

/** Two sources are the same input (same kind, same value). */
export function sameMappingSource(a: InputMappingSource, b: InputMappingSource): boolean {
  if ('midiNote' in a) return 'midiNote' in b && a.midiNote === b.midiNote;
  if ('midiCc' in a) return 'midiCc' in b && a.midiCc === b.midiCc;
  if ('oscAddress' in a) return 'oscAddress' in b && a.oscAddress.trim() === b.oscAddress.trim();
  return 'key' in b && a.key === b.key;
}

/**
 * Bind `target` to `source`: an existing mapping for the target keeps its id and range and
 * takes the new source; otherwise a new mapping is appended with `mintId()`. Returns the SAME
 * array when nothing would change (re-learning the source a target already has), so the caller
 * can skip the undo step.
 */
export function withMappingSource(
  mappings: readonly InputMapping[],
  target: InputMappingTarget,
  source: InputMappingSource,
  mintId: () => string,
): readonly InputMapping[] {
  const id = effectChain.inputMappingTargetId(target);
  const index = mappings.findIndex((m) => effectChain.inputMappingTargetId(m.target) === id);
  if (index < 0) return [...mappings, { id: mintId(), source, target }];
  const existing = mappings[index]!;
  if (sameMappingSource(existing.source, source)) return mappings;
  const next = [...mappings];
  next[index] = { ...existing, source };
  return next;
}

/** Drop a target's mapping. The same array when it has none. */
export function withoutMapping(mappings: readonly InputMapping[], targetId: string): readonly InputMapping[] {
  const next = mappings.filter((m) => effectChain.inputMappingTargetId(m.target) !== targetId);
  return next.length === mappings.length ? mappings : next;
}

/**
 * Set a continuous mapping's range (`undefined` = the target's own bound). The same array when
 * the target has no mapping, is not continuous, or the range is unchanged. A non-finite bound
 * reads as unset.
 */
export function withMappingRange(
  mappings: readonly InputMapping[],
  targetId: string,
  rangeMin: number | undefined,
  rangeMax: number | undefined,
): readonly InputMapping[] {
  const index = mappings.findIndex((m) => effectChain.inputMappingTargetId(m.target) === targetId);
  if (index < 0) return mappings;
  const existing = mappings[index]!;
  if (!effectChain.isContinuousTarget(existing.target)) return mappings;
  const min = rangeMin !== undefined && Number.isFinite(rangeMin) ? rangeMin : undefined;
  const max = rangeMax !== undefined && Number.isFinite(rangeMax) ? rangeMax : undefined;
  if (existing.rangeMin === min && existing.rangeMax === max) return mappings;
  const { rangeMin: _min, rangeMax: _max, ...rest } = existing;
  const updated: InputMapping = { ...rest };
  if (min !== undefined) updated.rangeMin = min;
  if (max !== undefined) updated.rangeMax = max;
  const next = [...mappings];
  next[index] = updated;
  return next;
}

/**
 * Why `target` cannot take this KIND of source, or null when it can. Keys resolve in the web
 * as discrete presses, so they cannot drive a continuous control, and global controls have no
 * key binding (Settings → Global controls binds MIDI and OSC only).
 */
export function mapSourceKindRefusal(target: MapTarget, source: InputMappingSource): string | null {
  if (!('key' in source)) return null;
  if (target.kind === 'globalControl') return 'Global controls bind a MIDI note, a CC or an OSC address, not a key.';
  if (effectChain.isContinuousTarget(target)) return 'A key can’t drive a continuous control — move a CC or send OSC.';
  return null;
}

/** A global control's binding as ONE map source (note, then CC, then OSC), or null. */
export function globalControlSource(binding: GlobalControlBinding | undefined): InputMappingSource | null {
  if (!binding) return null;
  if (binding.midiNote !== undefined) return { midiNote: binding.midiNote };
  if (binding.midiCc !== undefined) return { midiCc: binding.midiCc };
  const address = binding.oscAddress?.trim();
  return address ? { oscAddress: address } : null;
}

/**
 * The global-control patch a map-mode bind writes: only the source's own field changes, so a
 * control's other bindings (Settings may give it a note AND an OSC address) are kept.
 * Null for a key (refused by {@link mapSourceKindRefusal}).
 */
export function globalControlPatch(source: InputMappingSource): GlobalControlBinding | null {
  if ('midiNote' in source) return { midiNote: source.midiNote };
  if ('midiCc' in source) return { midiCc: source.midiCc };
  if ('oscAddress' in source) return { oscAddress: source.oscAddress.trim() };
  return null;
}

/** The patch that clears every binding of a global control. */
export const CLEAR_GLOBAL_CONTROL: GlobalControlBinding = { midiNote: undefined, midiCc: undefined, oscAddress: undefined };

/** A continuous CC / OSC value crosses this (rising) to press a bypass toggle — the engine's
    discrete-CC threshold, so a toggle and a fire agree on what a button press is. */
export const TOGGLE_THRESHOLD = 0.5;

/**
 * Bypass toggles press on a rising edge through {@link TOGGLE_THRESHOLD}: a note-on always
 * presses; a CC presses when it rises through the threshold (so a knob sweep or a button's
 * 127 / 0 pair toggles once, not per message); an OSC message presses at or above it (a
 * sender that only ever sends 1 still toggles each time, and its 0 release does not).
 *
 * Holds the last value per CC controller; allocation-free on the hot path.
 */
export class BypassToggleEdges {
  private readonly lastCc = new Map<number, number>();

  /** Whether this CC value (normalised 0..1) presses. Records it either way. */
  cc(controller: number, value01: number): boolean {
    const previous = this.lastCc.get(controller) ?? 0;
    this.lastCc.set(controller, value01);
    return previous < TOGGLE_THRESHOLD && value01 >= TOGGLE_THRESHOLD;
  }

  /** Whether this OSC value presses. */
  osc(value: number): boolean {
    return value >= TOGGLE_THRESHOLD;
  }

  /** Forget every CC position (a show swap). */
  reset(): void {
    this.lastCc.clear();
  }
}
