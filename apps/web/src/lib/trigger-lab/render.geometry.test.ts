import { expect, it } from 'vitest';
import { runtimeModel } from '../../../../../packages/core/src/voice/runtime-test-fixtures';
import { BUSES, EFFECTS, PRESETS, play } from './fixtures';
import { Sim, treeToGraph } from './sim';
import { buildLabModel } from './kit';
import { renderFrame } from './render';

it('offline geometry edits restart generator and modifier state, including equal totals', () => {
  const lab = buildLabModel();
  const fresh = () => {
    const sim = new Sim(BUSES, EFFECTS, PRESETS);
    sim.triggerGraph('test', treeToGraph(play('gen:pixel-accum', 'loop')), {
      velocity: 1, sourceDrumId: 'd0', sectionIndex: 0, sectionCount: 0, beatPhase: 0, bpm: 120,
    });
    sim.voices[0]!.scope = 'kit';
    sim.voices[0]!.modifiers = [{ modifierId: 'feedback', params: {}, bypass: false }];
    return sim;
  };
  const sim = fresh();
  for (const pm of [runtimeModel(), runtimeModel([8, 8]), runtimeModel([2, 2]), runtimeModel([2, 2], true)]) {
    sim.tick(16);
    const current = { pm, model: { ...lab.model, count: pm.pixelCount } };
    const actual = new Uint8Array(pm.pixelCount * 3);
    renderFrame(actual, sim, current);
    const reference = fresh();
    for (let t = 0; t < sim.timeMs; t += 16) reference.tick(16);
    const expected = new Uint8Array(actual.length);
    renderFrame(expected, reference, current);
    expect(actual).toEqual(expected);
  }
});
