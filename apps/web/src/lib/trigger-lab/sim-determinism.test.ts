/* Phase-2 item 2 acceptance — determinism at the VISUALISER INPUT seam (the offline
   preview path: Sim eval → render.ts composite). The sim's randomness (random/chance
   nodes, generator seeds) is core-PRNG seeded, never ambient `Math.random` — two sims
   fed identical trigger sequences produce byte-identical buffers, and random-look
   generator effects (confetti) differ per fire yet replay exactly. */
import { describe, expect, it } from 'vitest';
import { BUSES, EFFECTS, PRESETS, play } from './fixtures';
import { Sim, treeToGraph, type TriggerCtx, type TriggerGraph } from './sim';
import { buildLabModel } from './kit';
import { renderFrame } from './render';

function freshSim(): Sim {
  return new Sim(
    BUSES.map((b) => ({ ...b })),
    [...EFFECTS],
    [...PRESETS],
  );
}

function ctx(velocity = 1): TriggerCtx {
  return { velocity, sectionIndex: 0, sectionCount: 0, beatPhase: 0, sourceDrumId: 'kick', bpm: 120 };
}

/** trigger → chance(0.5) → random → [play, play] — every ambient-randomness code path. */
function randomGraph(): TriggerGraph {
  const g = treeToGraph(play('gen:confetti-burst', 'oneshot'));
  const playNode = g.nodes.find((n) => n.kind === 'effect')!;
  const trig = g.nodes.find((n) => n.kind === 'trigger')!;
  const chance = { ...playNode, id: 'chance-1', kind: 'chance' as const, p: 0.5 };
  const rand = { ...playNode, id: 'random-1', kind: 'random' as const, noRepeat: false };
  const play2 = { ...playNode, id: 'play-2' };
  g.nodes.push(chance, rand, play2);
  g.edges = [
    { id: 'e0', from: trig.id, to: 'chance-1' },
    { id: 'e1', from: 'chance-1', to: 'random-1' },
    { id: 'e2', from: 'random-1', to: playNode.id },
    { id: 'e3', from: 'random-1', to: 'play-2' },
    { id: 'e4', from: playNode.id, to: 'output' },
    { id: 'e5', from: 'play-2', to: 'output' },
  ];
  return g;
}

/** Run a scripted session (fire every 100ms, tick 16ms) and snapshot the buffer per tick. */
function run(graph: TriggerGraph, ticks = 40): Uint8Array[] {
  const lab = buildLabModel();
  const sim = freshSim();
  const frames: Uint8Array[] = [];
  const buf = new Uint8Array(lab.model.count * 3);
  for (let i = 0; i < ticks; i++) {
    if (i % 6 === 0) sim.triggerGraph('t', graph, ctx());
    sim.tick(16);
    renderFrame(buf, sim, lab);
    frames.push(Uint8Array.from(buf));
  }
  return frames;
}

describe('offline preview determinism (visualiser input seam)', () => {
  it('two sims fed identical trigger sequences render byte-identical buffers — through chance/random/confetti', () => {
    const a = run(randomGraph());
    const b = run(randomGraph());
    // sanity: something actually renders (a zero session would pass vacuously)
    expect(a.some((f) => f.some((x) => x > 0))).toBe(true);
    for (let i = 0; i < a.length; i++) {
      expect(Buffer.from(a[i]!).equals(Buffer.from(b[i]!)), `frame ${i}`).toBe(true);
    }
  });

  it('successive confetti fires differ (per-trigger seed), yet replay exactly', () => {
    const g = treeToGraph(play('gen:confetti-burst', 'oneshot'));
    const runOnce = (): Uint8Array[] => {
      const lab = buildLabModel();
      const sim = freshSim();
      const frames: Uint8Array[] = [];
      const buf = new Uint8Array(lab.model.count * 3);
      for (let i = 0; i < 40; i++) {
        if (i === 0 || i === 12) sim.triggerGraph('t', g, ctx());
        sim.tick(16);
        renderFrame(buf, sim, lab);
        frames.push(Uint8Array.from(buf));
      }
      return frames;
    };
    const a = runOnce();
    const b = runOnce();
    for (let i = 0; i < a.length; i++) expect(Buffer.from(a[i]!).equals(Buffer.from(b[i]!))).toBe(true);
    // decorrelation: the same trigger-age frame of fire 1 vs fire 2 differ
    const lit = a.findIndex((f) => f.some((x) => x > 0));
    expect(lit).toBeGreaterThanOrEqual(0);
    expect(lit).toBeLessThan(12);
    expect(Buffer.from(a[lit]!).equals(Buffer.from(a[lit + 12]!))).toBe(false);
  });
});
