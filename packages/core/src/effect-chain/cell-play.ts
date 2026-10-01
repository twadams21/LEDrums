/**
 * Cell play — the step logic behind a cell's Layer / Sequence / Random mode (see
 * {@link cellPlaySchema}). Pure: the step state is a value the caller owns and hands back each
 * time, so the server engine and the offline sim stay deterministic and can't disagree. Matching
 * (which Effects an input reaches) stays in the resolver; this only narrows what was matched.
 *
 *   matched  = matchSectionEffects(section, event)          // every Effect the input reaches
 *   steps    = resetCellSteps(section, event, steps)         // a reset input rewinds its cells
 *   { fire, steps } = pickCellPlay(section, matched, steps, rand)
 *
 * The steps of a sequenced cell are the Effects the fire matched IN THAT CELL, in stack order —
 * so a bypassed Effect is skipped, and adding or removing one re-wraps rather than breaking.
 */
import type { CellPlay, CellPlayMode, Effect, EffectCell } from './types';
import { sameEffectCell } from './resolver';
import type { EffectInputEvent } from './resolver';

/** A cell's place in its sequence: the next step to play, and the last one played (Random's
    no-repeat). Absent = never fired since the section started or the cell was reset. */
export interface CellStep {
  next: number;
  last: number | null;
}
export type CellSteps = ReadonlyMap<string, CellStep>;

export interface CellPlaySection {
  effects?: readonly Effect[];
  cellPlay?: readonly CellPlay[];
}

/** A stable key for a cell: row, column kind and (for a zone) slot. */
export function cellKey(cell: EffectCell): string {
  return cell.column.kind === 'zone' ? `${cell.row}|zone|${cell.column.slot}` : `${cell.row}|${cell.column.kind}`;
}

/** The play settings of one cell, or null when it simply layers. An Always cell always layers. */
export function cellPlayOf(section: CellPlaySection, cell: EffectCell): CellPlay | null {
  if (cell.column.kind === 'always') return null;
  return section.cellPlay?.find((entry) => sameEffectCell(entry.cell, cell)) ?? null;
}

/** Just the mode — `layer` for a cell with no entry. */
export function cellPlayMode(section: CellPlaySection, cell: EffectCell): CellPlayMode {
  return cellPlayOf(section, cell)?.mode ?? 'layer';
}

/**
 * Narrow a fire's matched Effects by each cell's mode. Layer cells pass every Effect through; a
 * Sequence cell passes its next step and advances; a Random cell passes one at random (never the
 * same twice running when it has a choice). Order is kept: the result is still composition order.
 * `rand` returns [0, 1) — the engine passes its seeded PRNG so a replay is exact.
 */
export function pickCellPlay(
  section: CellPlaySection,
  matched: readonly Effect[],
  steps: CellSteps,
  rand: () => number,
): { fire: Effect[]; steps: Map<string, CellStep> } {
  const next = new Map(steps);
  if (!section.cellPlay?.length) return { fire: [...matched], steps: next };
  // Group the matched Effects of every non-layer cell (in matched order = stack order).
  const groups = new Map<string, Effect[]>();
  for (const effect of matched) {
    if (cellPlayMode(section, effect.cell) === 'layer') continue;
    const key = cellKey(effect.cell);
    groups.set(key, [...(groups.get(key) ?? []), effect]);
  }
  const chosen = new Set<Effect>();
  for (const [key, stack] of groups) {
    const mode = cellPlayMode(section, stack[0]!.cell);
    const held = next.get(key) ?? { next: 0, last: null };
    let index: number;
    if (mode === 'sequence') {
      index = held.next % stack.length;
    } else if (stack.length === 1) {
      index = 0;
    } else if (held.last === null || held.last >= stack.length) {
      // First fire (or the stack shrank past the last pick): any step.
      index = Math.min(stack.length - 1, Math.floor(rand() * stack.length));
    } else {
      // Random without an immediate repeat: pick among the OTHER steps.
      const pick = Math.min(stack.length - 2, Math.floor(rand() * (stack.length - 1)));
      index = pick >= held.last ? pick + 1 : pick;
    }
    chosen.add(stack[index]!);
    next.set(key, { next: (index + 1) % stack.length, last: index });
  }
  const fire = matched.filter((effect) => cellPlayMode(section, effect.cell) === 'layer' || chosen.has(effect));
  return { fire, steps: next };
}

/**
 * The Effects whose earlier light a fire of `effect` cuts: with Retrigger `cut`, every Effect in
 * its cell, itself included (bypassed ones too — a step bypassed mid-tail is still cut). Empty for
 * any other Retrigger.
 */
export function retriggerCutTargets(section: CellPlaySection, effect: Effect): string[] {
  if (effect.retrigger !== 'cut') return [];
  return (section.effects ?? []).filter((other) => sameEffectCell(other.cell, effect.cell)).map((other) => other.id);
}

/** Does this input carry the cell's reset? (A zone-mapped note carries its zone AND its note.) */
function resetMatches(play: CellPlay, event: EffectInputEvent): boolean {
  const reset = play.reset;
  if (!reset) return false;
  switch (reset.kind) {
    case 'zone':
      return event.drumId === reset.drumId && event.slot === reset.slot;
    case 'midiNote':
      return event.midiNote === reset.note;
    case 'midiCc':
      return event.midiCc === reset.cc;
    case 'osc':
      return event.oscAddress === reset.address;
  }
}

/**
 * Rewind every cell whose reset this input carries. Returns the SAME map when nothing resets, so
 * a caller can tell (and an unrouted reset-only note is not reported as a miss).
 */
export function resetCellSteps(section: CellPlaySection, event: EffectInputEvent, steps: CellSteps): CellSteps {
  let out: Map<string, CellStep> | null = null;
  for (const play of section.cellPlay ?? []) {
    if (play.mode === 'layer' || !resetMatches(play, event)) continue;
    out ??= new Map(steps);
    out.delete(cellKey(play.cell));
  }
  return out ?? steps;
}

/** True when the input is some cell's reset — so a reset-only message isn't an unrouted miss. */
export function isCellReset(section: CellPlaySection, event: EffectInputEvent): boolean {
  return (section.cellPlay ?? []).some((play) => play.mode !== 'layer' && resetMatches(play, event));
}

/** The step a cell will play next (0-based), for the UI's "next" marker. */
export function nextCellStep(steps: CellSteps, cell: EffectCell): number {
  return steps.get(cellKey(cell))?.next ?? 0;
}
