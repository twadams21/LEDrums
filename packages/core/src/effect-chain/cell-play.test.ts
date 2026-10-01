import { describe, expect, it } from 'vitest';
import { parseEffect, type CellPlay, type EffectCell } from './types';
import { cellKey, cellPlayMode, isCellReset, nextCellStep, pickCellPlay, resetCellSteps } from './cell-play';

/* The pure step logic: which Effect a Sequence / Random cell lets through, how steps advance and
   wrap, what a reset rewinds, and that Layer cells and other cells are untouched. */

const KICK: EffectCell = { row: 'kick', column: { kind: 'zone', slot: 0 } };
const SNARE: EffectCell = { row: 'snare', column: { kind: 'zone', slot: 0 } };
const ALWAYS: EffectCell = { row: 'kit', column: { kind: 'always' } };
const fx = (id: string, cell: EffectCell) => parseEffect({ id, cell, generator: { kind: 'solid' } });
const kick = [fx('k1', KICK), fx('k2', KICK), fx('k3', KICK)];
const snare = [fx('s1', SNARE), fx('s2', SNARE)];
const section = (cellPlay: CellPlay[]) => ({ effects: [...kick, ...snare], cellPlay });

describe('pickCellPlay', () => {
  it('a sequence cell lets one step through and advances; a layer cell passes everything', () => {
    const s = section([{ cell: KICK, mode: 'sequence' }]);
    let steps: ReadonlyMap<string, { next: number; last: number | null }> = new Map();
    const fired: string[][] = [];
    for (let i = 0; i < 4; i++) {
      const out = pickCellPlay(s, [...kick, ...snare], steps, () => 0);
      fired.push(out.fire.map((e) => e.id));
      steps = out.steps;
    }
    expect(fired).toEqual([
      ['k1', 's1', 's2'],
      ['k2', 's1', 's2'],
      ['k3', 's1', 's2'],
      ['k1', 's1', 's2'],
    ]);
    expect(nextCellStep(steps, KICK)).toBe(1);
  });

  it('wraps when the stack shrinks, instead of breaking', () => {
    const s = section([{ cell: KICK, mode: 'sequence' }]);
    const steps = new Map([[cellKey(KICK), { next: 2, last: 1 }]]);
    expect(pickCellPlay(s, kick.slice(0, 2), steps, () => 0).fire.map((e) => e.id)).toEqual(['k1']);
  });

  it('random never repeats the last pick when it has a choice, and a lone step always plays', () => {
    const s = section([{ cell: KICK, mode: 'random' }]);
    for (const r of [0, 0.4, 0.99]) {
      const out = pickCellPlay(s, kick, new Map([[cellKey(KICK), { next: 0, last: 1 }]]), () => r);
      expect(out.fire.map((e) => e.id)).not.toContain('k2');
      expect(out.fire).toHaveLength(1);
    }
    expect(pickCellPlay(s, kick.slice(0, 1), new Map([[cellKey(KICK), { next: 0, last: 0 }]]), () => 0.5).fire.map((e) => e.id)).toEqual(['k1']);
    // The first pick can be any step, the last included.
    expect(pickCellPlay(s, kick, new Map(), () => 0.99).fire.map((e) => e.id)).toEqual(['k3']);
  });

  it('an Always cell always layers, whatever its entry says', () => {
    expect(cellPlayMode({ cellPlay: [{ cell: ALWAYS, mode: 'sequence' }] }, ALWAYS)).toBe('layer');
  });
});

describe('resetCellSteps', () => {
  const s = section([
    { cell: KICK, mode: 'sequence', reset: { kind: 'midiNote', note: 30 } },
    { cell: SNARE, mode: 'random', reset: { kind: 'zone', drumId: 'kick', slot: 0 } },
  ]);
  const held = new Map([[cellKey(KICK), { next: 2, last: 1 }], [cellKey(SNARE), { next: 1, last: 0 }]]);

  it('rewinds only the cells whose reset the input carries', () => {
    const out = resetCellSteps(s, { midiNote: 30 }, held);
    expect(nextCellStep(out, KICK)).toBe(0);
    expect(nextCellStep(out, SNARE)).toBe(1);
  });

  it('a zone-mapped note carries its zone and its note: both resets apply', () => {
    const out = resetCellSteps(s, { drumId: 'kick', slot: 0, midiNote: 30 }, held);
    expect(nextCellStep(out, KICK)).toBe(0);
    expect(nextCellStep(out, SNARE)).toBe(0);
  });

  it('returns the same map when nothing resets, and isCellReset says whether something would', () => {
    expect(resetCellSteps(s, { midiNote: 31 }, held)).toBe(held);
    expect(isCellReset(s, { midiNote: 30 })).toBe(true);
    expect(isCellReset(s, { oscAddress: '/x' })).toBe(false);
  });
});
