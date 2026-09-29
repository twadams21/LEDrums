/* Effect chains (S05 §3, piece "sim") — the offline Sim playing an Effect show through its
   private core engine: zone hits, Cues, audition, Always, Clock, the Master chain, panic, and
   the return to the graph path. Asserted at the Sim's public surface (inputs in, frame out). */
import { describe, expect, it } from 'vitest';
import { effectChain, voice, type PixelModel } from '@ledrums/core';
import { runtimeBus, runtimeEffect, runtimeModel } from '../../../../../packages/core/src/voice/runtime-test-fixtures';
import { Sim, makeNode, type TriggerGraph } from './sim';

type Effect = effectChain.Effect;

const SONG = 'song';

function solid(over: Record<string, unknown> & { id: string; cell: Effect['cell'] }, color = '#ffffff'): Effect {
  return effectChain.parseEffect({
    name: over.id,
    generator: { kind: 'solid', style: 'solid', params: { color } },
    amp: { attackMs: 0, length: { ms: 2000 }, releaseMs: 50 },
    ...over,
  });
}

function section(id: string, effects: Effect[], master: unknown[] = []): voice.SongSection {
  return { id, name: id, slots: {}, effects, master: effectChain.masterChainSchema.parse(master) };
}

function showOf(...sections: voice.SongSection[]): voice.Show {
  return { ...voice.emptyShow(), songs: [{ id: SONG, name: 'Song', sections }] };
}

function makeSim(show: voice.Show, sectionId?: string): { sim: Sim; model: PixelModel } {
  const model = runtimeModel([16, 16]);
  const sim = new Sim([], [], []);
  sim.pixelModel = model;
  sim.setEffectShow(show, sectionId ? { songId: SONG, sectionId } : undefined);
  return { sim, model };
}

/** Mean red (or `channel`) over one drum's pixels, from the Sim's own frame. */
function drumLevel(sim: Sim, model: PixelModel, drumId: string, channel = 0): number {
  const frame = sim.render(model);
  const d = model.drumById.get(drumId)!;
  let sum = 0;
  for (let i = d.pixelStart; i < d.pixelStart + d.pixelCount; i++) sum += frame[i * 4 + channel]!;
  return sum / d.pixelCount;
}

function lit(sim: Sim, model: PixelModel, channel = 0): string[] {
  return ['d0', 'd1'].filter((id) => drumLevel(sim, model, id, channel) > 1e-6);
}

/** Advance `ms` in 16 ms ticks. */
function run(sim: Sim, ms: number): void {
  for (let t = 0; t < ms; t += 16) sim.tick(16);
}

const zone = (row: string, slot = 0) => ({ row, column: { kind: 'zone' as const, slot } });
const kit = (kind: 'always' | 'clock' | 'cue') => ({ row: 'kit', column: { kind } });

describe('Sim Effect path — inputs', () => {
  it('a zone hit lights only its drum, on the tick after the hit', () => {
    const { sim, model } = makeSim(showOf(section('A', [solid({ id: 'k', cell: zone('d0') })])));
    sim.tick(16);
    sim.hitEffects({ drumId: 'd1', zone: '0', velocity: 1 });
    sim.tick(16);
    expect(lit(sim, model)).toEqual([]);
    sim.hitEffects({ drumId: 'd0', zone: '0', velocity: 1 });
    expect(lit(sim, model)).toEqual([]); // queued, not yet ticked
    sim.tick(16);
    expect(lit(sim, model)).toEqual(['d0']);
  });

  it('fireEffect auditions an Effect by id; a drum-row Effect lights its own drum', () => {
    const { sim, model } = makeSim(showOf(section('A', [solid({ id: 'snare', cell: zone('d1') })])));
    sim.fireEffect('snare');
    sim.tick(16);
    expect(lit(sim, model)).toEqual(['d1']);
    expect(sim.effectFiredAt('snare')).toBe(16);
    expect(sim.log[0]!.resolved).toEqual(['▶ snare  (audition)']);
  });

  it('fireEffect of an unknown id spawns nothing and logs the skip', () => {
    const { sim, model } = makeSim(showOf(section('A', [])));
    sim.fireEffect('ghost');
    sim.tick(16);
    expect(lit(sim, model)).toEqual([]);
    expect(sim.log[0]!.resolved).toEqual(['— skipped ghost (no-such-effect)']);
  });

  it('MIDI note, CC and OSC Cues fire through the Sim inputs', () => {
    for (const [source, send] of [
      [{ midiNote: 60 }, (s: Sim) => s.hitEffects({ note: 60, velocity: 1 })],
      [{ midiCc: 20 }, (s: Sim) => s.setCc(20, 127, 1)],
      [{ oscAddress: '/cue' }, (s: Sim) => s.hitEffects({ address: '/cue', value: 1 })],
    ] as const) {
      const { sim, model } = makeSim(showOf(section('A', [solid({ id: 'c', cell: kit('cue'), trigger: { kind: 'cue', source } })])));
      send(sim);
      sim.tick(16);
      expect(lit(sim, model), JSON.stringify(source)).toEqual(['d0', 'd1']);
    }
  });

  it('setOsc is modulation only: it never fires an OSC Cue', () => {
    const { sim, model } = makeSim(showOf(section('A', [solid({ id: 'c', cell: kit('cue'), trigger: { kind: 'cue', source: { oscAddress: '/cue' } } })])));
    sim.setOsc('/cue', 1);
    sim.tick(16);
    expect(lit(sim, model)).toEqual([]);
  });

  it('a note-off ends a hold Effect its zone-mapped note fired', () => {
    const hold = solid({ id: 'h', cell: zone('d0'), amp: { attackMs: 0, length: 'hold', releaseMs: 0 } });
    const { sim, model } = makeSim(showOf(section('A', [hold])));
    sim.hitEffects({ drumId: 'd0', zone: '0', note: 36, velocity: 1 });
    sim.tick(16);
    sim.tick(500);
    expect(lit(sim, model)).toEqual(['d0']);
    sim.releaseEffects({ drumId: 'd0', zone: '0', note: 36 });
    run(sim, 200); // the release fade (core's minimum release) completes
    expect(lit(sim, model)).toEqual([]);
  });
});

describe('Sim Effect path — section content', () => {
  it('loading a show recalls its first section, so Always Effects play without an explicit recall', () => {
    const { sim, model } = makeSim(showOf(section('A', [solid({ id: 'a', cell: kit('always') })])));
    sim.tick(16);
    expect(lit(sim, model)).toEqual(['d0', 'd1']);
    expect(sim.effectSelection).toEqual({ songId: SONG, sectionId: 'A' });
  });

  it('re-loading an edited show keeps the active section and its Always Effects', () => {
    const show = showOf(section('A', []), section('B', [solid({ id: 'b', cell: kit('always') })]));
    const { sim, model } = makeSim(show, 'B');
    sim.tick(16);
    sim.setEffectShow(showOf(section('A', []), section('B', [solid({ id: 'b', cell: kit('always') }, '#00ff00')])));
    sim.tick(16);
    expect(sim.effectSelection.sectionId).toBe('B');
    expect(lit(sim, model, 1)).toEqual(['d0', 'd1']);
    expect(lit(sim, model, 0)).toEqual([]);
  });

  it('recallSection switches sections: the old Always releases, the new one plays', () => {
    const show = showOf(
      section('A', [solid({ id: 'red', cell: kit('always'), amp: { attackMs: 0, releaseMs: 0 } }, '#ff0000')]),
      section('B', [solid({ id: 'blue', cell: kit('always') }, '#0000ff')]),
    );
    const { sim, model } = makeSim(show, 'A');
    sim.tick(16);
    expect(lit(sim, model, 0)).toEqual(['d0', 'd1']);
    sim.recallSection({ id: 'B', name: 'B', looks: {} }, SONG);
    run(sim, 200);
    expect(lit(sim, model, 0)).toEqual([]);
    expect(lit(sim, model, 2)).toEqual(['d0', 'd1']);
  });

  it('a Clock Effect fires once per beat of the Sim transport', () => {
    const tick = solid({ id: 't', cell: kit('clock'), trigger: { kind: 'clock', every: { beats: 1 } }, amp: { attackMs: 0, length: { ms: 50 }, releaseMs: 0 } });
    const { sim } = makeSim(showOf(section('A', [tick])));
    sim.bpm = 120; // 500 ms per beat
    for (let i = 0; i < 125; i++) sim.tick(16); // 2000 ms → beats 1, 2, 3, 4 crossed
    const fires = sim.log.filter((e) => e.resolved[0]?.startsWith('▶ t'));
    expect(fires).toHaveLength(4);
  });

  it('the Master chain runs over the whole frame (levels 0.5 halves an Always wash)', () => {
    const wash = solid({ id: 'w', cell: kit('always') });
    const plain = makeSim(showOf(section('A', [wash])));
    const halved = makeSim(showOf(section('A', [wash], [{ uid: 'l', modifierId: 'levels', params: { brightness: 0.5 } }])));
    plain.sim.tick(16); halved.sim.tick(16);
    const full = drumLevel(plain.sim, plain.model, 'd0');
    expect(full).toBeGreaterThan(0.5);
    expect(drumLevel(halved.sim, halved.model, 'd0')).toBeCloseTo(full * 0.5, 5);
  });

  it('stopAll releases every Effect voice, Always included', () => {
    const { sim, model } = makeSim(showOf(section('A', [solid({ id: 'a', cell: kit('always'), amp: { attackMs: 0, releaseMs: 0 } })])));
    sim.tick(16);
    sim.stopAll();
    run(sim, 200);
    expect(lit(sim, model)).toEqual([]);
    expect(sim.effectVoiceStats()).toEqual([]);
  });

  it('a pixel model change re-targets the engine: the next tick renders at the new size', () => {
    const { sim } = makeSim(showOf(section('A', [solid({ id: 'a', cell: kit('always') })])));
    sim.tick(16);
    const bigger = runtimeModel([32, 32]);
    sim.pixelModel = bigger;
    sim.tick(16);
    const frame = sim.render(bigger);
    expect(frame.length).toBe(bigger.pixelCount * 4);
    expect(frame[0]).toBeGreaterThan(0);
  });
});

describe('Sim Effect path — graph path is unchanged', () => {
  const graph: TriggerGraph = {
    version: 3,
    nodes: [
      makeNode('trigger', 'trigger', 0, 0, { source: { kind: 'drum', drumId: 'd0', zone: '0' } }),
      makeNode('effect', 'fx', 200, 0, { effectId: 'fx', busId: 'b', mode: 'loop', scope: 'kit', params: {} }),
      makeNode('output', 'output', 400, 0),
    ],
    edges: [{ id: 'e0', from: 'trigger', to: 'fx' }, { id: 'e1', from: 'fx', to: 'output' }],
  };
  const ctx = { velocity: 1, sourceDrumId: 'd0', sectionIndex: 0, sectionCount: 0, beatPhase: 0, bpm: 120 };

  it('a Sim with no Effect show renders its graph voices; setEffectShow(null) returns to them', () => {
    const model = runtimeModel([16, 16]);
    const sim = new Sim([runtimeBus], [runtimeEffect('solid-colour')], []);
    sim.pixelModel = model;
    expect(sim.effectPath).toBe(false);
    sim.triggerGraph('g', graph, ctx, 'g');
    sim.tick(16);
    const graphFrame = sim.render(model).slice();
    expect(graphFrame.some((v, i) => i % 4 !== 3 && v > 0)).toBe(true);

    sim.setEffectShow(showOf(section('A', [])));
    sim.tick(16);
    expect(sim.effectPath).toBe(true);
    expect([...sim.render(model)].filter((_, i) => i % 4 !== 3).every((v) => v === 0)).toBe(true);

    sim.setEffectShow(null);
    expect(sim.effectPath).toBe(false);
    expect(sim.render(model).some((v, i) => i % 4 !== 3 && v > 0)).toBe(true);
  });
});
