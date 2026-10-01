/* Effect chains S02 §3 — per-Effect blend / opacity / composition order, at the engine seam:
   setModel → setShow (sections carrying `effects`) → applyInput → tick → frame. Splice and
   slice voices are driven at the compositor seam with pool-spawned voices, because the
   Splice / Slice generators reach the resolver through a sibling wave-2 piece. */
import { describe, expect, it } from 'vitest';
import { parseKit } from '../geometry/kit-schema';
import { buildPixelModel, type PixelModel } from '../geometry/pixel-model';
import { Framebuffer } from '../engine/framebuffer';
import type { TransportState } from '../engine/render-context';
import { parseEffect, type Effect, type EffectInput } from '../effect-chain/types';
import { createDefaultCompositor } from './compositor';
import { createVoiceBusEngine, type InputEvent, type RenderEngine } from './engine';
import { runtimeAction, runtimeFrame, runtimeModel, runtimeSplice, runtimeVoice } from './runtime-test-fixtures';
import { emptyShow, type Show, type SongSection, type SpliceConfig, type Voice } from './types';

const DRUMS = ['kick', 'snare', 'tom'] as const;

function model(): PixelModel {
  return buildPixelModel(parseKit({
    global: { ledDensityPxPerM: 30, hoopCount: 2, defaultHoopSpacingMm: 50 },
    drums: DRUMS.map((id, i) => ({
      id, diameterIn: 12, hoopSpacingMm: 50, origin: { x: i * 400, y: 0, z: 0 }, rotation: { x: 0, y: 0, z: 0 },
    })),
  }));
}

function transport(beat: number): TransportState {
  return { timeMs: 0, beat, bar: Math.floor(beat / 4), beatInBar: beat % 4, bpm: 120, beatsPerBar: 4, playing: true };
}

const ALWAYS = { row: 'kit', column: { kind: 'always' } } as const;
const CUE = { row: 'kit', column: { kind: 'cue' } } as const;
const KICK_ZONE = { row: 'kick', column: { kind: 'zone', slot: 0 } } as const;

/** A kit-wide solid-colour Cue Effect on MIDI note 1: a one-shot that holds level 1 (no
    attack, a long gate), so every Effect on the note lands at an exact, known level. (Always
    voices loop with a gentle breathing level, so they are kept for the identity golden.) */
function wash(id: string, color: string, over: Partial<EffectInput> = {}): Effect {
  return parseEffect({
    id, cell: CUE, trigger: { kind: 'cue', source: { midiNote: 1 } },
    generator: { kind: 'solid', style: 'solid', params: { color } },
    amp: { attackMs: 0, length: { ms: 5000 }, releaseMs: 0 },
    ...over,
  });
}

function showOf(...sections: SongSection[]): Show {
  return { ...emptyShow(), songs: [{ id: 'song', name: 'Song', sections }] };
}

function section(id: string, effects: Effect[]): SongSection {
  return { id, name: id, effects };
}

interface Harness {
  engine: RenderEngine;
  m: PixelModel;
  now: number;
  send(ev: Omit<InputEvent, 'timeMs'>, ms?: number): void;
  advance(ms: number): void;
}

function harness(show: Show): Harness {
  const engine = createVoiceBusEngine();
  const m = model();
  engine.setModel(m);
  engine.setShow(show);
  const h: Harness = {
    engine, m, now: 0,
    send(ev, ms = 20) {
      engine.applyInput({ ...ev, timeMs: h.now } as InputEvent);
      h.advance(ms);
    },
    advance(ms) {
      const end = h.now + ms;
      do {
        engine.tick(h.now, 10, transport((h.now / 500) % 64));
        if (h.now >= end) break;
        h.now = Math.min(end, h.now + 10);
      } while (true);
    },
  };
  h.engine.tick(0, 0, transport(0));
  return h;
}

const recall = (sectionId: string): Omit<InputEvent, 'timeMs'> => ({ kind: 'recallSection', songId: 'song', sectionId });
/** Fires every `wash` in the section at once. */
const washNote: Omit<InputEvent, 'timeMs'> = { kind: 'noteOn', note: 1, velocity: 1 };
const kickHit = (velocity = 1): Omit<InputEvent, 'timeMs'> => ({ kind: 'noteOn', drumId: 'kick', zone: '0', velocity });

/** RGB of the first pixel of a drum. */
function rgbOf(h: Harness, drumId: string): [number, number, number] {
  const f = h.engine.frame();
  const j = h.m.drumById.get(drumId)!.pixelStart * 4;
  return [f[j]!, f[j + 1]!, f[j + 2]!];
}

/** FNV-1a over the frame's raw float bytes — bit-exact identity. */
function hashFrame(frame: Readonly<Float32Array>, seed = 0x811c9dc5): number {
  const bytes = new Uint8Array(frame.buffer, frame.byteOffset, frame.byteLength);
  let h = seed >>> 0;
  for (let i = 0; i < bytes.length; i++) h = Math.imul(h ^ bytes[i]!, 0x01000193) >>> 0;
  return h;
}

describe('compositor blend — `add` at opacity 1 is the old additive composite', () => {
  /** Overlapping default-blend Effects of several kinds: an Always wash, stacked radial hits,
      a chase and a whole-drum on the snare. Every frame over 1.5 s is hashed in order. */
  function goldenRun(extra: Partial<EffectInput>): number {
    const effects = [
      parseEffect({ id: 'base', cell: ALWAYS, generator: { kind: 'solid', style: 'solid', params: { color: '#203a80' } }, amp: { attackMs: 0, length: 'loop', releaseMs: 0 }, ...extra }),
      parseEffect({ id: 'rad', cell: KICK_ZONE, generator: { kind: 'wave', style: 'radial', params: { color: '#ff8020' } }, amp: { attackMs: 5, length: { ms: 400 }, releaseMs: 120 }, ...extra }),
      parseEffect({ id: 'chase', cell: { row: 'kit', column: { kind: 'cue' } }, trigger: { kind: 'cue', source: { midiNote: 9 } }, generator: { kind: 'wave', style: 'chase' }, amp: { attackMs: 0, length: { ms: 900 }, releaseMs: 200 }, ...extra }),
      parseEffect({ id: 'snare', cell: { row: 'snare', column: { kind: 'zone', slot: 0 } }, generator: { kind: 'solid', style: 'simple' }, amp: { attackMs: 0, length: { ms: 300 }, releaseMs: 100 }, ...extra }),
    ];
    const h = harness(showOf(section('s', effects)));
    let hash = 0x811c9dc5;
    const step = (ms: number): void => {
      h.advance(ms);
      hash = hashFrame(h.engine.frame(), hash);
    };
    h.send(recall('s'), 30);
    h.send(kickHit(0.8), 40);
    h.send({ kind: 'noteOn', note: 9, velocity: 1 }, 30);
    h.send(kickHit(1), 20);
    h.send({ kind: 'noteOn', drumId: 'snare', zone: '0', velocity: 0.6 }, 10);
    for (let i = 0; i < 70; i++) step(20);
    return hash;
  }

  // Captured from the pre-S02 compositor (base 83c292d6), where blend/opacity were inert.
  const PRE_CHANGE_HASH = 1846841510;

  it('default blend/opacity renders bit-identically to the pre-change compositor', () => {
    expect(goldenRun({})).toBe(PRE_CHANGE_HASH);
  });

  it('explicit `add` at opacity 1 renders bit-identically to the pre-change compositor', () => {
    expect(goldenRun({ blend: 'add', opacity: 1 })).toBe(PRE_CHANGE_HASH);
  });
});

describe('compositor blend — opacity and blend modes', () => {
  it('`add` at opacity 0.5 lands half the colour', () => {
    const h = harness(showOf(section('s', [wash('w', '#ffffff', { opacity: 0.5 })])));
    h.send(washNote, 30);
    const [r, g, b] = rgbOf(h, 'kick');
    expect(r).toBeCloseTo(0.5, 6);
    expect(g).toBeCloseTo(0.5, 6);
    expect(b).toBeCloseTo(0.5, 6);
  });

  it('opacity 0 contributes nothing', () => {
    const h = harness(showOf(section('s', [wash('w', '#ffffff', { opacity: 0 })])));
    h.send(washNote, 30);
    expect(rgbOf(h, 'kick')).toEqual([0, 0, 0]);
  });

  it('`multiply` over a wash darkens it by the layer colour', () => {
    const h = harness(showOf(section('s', [
      wash('under', '#ffffff'),
      wash('mul', '#808080', { blend: 'multiply' }),
    ])));
    h.send(washNote, 30);
    const half = 0x80 / 255;
    const [r, g, b] = rgbOf(h, 'kick');
    expect(r).toBeCloseTo(half, 5);
    expect(g).toBeCloseTo(half, 5);
    expect(b).toBeCloseTo(half, 5);
  });

  it('two stacked `normal` Effects at opacity 0.5 give the documented composite', () => {
    // Over black: red at 0.5 → (0.5, 0, 0); blue at 0.5 over that → (0.25, 0, 0.5).
    const h = harness(showOf(section('s', [
      wash('red', '#ff0000', { blend: 'normal', opacity: 0.5 }),
      wash('blue', '#0000ff', { blend: 'normal', opacity: 0.5 }),
    ])));
    h.send(washNote, 30);
    const [r, g, b] = rgbOf(h, 'kick');
    expect(r).toBeCloseTo(0.25, 6);
    expect(g).toBe(0);
    expect(b).toBeCloseTo(0.5, 6);
  });

  it('section order (`layerOrder`) decides which Effect is on top', () => {
    const red = wash('red', '#ff0000', { blend: 'normal', opacity: 0.5 });
    const blue = wash('blue', '#0000ff', { blend: 'normal', opacity: 0.5 });
    const h = harness(showOf(section('s', [blue, red])));
    h.send(washNote, 30);
    const [r, g, b] = rgbOf(h, 'kick');
    expect(r).toBeCloseTo(0.5, 6);
    expect(g).toBe(0);
    expect(b).toBeCloseTo(0.25, 6);
  });

  it('a `normal` Effect at opacity 1 on top replaces an additive Effect beneath it', () => {
    const h = harness(showOf(section('s', [
      wash('under', '#ff0000'),
      wash('top', '#00ff00', { blend: 'normal' }),
    ])));
    h.send(washNote, 30);
    expect(rgbOf(h, 'kick')).toEqual([0, 1, 0]);
  });

  it('the voice envelope rides the layer opacity: a releasing `normal` voice fades back to what is beneath', () => {
    const h = harness(showOf(section('s', [
      wash('under', '#ff0000'),
      parseEffect({
        id: 'flash', cell: KICK_ZONE, blend: 'normal',
        generator: { kind: 'solid', style: 'solid', params: { color: '#0000ff' } },
        amp: { attackMs: 0, length: { ms: 100 }, releaseMs: 200 },
      }),
    ])));
    h.send(washNote, 30);
    h.send(kickHit(1), 50);
    expect(rgbOf(h, 'kick')).toEqual([0, 0, 1]); // fully on top mid-gate
    h.advance(150); // 100 ms into the 200 ms release: level 0.5
    const [r, , b] = rgbOf(h, 'kick');
    expect(r).toBeCloseTo(0.5, 2); // the wash shows back through, not darkened to black
    expect(b).toBeCloseTo(0.5, 2);
    expect(r + b).toBeCloseTo(1, 5);
  });

  it('voices of one Effect stack by spawn order, not by pool slot', () => {
    // A short snare flash takes slot 0; kick voice A (bright) takes slot 1; the flash dies and
    // kick voice B (dim) reuses slot 0. Slab order is [B, A], spawn order [A, B]: B is on top.
    const kick = parseEffect({
      id: 'k', cell: KICK_ZONE, blend: 'normal', retrigger: 'overlap',
      generator: { kind: 'solid', style: 'solid', params: { color: '#ffffff' } },
      amp: { attackMs: 0, length: { ms: 3000 }, releaseMs: 0 },
      controls: [{ uid: 'vel', kind: 'velocity', mappings: [{ device: 'generator', param: 'brightness' }] }],
    });
    const flash = parseEffect({
      id: 'f', cell: { row: 'snare', column: { kind: 'zone', slot: 0 } },
      generator: { kind: 'solid', style: 'solid' },
      amp: { attackMs: 0, length: { ms: 10 }, releaseMs: 0 },
    });
    const h = harness(showOf(section('s', [kick, flash])));
    h.send({ kind: 'noteOn', drumId: 'snare', zone: '0', velocity: 1 }, 10);
    h.send(kickHit(1), 200);
    expect(h.engine.stats().voiceCount).toBe(1); // the flash is reaped; slot 0 is free
    h.send(kickHit(0.3), 30);
    expect(h.engine.stats().voiceCount).toBe(2);
    expect(rgbOf(h, 'kick')[0]).toBeCloseTo(0.3, 3);
  });
});

describe('compositor blend — splice and slice voices honour blend and opacity at their landing', () => {
  const m = runtimeModel([8, 8]);

  /** A two-slot splice (or slice, with `space`) whose one member is a solid colour. */
  function composite(over: Partial<Voice>, space?: SpliceConfig['space']): Voice {
    const member = { ...runtimeAction({ params: { color: '#ffffff', brightness: 0.8 } }), opacity: 1, originNodeId: 'member' };
    const action = runtimeAction({
      params: {},
      spliceInputs: [member],
      splice: { ...runtimeSplice(), ...(space ? { space } : {}) },
    });
    return runtimeVoice(over, action, 'solid-colour');
  }

  function render(voices: Voice[]): Float32Array {
    const dst = new Framebuffer(m.pixelCount);
    createDefaultCompositor().render(voices, m, runtimeFrame(100, 16), dst);
    return Float32Array.from(dst.rgba);
  }

  const SPACE: SpliceConfig['space'] = { direction: { x: 1, y: 0, z: 0 }, velocity: 0, incrementFrac: 0.1 };

  for (const [label, space] of [['splice', undefined], ['slice', SPACE]] as const) {
    it(`${label}: opacity 0.5 lands exactly half of the opacity-1 frame`, () => {
      const full = render([composite({}, space)]);
      const half = render([composite({ layerOrder: 0, opacity: 0.5 }, space)]);
      expect(full.some((x, i) => i % 4 === 0 && x > 0)).toBe(true); // the composite is lit
      for (let i = 0; i < full.length; i += 4) {
        for (let c = 0; c < 3; c++) expect(half[i + c]).toBeCloseTo(full[i + c]! * 0.5, 6);
      }
    });

    it(`${label}: \`multiply\` over a solid wash darkens the wash by the composite`, () => {
      // Live params are the engine's job (`applyEffectiveParams`); set them directly here.
      const under = runtimeVoice({ layerOrder: 0, liveParams: { color: '#ffffff', brightness: 0.5 } }, runtimeAction(), 'solid-colour');
      const top = composite({ layerOrder: 1, blend: 'multiply' }, space);
      const alone = render([composite({}, space)]);
      const out = render([under, top]);
      for (let i = 0; i < out.length; i += 4) {
        // Lit composite pixels scale the wash; transparent ones leave it untouched.
        const expected = alone[i + 3]! > 0 ? 0.5 * alone[i]! : 0.5;
        expect(out[i]).toBeCloseTo(expected, 5);
      }
    });
  }
});
