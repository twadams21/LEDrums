import { describe, expect, it, vi } from 'vitest';
import { getEffect, registerCanvasScene, unregisterCanvasScene, voice, type CanvasScene } from '@ledrums/core';
import { runtimeBus, runtimeEffect, runtimeFrame, runtimeHoopModel, runtimeModel } from '../../../../../packages/core/src/voice/runtime-test-fixtures';
import { Sim, makeNode, type GraphNode, type TriggerGraph } from './sim';
import { buildLabModel } from './kit';
import { renderFrame } from './render';

const ctx = { velocity: 1, sourceDrumId: 'd0', sectionIndex: 0, sectionCount: 0, beatPhase: 0, bpm: 120 };
function graph(composite: 'mix' | 'splice' | 'ordinary', mods: Array<[string, Record<string, number>]> = [], toggle = false): TriggerGraph {
  const nodes: GraphNode[] = [makeNode('trigger', 'trigger', 0, 0, { source: { kind: 'drum', drumId: 'd0', zone: '0' } }), makeNode('output', 'output', 800, 0)];
  const links: Array<[string, string]> = [];
  const start = toggle ? 'toggle' : 'trigger';
  if (toggle) { nodes.push(makeNode('toggle', 'toggle', 100, 0)); links.push(['trigger', 'toggle']); }
  if (composite === 'splice') {
    nodes.push(makeNode('splice', 'producer', 200, 0, { busId: 'b', mode: 'loop', scope: 'kit', spliceCount: 2,
      splices: [{ effectId: 'fx' }, { color: '#1459cd' }], spliceMotionMode: 'latched', spliceChase: 'step', spliceRateMode: 'time', spliceRateMs: 32 }));
    links.push([start, 'producer']);
  } else {
    nodes.push(makeNode('effect', 'fx', 200, 0, { effectId: 'fx', busId: 'b', mode: 'loop', scope: 'kit', params: { brightness: 0.25, addPerHit: 12 } }));
    links.push([start, 'fx']);
    if (composite === 'mix') {
      nodes.push(makeNode('mix', 'producer', 400, 0));
      links.push(['fx', 'producer']);
    }
  }
  let tail = composite === 'ordinary' ? 'fx' : 'producer';
  for (const [i, [modifierId, params]] of mods.entries()) {
    const id = `mod${i}`;
    nodes.push(makeNode('modifier', id, 500 + i * 50, 0, { modifierId, params }));
    links.push([tail, id]); tail = id;
  }
  links.push([tail, 'output']);
  return { version: 3, nodes, edges: links.map(([from, to], i) => ({ id: `e${i}`, from, to })) };
}
function pair(g: TriggerGraph) {
  const model = runtimeHoopModel(4, 32);
  const sim = new Sim([runtimeBus], [runtimeEffect()], []);
  sim.pixelModel = model;
  const engine = voice.createVoiceBusEngine();
  engine.setModel(model);
  engine.setShow({ buses: [runtimeBus], effects: [runtimeEffect()], presets: [], sections: [], graphs: { test: g } });
  const lab = { pm: model, model: { ...buildLabModel().model, count: model.pixelCount } };
  const hit = () => {
    sim.triggerGraph('test', g, ctx, 'test');
    engine.applyInput({ kind: 'fireGraph', graphKey: 'test', velocity: 1, timeMs: sim.timeMs });
  };
  const tick = (dt: number) => {
    sim.tick(dt);
    engine.tick(sim.timeMs, dt, runtimeFrame(sim.timeMs, dt).transport);
  };
  return { sim, engine, lab, hit, tick };
}
function inputSim(source: 'cc' | 'note' | 'osc' = 'cc', generatorId = 'solid-colour') {
  const model = runtimeHoopModel(4, 64);
  const effect = runtimeEffect(generatorId);
  effect.params = [{ key: 'brightness', label: 'Brightness', kind: 'number', default: 0, min: 0, max: 1 }];
  const sim = new Sim([runtimeBus], [effect], []);
  const g = graph('ordinary');
  g.nodes.find((n) => n.id === 'fx')!.params = { brightness: 0 };
  g.nodes.push(makeNode(source, 'input', 0, 200, { ccController: 1, noteNumber: 60, noteMode: 'gate', noteReleaseMs: 0, oscAddress: '/level' }));
  g.edges.push({ id: 'mod', from: 'input', to: 'fx', toPort: 'param:brightness', rangeMin: 0, rangeMax: 0.8 });
  sim.pixelModel = model;
  sim.triggerGraph('test', g, ctx);
  sim.tick(16);
  return { sim, model, g, effect };
}

function rgb(frame: Readonly<Float32Array>) {
  return Uint8Array.from(Array.from({ length: frame.length / 4 * 3 }, (_, i) => Math.round(frame[Math.floor(i / 3) * 4 + i % 3]! * 255)));
}

describe('offline/core pixel replay parity', () => {
  it('CC1 repaints Solid brightness 0 → 0.8 without a tick', () => {
    const { sim, model } = inputSim();
    sim.setCc(1, 0, null);
    expect(rgb(sim.render(model))[0]).toBe(0);
    sim.setCc(1, 127, null);
    expect(rgb(sim.render(model))[0]).toBe(204);
  });
  it('OSC and note-on/off repaint without a tick, including public table writes', () => {
    for (const kind of ['osc', 'note'] as const) {
      const { sim, model } = inputSim(kind);
      expect(rgb(sim.render(model))[0]).toBe(0);
      if (kind === 'osc') sim.setOsc('/level', 1);
      else sim.setNote(60, 127, 3, true);
      expect(rgb(sim.render(model))[0]).toBe(204);
      if (kind === 'osc') sim.oscTable.set('/level', 0);
      else sim.setNote(60, 0, 3, false);
      expect(rgb(sim.render(model))[0]).toBe(0);
      expect(sim.timeMs).toBe(16);
    }
    const { sim, model } = inputSim();
    sim.render(model);
    sim.ccTable.set(voice.ccKey(1, null), 1);
    expect(rgb(sim.render(model))[0]).toBe(204);
  });

  it('BPM and time signature refresh transport without changing the tick dt or beat', () => {
    const { sim, model } = inputSim('cc', 'segments');
    sim.setCc(1, 127, null);
    sim.tick(250);
    sim.render(model);
    const beat = sim.beat;
    const spy = vi.spyOn(getEffect('segments'), 'render');
    try {
      sim.bpm = 180;
      sim.render(model);
      expect(spy).toHaveBeenCalledTimes(1);
      expect(spy.mock.calls[0]![0].transport.bpm).toBe(180);
      expect(spy.mock.calls[0]![0].dt).toBe(250);
      sim.beatsPerBar = 3;
      sim.render(model);
      expect(spy).toHaveBeenCalledTimes(2);
      expect(spy.mock.calls[1]![0].transport.beatsPerBar).toBe(3);
      expect(sim.beat).toBe(beat);
      expect(sim.timeMs).toBe(266);
      // Assigning unchanged transport/input values is a clean repaint, not a noise step.
      sim.bpm = 180; sim.beatsPerBar = 3; sim.setCc(1, 127, null);
      sim.render(model);
      expect(spy).toHaveBeenCalledTimes(2);
    } finally { spy.mockRestore(); }
  });

  for (const shape of ['ordinary', 'mix', 'splice'] as const) {
    for (const generatorId of ['pixel-accum', 'confetti-burst', 'sacred-hogs']) {
      for (const modifier of ['echo', 'feedback', 'grain', 'sparkle', 'flicker']) {
        it(`${shape}/${generatorId}/${modifier}: dirty paused input and resume equal final-input-only replay`, () => {
          // Modulation precedes history/noise so even invisible transient inputs would
          // contaminate later frames if the presentation mutated the prior candidate.
          const g = graph(shape, [['levels', { brightness: 0 }], [modifier, { delayMs: 32, density: 12 }]]);
          g.nodes.push(makeNode('cc', 'cc', 0, 200, { ccController: 1 }));
          g.edges.push({ id: 'cc-mod', from: 'cc', to: 'mod0', toPort: 'param:brightness', rangeMin: 0, rangeMax: 0.8 });
          const model = runtimeHoopModel(4, 64);
          const make = () => {
            const sim = new Sim([runtimeBus], [runtimeEffect(generatorId)], []);
            sim.pixelModel = model;
            sim.triggerGraph('test', g, ctx);
            return sim;
          };
          const actual = make(); const expected = make();
          for (let tick = 0; tick < 10; tick++) {
            actual.tick(16); expected.tick(16);
            if (tick >= 2 && tick <= 5) {
              for (const input of [0, 127, 31, 99, 0, 127]) {
                actual.setCc(1, input, null);
                const frame = actual.render(model).slice();
                expect(actual.render(model)).toEqual(frame);
              }
            }
            actual.setCc(1, 100, null); expected.setCc(1, 100, null);
            expect(actual.render(model), `tick ${tick}`).toEqual(expected.render(model));
          }
        });
      }
    }
  }

  for (const shape of ['ordinary', 'mix', 'splice'] as const) {
    it(`${shape}: paused canvas upsert/removal/re-registration uses live adapter and sampler`, () => {
      const scene: CanvasScene = { id: `runtime-paused-${shape}`, name: 'Paused', sampler: { kind: 'strip' },
        elements: [{ kind: 'gradient', angleDeg: 0, stops: [{ at: 0, hue: 0, sat: 1, v: 1 }, { at: 1, hue: 120, sat: 1, v: 1 }] }] };
      const model = runtimeHoopModel(4, 64);
      const g = graph(shape);
      const make = () => {
        const sim = new Sim([runtimeBus], [runtimeEffect(`canvas:${scene.id}`)], []);
        sim.triggerGraph('test', g, ctx); sim.tick(16);
        return sim;
      };
      registerCanvasScene(scene);
      try {
        const sim = make();
        const before = sim.render(model).slice();
        // Change placement, not just colour: retaining the old adapter's sampler fails.
        const replacement: CanvasScene = { ...scene, sampler: { kind: 'cylinder', region: { u0: 0, v0: 0, u1: 0.3, v1: 1 } } };
        registerCanvasScene(replacement);
        const after = sim.render(model).slice();
        expect(after).not.toEqual(before);
        expect(after).toEqual(make().render(model));
        unregisterCanvasScene(scene.id);
        const removed = sim.render(model).slice();
        expect(removed).not.toEqual(after); // Splice may retain its independent colour slot.
        registerCanvasScene(replacement);
        expect(sim.render(model)).toEqual(after);
        sim.tick(16);
        const reference = make(); reference.tick(16);
        expect(sim.render(model)).toEqual(reference.render(model));
      } finally { unregisterCanvasScene(scene.id); }
    });
  }

  it('an immediate paused hit preserves old-voice history and leaves the new voice dark until tick', () => {
    const actual = inputSim('cc', 'sacred-hogs');
    const expected = inputSim('cc', 'sacred-hogs');
    for (const p of [actual, expected]) {
      p.sim.setCc(1, 127, null);
      p.sim.render(p.model);
      p.sim.tick(16);
      p.sim.render(p.model);
    }
    const before = actual.sim.render(actual.model).slice();
    for (const p of [actual, expected]) p.sim.triggerGraph('test', p.g, ctx);
    expect(actual.sim.voices[1]!.level).toBe(0);
    expect(actual.sim.render(actual.model)).toEqual(before);
    for (let i = 0; i < 5; i++) {
      actual.sim.tick(16); expected.sim.tick(16);
      expect(actual.sim.render(actual.model)).toEqual(expected.sim.render(expected.model));
    }
  });

  it('effect/preset upserts keep existing spawn snapshots and do not advance a paused noise voice', () => {
    const { sim, model, effect } = inputSim('cc', 'sacred-hogs');
    sim.setCc(1, 127, null);
    const before = sim.render(model).slice();
    const spy = vi.spyOn(getEffect('sacred-hogs'), 'render');
    try {
      sim.registerEffect({ ...effect, name: 'Renamed', generatorId: 'solid-colour' });
      sim.registerPreset({ id: 'p', name: 'P', effectId: effect.id, params: { brightness: 0 } });
      sim.unregisterPreset('p');
      expect(sim.render(model)).toEqual(before);
      expect(spy).not.toHaveBeenCalled();
      expect(sim.voices[0]!.generatorId).toBe('sacred-hogs');
    } finally { spy.mockRestore(); }
  });

  it('repainting a paused tick does not render generators or advance temporal history again', () => {
    const p = pair(graph('ordinary', [['echo', { delayMs: 32 }]]));
    p.hit(); p.tick(16);
    const spy = vi.spyOn(getEffect('pixel-accum'), 'render');
    try {
      const buf = new Uint8Array(p.lab.pm.pixelCount * 3);
      renderFrame(buf, p.sim, p.lab);
      const first = buf.slice();
      for (let i = 0; i < 20; i++) {
        renderFrame(buf, p.sim, p.lab);
        expect(buf).toEqual(first);
      }
      expect(spy).toHaveBeenCalledTimes(1);
    } finally { spy.mockRestore(); }
  });
  for (const composite of ['mix', 'splice'] as const) {
    for (const mods of [
      [['levels', { brightness: 0 }]],
      [['slide', { offset: 3 }]],
      [['echo', { delayMs: 32, decay: 0.5 }]],
      [['slide', { offset: 3 }], ['feedback', { amount: 0.5, shift: 1 }], ['levels', { brightness: 0.5 }]],
    ] satisfies Array<Array<[string, Record<string, number>]>>) {
      it(`${composite} → ${mods.map(([id]) => id).join(' → ')} matches bytes on every frame`, () => {
        const p = pair(graph(composite, mods));
        p.hit();
        for (let t = 0; t <= 160; t += 16) {
          p.tick(t === 0 ? 0 : 16);
          const actual = new Uint8Array(p.lab.pm.pixelCount * 3);
          renderFrame(actual, p.sim, p.lab);
          expect(actual, `time ${t}`).toEqual(rgb(p.engine.frame()));
        }
      });
    }
  }
  for (const composite of ['mix', 'splice'] as const) for (const temporal of ['feedback', 'echo']) {
    it(`${composite}/${temporal} stays finite and byte-identical across geometry revisions`, () => {
      const p = pair(graph(composite, [[temporal, { delayMs: 32 }]]));
      p.hit(); p.tick(0);
      renderFrame(new Uint8Array(p.lab.pm.pixelCount * 3), p.sim, p.lab);
      for (const model of [runtimeModel([32, 32]), runtimeModel([4, 4]), runtimeModel([4, 4], true)]) {
        p.engine.setModel(model);
        p.sim.pixelModel = model;
        p.lab.pm = model;
        p.lab.model.count = model.pixelCount;
        p.tick(16);
        expect([...p.sim.render(model)].every(Number.isFinite)).toBe(true);
        const actual = new Uint8Array(model.pixelCount * 3);
        renderFrame(actual, p.sim, p.lab);
        expect(actual).toEqual(rgb(p.engine.frame()));
      }
    });
  }
  it('latched splice motion agrees across release, a dark gap and a second hit', () => {
    const g = graph('splice');
    Object.assign(g.nodes.find((n) => n.id === 'producer')!, {
      mode: 'oneshot', spliceAttackMs: 0, spliceHoldMs: 32, spliceReleaseMs: 64,
    });
    const p = pair(g);
    p.hit();
    for (let t = 0; t <= 512; t += 16) {
      if (t === 320) {
        p.hit(); p.tick(0); // both adapters receive the hit at the same clock instant
        const onHit = new Uint8Array(p.lab.pm.pixelCount * 3);
        renderFrame(onHit, p.sim, p.lab);
        expect(onHit).toEqual(rgb(p.engine.frame()));
      }
      p.tick(t === 0 ? 0 : 16);
      const actual = new Uint8Array(p.lab.pm.pixelCount * 3);
      renderFrame(actual, p.sim, p.lab);
      expect(actual, `time ${t}`).toEqual(rgb(p.engine.frame()));
      if (t === 256) expect(p.sim.voices).toHaveLength(0);
    }
  });
  it('1,025 poly loop hits stay at 256 with the core deterministic steal order', () => {
    const p = pair(graph('ordinary'));
    for (let i = 0; i < 1025; i++) { p.hit(); p.tick(0); }
    expect(p.sim.voices).toHaveLength(256);
    expect(p.sim.voices.map((v) => v.id)).toEqual(p.engine.stats().voices.map((v) => v.id));
    expect(p.sim.voices.map((v) => v.seed)).toEqual(pairReplaySeeds());
  });
  it('a stolen toggle latch re-fires rather than stopping an unrelated reused slot', () => {
    const toggled = graph('ordinary', [], true);
    const p = pair(toggled);
    p.hit(); p.tick(0);
    const plain = graph('ordinary');
    for (let i = 0; i < 1025; i++) p.sim.triggerGraph('filler', plain, ctx, 'filler');
    p.sim.triggerGraph('test', toggled, ctx, 'test');
    expect(p.sim.voices).toHaveLength(256);
    expect(p.sim.voices.some((v) => v.id === 'v1027' && v.phase !== 'release')).toBe(true);
    p.sim.triggerGraph('test', toggled, ctx, 'test');
    expect(p.sim.voices.find((v) => v.id === 'v1027')?.phase).toBe('release');
  });
});
function pairReplaySeeds() {
  const p = pair(graph('ordinary'));
  for (let i = 0; i < 1025; i++) { p.hit(); p.tick(0); }
  return p.sim.voices.map((v) => v.seed);
}
