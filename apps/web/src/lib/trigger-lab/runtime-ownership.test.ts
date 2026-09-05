import { describe, expect, it, vi } from 'vitest';
import { registerCanvasScene, unregisterCanvasScene, voice } from '@ledrums/core';
import { runtimeModel } from '../../../../../packages/core/src/voice/runtime-test-fixtures';
import { fireOwnershipVoice, ownershipSim } from './runtime-ownership-fixtures';

describe('Sim ownership while connected preview skips local render', () => {
  it('prunes on reaping without capturing or rendering, including cached Canvas adapter refs', () => {
    const scene = { id: 'sim-owner', name: 'Owner', sampler: { kind: 'strip' as const }, elements: [] };
    registerCanvasScene(scene);
    try {
      const sim = ownershipSim(`canvas:${scene.id}`, 8);
      const v = sim.voices[0]!;
      expect(v.modState).toHaveLength(1);
      expect(v.renderGenerator).toBeDefined();
      const render = vi.spyOn(sim['compositor'], 'render');
      const prune = vi.spyOn(sim['compositor'], 'prunePresentation');
      unregisterCanvasScene(scene.id);
      sim.stopAll();
      sim.tick(1000);
      expect(sim.voices).toHaveLength(0);
      expect(prune).toHaveBeenCalledOnce();
      expect(render).not.toHaveBeenCalled();
      expect(v.modState).toBeUndefined();
      expect(v.genState).toBeNull();
      expect(v.renderGenerator).toBeUndefined();
      expect(sim['renderedGenerators']).toHaveLength(0);
      expect(sim['renderedModel']).toBeNull();
    } finally { unregisterCanvasScene(scene.id); }
  });

  for (const count of [16, 2, 8, null]) {
    it(`model replacement ${count} clears old owners immediately without changing voice identity`, () => {
      const sim = ownershipSim('solid-colour', 8);
      const v = sim.voices[0]!;
      const identity = [v.id, v.seed, v.bornAtMs];
      const render = vi.spyOn(sim['compositor'], 'render');
      sim.pixelModel = count === null ? null : runtimeModel([count]);
      expect([v.id, v.seed, v.bornAtMs]).toEqual(identity);
      expect(v.active).toBe(true);
      expect(v.genState).toBeNull();
      expect(v.modState).toBeUndefined();
      expect(v.renderGenerator).toBeUndefined();
      expect(v.renderModel).toBe(sim.pixelModel ?? undefined);
      expect(sim['renderedModel']).toBeNull();
      expect(sim['renderedGenerators']).toHaveLength(0);
      expect(sim['framebuffer']).toBeNull();
      expect(render).not.toHaveBeenCalled();
    });
  }

  it('prunes a stolen generation at spawn, even before the next tick or presentation', () => {
    const sim = ownershipSim('solid-colour', 8);
    const old = sim.voices[0]!;
    const id = old.id;
    const prune = vi.spyOn(sim['compositor'], 'prunePresentation');
    const render = vi.spyOn(sim['compositor'], 'render');
    for (let i = 0; i < 256; i++) fireOwnershipVoice(sim);
    expect(sim.voices[0]).toBe(old);
    expect(old.id).not.toBe(id);
    expect(old.modState).toBeUndefined();
    expect(prune).toHaveBeenCalledTimes(256);
    expect(render).not.toHaveBeenCalled();
    expect(sim['renderedGenerators']).toHaveLength(0);
  });

  it('preserves a survivor baseline through a same-tick spawn and subsequent retirement', () => {
    const actual = ownershipSim('solid-colour', 8);
    const expected = ownershipSim('solid-colour', 8);
    const survivor = actual.voices[0]!;
    const baseline = survivor.modState;
    fireOwnershipVoice(actual); // level-zero newcomer must not advance the survivor
    expect(survivor.modState).toBe(baseline);
    expect(actual.render(actual.pixelModel!)).toEqual(expected.render(expected.pixelModel!));
    voice.releaseVoice(actual.voices[1]!, actual.timeMs);
    // tick(0) takes the real no-paint retirement path without changing time/dt of interest.
    actual.tick(0); expected.tick(0);
    actual.setCc(1, 100, null); expected.setCc(1, 100, null);
    expect(actual.render(actual.pixelModel!)).toEqual(expected.render(expected.pixelModel!));
    expect(survivor.modState).toEqual(expected.voices[0]!.modState);
  });
});
