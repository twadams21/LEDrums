import { describe, expect, it, vi } from 'vitest';
import { getEffect, voice } from '@ledrums/core';
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
function rgb(frame: Readonly<Float32Array>) {
  return Uint8Array.from(Array.from({ length: frame.length / 4 * 3 }, (_, i) => Math.round(frame[Math.floor(i / 3) * 4 + i % 3]! * 255)));
}

describe('offline/core pixel replay parity', () => {
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
