import { describe, expect, it } from 'vitest';
import { effectChain, voice } from '@ledrums/core';
import { runtimeModel } from '../../../../../packages/core/src/voice/runtime-test-fixtures';
import { Sim } from './sim';
import { buildLabModel } from './kit';
import { renderFrame } from './render';

function rgb(frame: Readonly<Float32Array>) {
  return Uint8Array.from(Array.from({ length: frame.length / 4 * 3 }, (_, i) => Math.round(frame[Math.floor(i / 3) * 4 + i % 3]! * 255)));
}

// ---- Effect shows (effect chains, S05 §3) ------------------------------------------------------
// The Sim plays an Effect show through a private core engine. These replay one input log into
// the Sim (through its public inputs, clock and preview quantizer) and into a separate server-
// style engine driven by hand, and require the same bytes on every frame.

function effectParityShow(master = true): voice.Show {
  const fx = (input: Record<string, unknown>) => effectChain.parseEffect(input);
  const effects = [
    // zone: a Wave / radial on d0's head, strobed.
    fx({ id: 'zone', name: 'Zone', cell: { row: 'd0', column: { kind: 'zone', slot: 0 } },
      generator: { kind: 'wave', style: 'radial' }, amp: { attackMs: 20, length: { ms: 300 }, releaseMs: 120 },
      modifiers: [{ uid: 'st', modifierId: 'strobe', params: { rate: 12, duty: 0.5 } }] }),
    // Always: a low-opacity rainbow gradient over the kit.
    fx({ id: 'always', name: 'Always', cell: { row: 'kit', column: { kind: 'always' } },
      generator: { kind: 'gradient', style: 'rainbow' }, opacity: 0.3 }),
    // Clock: a short white flash on d1 every beat.
    fx({ id: 'clock', name: 'Clock', cell: { row: 'd1', column: { kind: 'clock' } },
      trigger: { kind: 'clock', every: { beats: 1 } },
      generator: { kind: 'solid', style: 'solid', params: { color: '#ffffff' } }, amp: { attackMs: 0, length: { ms: 60 }, releaseMs: 60 } }),
    // Cue: auditioned by id below.
    fx({ id: 'cue', name: 'Cue', cell: { row: 'kit', column: { kind: 'cue' } }, trigger: { kind: 'cue', source: { midiNote: 60 } },
      generator: { kind: 'solid', style: 'solid', params: { color: '#ff0000' } }, amp: { attackMs: 0, length: { ms: 100 }, releaseMs: 50 }, blend: 'screen' }),
  ];
  const masterChain = master ? effectChain.masterChainSchema.parse([{ uid: 'lv', modifierId: 'levels', params: { brightness: 0.8 } }]) : [];
  return { ...voice.emptyShow(), songs: [{ id: 'song', name: 'Song', sections: [{ id: 'A', name: 'A', slots: {}, effects, master: masterChain }] }] };
}

function effectPair(show: voice.Show) {
  let model = runtimeModel([32, 32]);
  const sim = new Sim();
  sim.pixelModel = model;
  sim.setEffectShow(show, { songId: 'song', sectionId: 'A' });
  const engine = voice.createVoiceBusEngine();
  engine.setModel(model);
  engine.setShow(show);
  engine.applyInput({ kind: 'recallSection', songId: 'song', sectionId: 'A', timeMs: 0 });
  const lab = { pm: model, model: { ...buildLabModel().model, count: model.pixelCount } };
  return {
    sim, engine,
    hit(ev: { drumId?: string; zone?: string; note?: number }) {
      sim.hitEffects({ ...ev, velocity: 1 });
      engine.applyInput({ kind: ev.note !== undefined ? 'noteOn' : 'key', ...ev, velocity: 1, timeMs: sim.timeMs });
    },
    fire(effectId: string) {
      sim.fireEffect(effectId);
      engine.applyInput({ kind: 'fireEffect', effectId, velocity: 1, timeMs: sim.timeMs });
    },
    setModel(next: typeof model) {
      model = next;
      sim.pixelModel = next;
      engine.setModel(next);
      lab.pm = next;
      lab.model.count = next.pixelCount;
    },
    tick(dt: number) {
      sim.tick(dt);
      const bar = Math.floor(sim.beat / 4);
      engine.tick(sim.timeMs, dt, { timeMs: sim.timeMs, beat: sim.beat, bar, beatInBar: sim.beat - bar * 4, bpm: sim.bpm, beatsPerBar: 4, playing: true });
    },
    frames(): [Uint8Array, Uint8Array] {
      const actual = new Uint8Array(lab.pm.pixelCount * 3);
      renderFrame(actual, sim, lab);
      return [actual, rgb(engine.frame())];
    },
  };
}

describe('offline/core Effect-show parity', () => {
  it('zone + Always + Clock + Cue audition + Master match the engine byte-for-byte on every frame', () => {
    const p = effectPair(effectParityShow());
    const seen = new Set<string>();
    let clockFires = 0;
    for (let frame = 0; frame < 150; frame++) { // 2.4 s at 120 bpm: beats 1..4 cross
      if (frame === 5 || frame === 40 || frame === 41 || frame === 90) p.hit({ drumId: 'd0', zone: '0' });
      if (frame === 60) p.fire('cue');
      if (frame === 70) p.hit({ note: 60 });
      if (frame === 100) p.hit({ drumId: 'd1', zone: '0' }); // no Effect: a miss on both sides
      p.tick(16);
      if (p.sim.log[0]?.t === p.sim.timeMs && p.sim.log[0].resolved[0]?.startsWith('▶ Clock')) clockFires++;
      const [actual, expected] = p.frames();
      expect(actual, `frame ${frame}`).toEqual(expected);
      seen.add(actual.join(','));
    }
    expect(clockFires).toBe(4);
    expect(seen.size).toBeGreaterThan(20); // the content really moves; not a static / dark match
  });

  it('the Master chain is live in the parity show (removing it changes the frame)', () => {
    const withMaster = effectPair(effectParityShow(true));
    const without = effectPair(effectParityShow(false));
    for (const p of [withMaster, without]) for (let i = 0; i < 10; i++) p.tick(16);
    const [lit, reference] = [without.frames()[0], withMaster.frames()[0]];
    expect(lit.some((v) => v > 0)).toBe(true);
    expect(reference).not.toEqual(lit);
  });

  it('InputMappings resolve identically offline: a mapped note fires its cell, not its zone; a CC drives a live param', () => {
    const base = effectParityShow();
    const show: voice.Show = {
      ...base,
      mappings: [
        // note 36 arrives zone-claimed (d0 head) but is mapped to the Clock cell on d1
        { id: 'fire', source: { midiNote: 36 }, target: { kind: 'fireCell', cell: { row: 'd1', column: { kind: 'clock' } } } },
        // CC 21 runs the Always look's opacity live
        { id: 'fade', source: { midiCc: 21 }, target: { kind: 'opacity', effectId: 'always' } },
        // CC 22 is mapped, so it can never edge a Cue
        { id: 'mix', source: { midiCc: 22 }, target: { kind: 'modifierMix', effectId: 'zone', modifierUid: 'st' } },
      ],
    };
    const p = effectPair(show);
    const cc = (controller: number, value: number) => {
      p.sim.setCc(controller, value, null);
      p.engine.applyInput({ kind: 'cc', controller, value, timeMs: p.sim.timeMs });
    };
    const fired: string[] = [];
    const seen = new Set<string>();
    for (let frame = 0; frame < 80; frame++) {
      if (frame === 5) p.hit({ note: 36, drumId: 'd0', zone: '0' });
      if (frame === 10) p.hit({ drumId: 'd0', zone: '0' });
      if (frame === 20) cc(21, 0);
      if (frame === 30) cc(21, 90);
      if (frame === 40) cc(22, 20);
      p.tick(16);
      const top = p.sim.log[0];
      if (top?.t === p.sim.timeMs) fired.push(...top.resolved);
      const [actual, expected] = p.frames();
      expect(actual, `frame ${frame}`).toEqual(expected);
      seen.add(actual.join(','));
    }
    // The mapped note fired the Clock cell (an audition), never the zone Effect it is claimed by.
    expect(fired.filter((line) => line.startsWith('▶ Zone'))).toHaveLength(1); // frame 10's real hit only
    expect(fired.some((line) => line.startsWith('▶ Clock') && line.includes('audition'))).toBe(true);
    expect(seen.size).toBeGreaterThan(10);
  });

  it('Effect-show parity holds across a geometry revision', () => {
    const p = effectPair(effectParityShow());
    p.hit({ drumId: 'd0', zone: '0' });
    for (let i = 0; i < 5; i++) p.tick(16);
    p.setModel(runtimeModel([16, 48]));
    for (let frame = 0; frame < 20; frame++) {
      if (frame === 3) p.hit({ drumId: 'd0', zone: '0' });
      p.tick(16);
      const [actual, expected] = p.frames();
      expect(actual, `frame ${frame}`).toEqual(expected);
    }
  });
});
