import { describe, expect, it } from 'vitest';
import { parseKit } from '../geometry/kit-schema';
import { buildPixelModel, type PixelModel } from '../geometry/pixel-model';
import type { TransportState } from '../engine/render-context';
import { createVoiceBusEngine, type InputEvent } from './engine';
import { AUDIO_STALE_MS, type AudioFeatureFrame } from './audio-features';
import { nodeModSource, resolveNodeModulations } from './modulation-graph';
import { resolveModifierChain } from './modifier-graph';
import { sampleSource } from './modulation';
import { padKey, type Bus, type EffectDef, type GraphNode, type Show, type TriggerGraph } from './types';

/* Audio modulation (GH #214): an `audioFeatures` input event replaces the engine's audio table
   (stamped with the engine clock), and an `audio` source node reads one band of it per frame on
   every sampling path — effect params AND modifier params — until the frame goes stale, at which
   point it reads 0 without any further event. An audio event never fires a graph. */

// ---- graph resolution -------------------------------------------------------

describe('nodeModSource — audio', () => {
  it('audio node → { kind: "audio", band } and defaults to the broadband level', () => {
    expect(nodeModSource(node('audio', 'a1', { audioBand: 'bass' }))).toEqual({ kind: 'audio', band: 'bass' });
    expect(nodeModSource(node('audio', 'a1'))).toEqual({ kind: 'audio', band: 'level' });
  });

  it('resolves onto both carriers: an effect param mapping and a modifier link mapping', () => {
    const g = audioGraph('highs');
    const play = g.nodes.find((n) => n.id === 'pa')!;
    expect(resolveNodeModulations(g, play).map((m) => m.source)).toEqual([{ kind: 'audio', band: 'highs' }]);
    const chain = resolveModifierChain(g, play);
    expect(chain[0]?.modulations?.[0]).toMatchObject({ targetParam: 'hue', source: { kind: 'audio', band: 'highs' } });
  });

  it('sampleSource applies the freshness rule from the ctx clock (stale → 0, unheard band → 0)', () => {
    const audio = { frame: { level: 0.2, bass: 0.8, mids: 0, highs: 0 }, atMs: 100 };
    expect(sampleSource({ kind: 'audio', band: 'bass' }, { phase: 0, timeMs: 300, bpm: 120, audio })).toBeCloseTo(0.8, 10);
    expect(sampleSource({ kind: 'audio', band: 'mids' }, { phase: 0, timeMs: 300, bpm: 120, audio })).toBe(0);
    expect(sampleSource({ kind: 'audio', band: 'bass' }, { phase: 0, timeMs: 100 + AUDIO_STALE_MS + 1, bpm: 120, audio })).toBe(0);
    expect(sampleSource({ kind: 'audio', band: 'bass' }, { phase: 0, timeMs: 300, bpm: 120 })).toBe(0);
  });
});

// ---- engine fixtures --------------------------------------------------------

function testModel(): PixelModel {
  const kit = parseKit({
    global: { ledDensityPxPerM: 30, hoopCount: 2, defaultHoopSpacingMm: 50 },
    drums: [{ id: 'kick', diameterIn: 12, hoopSpacingMm: 50, origin: { x: 0, y: 0, z: 0 }, rotation: { x: 0, y: 0, z: 0 } }],
  });
  return buildPixelModel(kit);
}

function buses(): Bus[] {
  return [{ id: 'base', name: 'Base', polyphony: 'poly', crossfadeMs: 200 }];
}

/** A solid red, no-noise, static effect: brightness (base 0) is the effect-param probe and its
    pure red hue is the modifier-param probe (a hue-shift modifier turns it cyan). */
function fx(): EffectDef {
  return {
    id: 'fx',
    name: 'fx',
    generatorId: 'solid-base',
    busId: 'base',
    scope: 'kit',
    params: [
      { key: 'hue', label: 'Hue', kind: 'number', min: 0, max: 360, default: 0 },
      { key: 'saturation', label: 'Saturation', kind: 'number', min: 0, max: 1, default: 1 },
      { key: 'brightness', label: 'Brightness', kind: 'number', min: 0, max: 1, default: 1 },
      { key: 'speed', label: 'Speed', kind: 'number', min: 0, max: 4, default: 0 },
      { key: 'noise', label: 'Noise', kind: 'number', min: 0, max: 1, default: 0 },
    ],
    attackMs: 10,
    sustainMs: 100000,
    releaseMs: 100,
  };
}

function node(kind: GraphNode['kind'], id: string, over: Partial<GraphNode> = {}): GraphNode {
  return {
    id, kind, x: 0, y: 0, mode: 'oneshot', scope: 'kit', effectId: '', presetId: '', busId: '',
    params: {}, env: {}, noRepeat: true, on: 'value', valueMode: 'gate',
    threshold: 0.5, invert: false, bands: [0.5], p: 0.5, delayMode: 'time', ms: 0, division: '1/8', ...over,
  };
}

/** trigger → play(loop; brightness base 0, exposes brightness) ← audio(band) over [0,1];
    a hue-shift modifier on the play node exposes `hue`, also driven by the same audio node over
    [0,180] — so a full-scale band both lights the voice AND turns its red into cyan. */
function audioGraph(band: GraphNode['audioBand']): TriggerGraph {
  return {
    nodes: [
      node('trigger', 'trigger'),
      node('play', 'pa', {
        effectId: 'fx', mode: 'loop',
        params: { hue: 0, saturation: 1, brightness: 0, speed: 0, noise: 0 },
        modInputs: [{ param: 'brightness' }],
      }),
      node('modifier', 'm1', { modifierId: 'hue-shift', params: { hue: 0, mode: 'shift' }, modInputs: [{ param: 'hue' }] }),
      node('audio', 'a1', { audioBand: band }),
    ],
    edges: [
      { id: 'e0', from: 'trigger', to: 'pa' },
      { id: 'e1', from: 'm1', to: 'pa', toPort: 'mod' },
      { id: 'e2', from: 'a1', to: 'pa', toPort: 'param:brightness', amount: 1, invert: false, rangeMin: 0, rangeMax: 1 },
      { id: 'e3', from: 'a1', to: 'm1', toPort: 'param:hue', amount: 1, invert: false, rangeMin: 0, rangeMax: 180 },
    ],
  };
}

function show(graph: TriggerGraph): Show {
  return { buses: buses(), graphs: { [padKey('kick', '')]: graph }, sections: [], effects: [fx()], presets: [] };
}

function transport(now: number): TransportState {
  return { timeMs: now, beat: 0, bar: 0, beatInBar: 0, bpm: 120, beatsPerBar: 4, playing: true };
}

const hit = (timeMs: number): InputEvent => ({ kind: 'noteOn', drumId: 'kick', zone: '', velocity: 1, timeMs });
const audio = (frame: Partial<AudioFeatureFrame>, timeMs: number): InputEvent => ({
  kind: 'audioFeatures',
  audio: { level: 0, bass: 0, mids: 0, highs: 0, ...frame },
  timeMs,
});

/** Per-channel sums over the frame (alpha skipped). */
function channels(f: Readonly<Float32Array>): { r: number; g: number; b: number } {
  let r = 0, g = 0, b = 0;
  for (let i = 0; i < f.length; i += 4) {
    r += f[i]!;
    g += f[i + 1]!;
    b += f[i + 2]!;
  }
  return { r, g, b };
}
const lit = (f: Readonly<Float32Array>): number => { const c = channels(f); return c.r + c.g + c.b; };

function warm(band: GraphNode['audioBand'] = 'bass'): ReturnType<typeof createVoiceBusEngine> {
  const e = createVoiceBusEngine();
  e.setModel(testModel());
  e.setShow(show(audioGraph(band)));
  e.applyInput(hit(0));
  e.tick(5, 5, transport(5));
  e.tick(40, 35, transport(40));
  return e;
}

// ---- acceptance -------------------------------------------------------------

describe('VoiceBusEngine — audio modulation', () => {
  it('a queued audio frame drives a mapped EFFECT param on a live voice; the voice is dark before it', () => {
    const e = warm('bass');
    expect(lit(e.frame())).toBeCloseTo(0, 3);
    e.applyInput(audio({ bass: 1 }, 60));
    e.tick(60, 20, transport(60));
    expect(lit(e.frame())).toBeGreaterThan(0.5);
    // Dropping the band back to 0 dims the same live voice again — continuous, not one-shot.
    e.applyInput(audio({ bass: 0 }, 80));
    e.tick(80, 20, transport(80));
    expect(lit(e.frame())).toBeCloseTo(0, 3);
  });

  it('the same frame drives a mapped MODIFIER param (hue-shift turns the red voice cyan)', () => {
    const e = warm('bass');
    e.applyInput(audio({ bass: 0.001 }, 60)); // barely lit, hue-shift ≈ 0° → still red
    e.tick(60, 20, transport(60));
    const red = channels(e.frame());
    expect(red.r).toBeGreaterThan(red.g + red.b);
    e.applyInput(audio({ bass: 1 }, 80)); // full → hue shifted 180° → cyan (G+B, no R)
    e.tick(80, 20, transport(80));
    const cyan = channels(e.frame());
    expect(cyan.g + cyan.b).toBeGreaterThan(cyan.r * 4);
  });

  it('reads only its own band: energy in another band leaves the mapping at 0', () => {
    const e = warm('mids');
    e.applyInput(audio({ bass: 1, highs: 1, level: 1 }, 60));
    e.tick(60, 20, transport(60));
    expect(lit(e.frame())).toBeCloseTo(0, 3);
    e.applyInput(audio({ mids: 1 }, 80));
    e.tick(80, 20, transport(80));
    expect(lit(e.frame())).toBeGreaterThan(0.5);
  });

  it('goes stale to 0 after AUDIO_STALE_MS with NO further event (capture stop / tab crash / link loss)', () => {
    const e = warm('level');
    e.applyInput(audio({ level: 1 }, 60));
    e.tick(60, 20, transport(60));
    expect(lit(e.frame())).toBeGreaterThan(0.5);
    // Still fresh inside the window.
    e.tick(60 + AUDIO_STALE_MS, AUDIO_STALE_MS, transport(60 + AUDIO_STALE_MS));
    expect(lit(e.frame())).toBeGreaterThan(0.5);
    // One tick past the window: dark, and nothing was queued to make it so.
    e.tick(60 + AUDIO_STALE_MS + 16, 16, transport(60 + AUDIO_STALE_MS + 16));
    expect(lit(e.frame())).toBeCloseTo(0, 3);
  });

  it('an audio frame never fires a graph and never trips a routing diagnostic', () => {
    const diagnostics: string[] = [];
    const e = createVoiceBusEngine({ onDiagnostic: (d) => diagnostics.push(d.kind) });
    e.setModel(testModel());
    e.setShow(show(audioGraph('level')));
    e.applyInput(audio({ level: 1 }, 5));
    e.tick(5, 5, transport(5));
    e.tick(40, 35, transport(40));
    expect(lit(e.frame())).toBeCloseTo(0, 3); // no voice was spawned
    expect(e.stats().voiceCount).toBe(0);
    expect(diagnostics).toEqual([]);
  });

  it('normalises a malformed frame defensively (non-finite / out-of-range read as clamped)', () => {
    const e = warm('level');
    e.applyInput({ kind: 'audioFeatures', audio: { level: Number.NaN, bass: 3, mids: -1, highs: 0 }, timeMs: 60 });
    e.tick(60, 20, transport(60));
    expect(lit(e.frame())).toBeCloseTo(0, 3); // NaN level → 0
    for (const x of e.frame()) expect(Number.isFinite(x)).toBe(true);
  });

  it('setShow clears the audio table (no stale frame leaks into a fresh show)', () => {
    const e = warm('level');
    e.applyInput(audio({ level: 1 }, 45));
    e.tick(60, 15, transport(60));
    expect(lit(e.frame())).toBeGreaterThan(0.5);
    e.setShow(show(audioGraph('level')));
    e.applyInput(hit(70));
    e.tick(75, 5, transport(75));
    e.tick(110, 35, transport(110));
    expect(lit(e.frame())).toBeCloseTo(0, 3);
  });

  it('is deterministic: identical event logs produce byte-identical frames', () => {
    const events: InputEvent[] = [hit(0), audio({ bass: 0.2 }, 20), audio({ bass: 0.9 }, 55), audio({ bass: 0.5 }, 95), audio({ bass: 0 }, 130)];
    const run = (): number[] => {
      const e = createVoiceBusEngine();
      e.setModel(testModel());
      e.setShow(show(audioGraph('bass')));
      for (const ev of events) e.applyInput(ev);
      let now = 0;
      for (let i = 0; i < 20; i++) {
        now += 16;
        e.tick(now, 16, transport(now));
      }
      return Array.from(e.frame());
    };
    expect(run()).toEqual(run());
  });
});
