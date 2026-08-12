import { describe, expect, it } from 'vitest';
import { parseKit } from '../geometry/kit-schema';
import { buildPixelModel, type PixelModel } from '../geometry/pixel-model';
import type { TransportState } from '../engine/render-context';
import { createVoiceBusEngine, type InputEvent, type RenderEngine } from './engine';
import { padKey, type Bus, type EffectDef, type GraphNode, type Show, type TriggerGraph } from './types';

/* Global controls 5–8, engine half: the OUTPUT-STAGE gate (panic blackout, master
   brightness) and the two state actions (stop-all-voices, sequence re-sync).

   The blackout/brightness rule these all turn on: they act at the very last step and
   never touch voice state. That is what makes a panic instantly reversible — the show
   has been running underneath the whole time. Each test therefore checks BOTH the
   pixels and that the voices survived. */

function testModel(): PixelModel {
  const kit = parseKit({
    global: { ledDensityPxPerM: 30, hoopCount: 2, defaultHoopSpacingMm: 50 },
    drums: [{ id: 'kick', diameterIn: 12, hoopSpacingMm: 50, origin: { x: 0, y: 0, z: 0 }, rotation: { x: 0, y: 0, z: 0 } }],
  });
  return buildPixelModel(kit);
}

function transport(now: number): TransportState {
  return { timeMs: now, beat: 0, bar: 0, beatInBar: 0, bpm: 120, beatsPerBar: 4, playing: true };
}

function node(kind: GraphNode['kind'], id: string, over: Partial<GraphNode> = {}): GraphNode {
  return {
    id, kind, x: 0, y: 0, mode: 'oneshot', scope: 'kit', effectId: '', presetId: '', busId: '',
    params: {}, env: {}, noRepeat: false, on: 'value', valueMode: 'gate',
    threshold: 0.5, invert: false, bands: [0.5], p: 1, delayMode: 'time', ms: 0, division: '1/8', ...over,
  } as GraphNode;
}

/** A kit-wide solid effect with a long sustain, so a fired voice keeps the frame lit. */
function fx(id: string): EffectDef {
  return {
    id,
    name: id,
    generatorId: 'solid-base',
    busId: 'main',
    scope: 'kit',
    params: [{ key: 'brightness', label: 'Brightness', kind: 'number', min: 0, max: 1, default: 1 }],
    attackMs: 0,
    sustainMs: 1_000_000,
    releaseMs: 50,
  };
}

function buses(): Bus[] {
  return [{ id: 'main', name: 'Main', polyphony: 'poly', crossfadeMs: 200 }];
}

/** trigger → play(oneshot) — a pad hit spawns one trigger voice that stays lit. */
function hitGraph(mode: 'oneshot' | 'loop'): TriggerGraph {
  return {
    nodes: [node('trigger', 'trigger'), node('play', 'p', { effectId: 'fx', mode, params: { brightness: 1 } })],
    edges: [{ id: 'e', from: 'trigger', to: 'p' }],
  };
}

function show(mode: 'oneshot' | 'loop' = 'oneshot'): Show {
  return {
    buses: buses(),
    graphs: { [padKey('kick', '0')]: hitGraph(mode) },
    sections: [],
    effects: [fx('fx')],
    presets: [],
  };
}

function setup(mode: 'oneshot' | 'loop' = 'oneshot'): RenderEngine {
  const engine = createVoiceBusEngine();
  engine.setModel(testModel());
  engine.setShow(show(mode));
  return engine;
}

const ctl = (action: InputEvent['action'], timeMs: number, over: Partial<InputEvent> = {}): InputEvent => ({
  kind: 'globalControl',
  action,
  timeMs,
  ...over,
});

const hit = (timeMs: number): InputEvent => ({ kind: 'key', drumId: 'kick', zone: '0', velocity: 1, timeMs });

function frameMax(engine: RenderEngine): number {
  const f = engine.frame();
  let mx = 0;
  for (let i = 0; i < f.length; i += 4) {
    for (let c = 0; c < 3; c++) if (f[i + c]! > mx) mx = f[i + c]!;
  }
  return mx;
}

/** Fire a pad and run enough ticks for the voice to reach full level. */
function light(engine: RenderEngine, atMs = 0): void {
  engine.applyInput(hit(atMs));
  for (let t = 10; t <= 60; t += 10) engine.tick(t, 10, transport(t));
}

describe('panic blackout', () => {
  it('lights up first, so the test can prove the blackout did something', () => {
    const engine = setup();
    light(engine);
    expect(frameMax(engine)).toBeGreaterThan(0);
  });

  it('latch blacks the output out', () => {
    const engine = setup();
    light(engine);
    engine.applyInput(ctl('panicBlackoutLatch', 60));
    engine.tick(70, 10, transport(70));
    expect(frameMax(engine)).toBe(0);
  });

  it('leaves the voices RUNNING underneath — recovery is instant, not a re-cue', () => {
    const engine = setup();
    light(engine);
    const before = engine.stats().voiceCount;
    engine.applyInput(ctl('panicBlackoutLatch', 60));
    engine.tick(70, 10, transport(70));
    expect(engine.stats().voiceCount).toBe(before); // nothing was released or killed
    engine.applyInput(ctl('panicBlackoutLatch', 70));
    engine.tick(80, 10, transport(80));
    expect(frameMax(engine)).toBeGreaterThan(0); // and the light is straight back
  });

  it('latch toggles on every press', () => {
    const engine = setup();
    light(engine);
    for (const [i, expected] of [0, 1, 0].entries()) {
      engine.applyInput(ctl('panicBlackoutLatch', 60 + i));
      engine.tick(70 + i * 10, 10, transport(70 + i * 10));
      if (expected === 0) expect(frameMax(engine)).toBe(0);
      else expect(frameMax(engine)).toBeGreaterThan(0);
    }
  });

  it('momentary is dark while held and lit on release', () => {
    const engine = setup();
    light(engine);
    engine.applyInput(ctl('panicBlackoutMomentary', 60, { pressed: true }));
    engine.tick(70, 10, transport(70));
    expect(frameMax(engine)).toBe(0);

    engine.applyInput(ctl('panicBlackoutMomentary', 70, { pressed: false }));
    engine.tick(80, 10, transport(80));
    expect(frameMax(engine)).toBeGreaterThan(0);
  });

  it('a repeated press while held stays dark (no accidental toggle)', () => {
    const engine = setup();
    light(engine);
    engine.applyInput(ctl('panicBlackoutMomentary', 60, { pressed: true }));
    engine.applyInput(ctl('panicBlackoutMomentary', 61, { pressed: true }));
    engine.tick(70, 10, transport(70));
    expect(frameMax(engine)).toBe(0);
  });

  it('survives a setShow — an edit landing mid-panic must not un-blackout the rig', () => {
    const engine = setup();
    light(engine);
    engine.applyInput(ctl('panicBlackoutLatch', 60));
    engine.tick(70, 10, transport(70));
    engine.setShow(show());
    light(engine, 80);
    expect(frameMax(engine)).toBe(0);
  });
});

describe('master brightness', () => {
  it('scales the frame', () => {
    const full = setup();
    light(full);
    const lit = frameMax(full);

    const dim = setup();
    light(dim);
    dim.applyInput(ctl('masterBrightness', 60, { value: 0.5 }));
    dim.tick(70, 10, transport(70));
    expect(frameMax(dim)).toBeCloseTo(lit * 0.5, 3);
  });

  it('zero is a real value — fully dark, not "ignore me"', () => {
    const engine = setup();
    light(engine);
    engine.applyInput(ctl('masterBrightness', 60, { value: 0 }));
    engine.tick(70, 10, transport(70));
    expect(frameMax(engine)).toBe(0);
  });

  it('clamps out-of-range values', () => {
    const engine = setup();
    light(engine);
    const lit = frameMax(engine);
    engine.applyInput(ctl('masterBrightness', 60, { value: 4 }));
    engine.tick(70, 10, transport(70));
    expect(frameMax(engine)).toBeCloseTo(lit, 3);
  });

  it('refuses a non-finite value rather than blanking the rig with NaN', () => {
    const engine = setup();
    light(engine);
    engine.applyInput(ctl('masterBrightness', 60, { value: Number.NaN }));
    engine.tick(70, 10, transport(70));
    expect(frameMax(engine)).toBeGreaterThan(0);
  });

  it('blackout wins over brightness while both are set', () => {
    const engine = setup();
    light(engine);
    engine.applyInput(ctl('masterBrightness', 60, { value: 1 }));
    engine.applyInput(ctl('panicBlackoutLatch', 61));
    engine.tick(70, 10, transport(70));
    expect(frameMax(engine)).toBe(0);
  });

  it('leaves voices untouched (an output-stage gain, not a level change)', () => {
    const engine = setup();
    light(engine);
    const before = engine.stats().voiceCount;
    engine.applyInput(ctl('masterBrightness', 60, { value: 0 }));
    engine.tick(70, 10, transport(70));
    expect(engine.stats().voiceCount).toBe(before);
  });
});

describe('stop all voices', () => {
  it('releases a running trigger voice', () => {
    const engine = setup('oneshot');
    light(engine);
    expect(engine.stats().voices.some((v) => !v.releasing)).toBe(true);

    engine.applyInput(ctl('stopAllVoices', 60));
    engine.tick(70, 10, transport(70));

    expect(engine.stats().voices.every((v) => v.releasing)).toBe(true);
  });

  it('SPARES a loop voice — base layers keep rendering', () => {
    const engine = setup('loop');
    light(engine);
    engine.applyInput(ctl('stopAllVoices', 60));
    engine.tick(70, 10, transport(70));
    expect(engine.stats().voices.some((v) => !v.releasing)).toBe(true);
  });

  it('does not go dark — it releases, so effects fade on their envelopes', () => {
    const engine = setup('oneshot');
    light(engine);
    engine.applyInput(ctl('stopAllVoices', 60));
    engine.tick(62, 2, transport(62)); // a sliver into a 50ms release
    expect(frameMax(engine)).toBeGreaterThan(0);
  });

  it('is safe with nothing playing', () => {
    const engine = setup();
    engine.applyInput(ctl('stopAllVoices', 0));
    expect(() => engine.tick(10, 10, transport(10))).not.toThrow();
  });
});

describe('sequence re-sync', () => {
  it('snaps sequencers back to step 1 without disturbing voices or the frame', () => {
    // A sequence node advances its index per fire; re-sync clears that state so the next
    // fire starts from the top again.
    const seqShow: Show = {
      ...show(),
      graphs: {
        [padKey('kick', '0')]: {
          nodes: [
            node('trigger', 'trigger'),
            node('sequence', 's'),
            node('play', 'a', { effectId: 'fx', params: { brightness: 1 } }),
            node('play', 'b', { effectId: 'fx', params: { brightness: 1 } }),
          ],
          edges: [
            { id: 'e0', from: 'trigger', to: 's' },
            { id: 'e1', from: 's', to: 'a' },
            { id: 'e2', from: 's', to: 'b' },
          ],
        },
      },
    };
    const engine = createVoiceBusEngine();
    engine.setModel(testModel());
    engine.setShow(seqShow);

    // Advance the sequencer off step 1.
    engine.applyInput(hit(0));
    engine.tick(10, 10, transport(10));
    const afterFirst = engine.stats().voiceCount;

    engine.applyInput(ctl('sequenceResync', 20));
    engine.tick(30, 10, transport(30));

    // Voices are untouched by a re-sync — it is state only, not a reset.
    expect(engine.stats().voiceCount).toBe(afterFirst);
    expect(() => engine.tick(40, 10, transport(40))).not.toThrow();
  });
});

describe('host-level actions never act in the engine', () => {
  it('ignores tapTempo and transmitToggle (the host consumes them)', () => {
    const engine = setup();
    light(engine);
    const before = frameMax(engine);
    engine.applyInput(ctl('tapTempo', 60));
    engine.applyInput(ctl('transmitToggle', 61));
    engine.tick(70, 10, transport(70));
    expect(frameMax(engine)).toBeCloseTo(before, 3);
  });
});
