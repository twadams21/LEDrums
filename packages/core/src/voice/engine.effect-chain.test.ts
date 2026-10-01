/* Effect chains S01 — the Effect path at the engine seam:
   setModel → setShow (sections carrying `effects`) → applyInput → tick → frame.
   Every show here has EMPTY buses / effects / presets: the Effect path must play without them. */
import { describe, expect, it } from 'vitest';
import { parseKit } from '../geometry/kit-schema';
import { buildPixelModel, getHoopPixelRange, type PixelModel } from '../geometry/pixel-model';
import type { TransportState } from '../engine/render-context';
import { parseEffect, type Effect, type EffectInput } from '../effect-chain/types';
import { createVoiceBusEngine, type InputEvent, type RenderEngine } from './engine';
import type { VoiceDiagnostic } from './diagnostics';
import { emptyShow, type Show, type SongSection } from './types';

const DRUMS = ['kick', 'snare', 'tom'] as const;

function model(): PixelModel {
  return buildPixelModel(parseKit({
    global: { ledDensityPxPerM: 30, hoopCount: 2, defaultHoopSpacingMm: 50 },
    drums: DRUMS.map((id, i) => ({
      id, diameterIn: 12, hoopSpacingMm: 50, origin: { x: i * 400, y: 0, z: 0 }, rotation: { x: 0, y: 0, z: 0 },
    })),
  }));
}

function transport(beat: number, bpm = 120): TransportState {
  return { timeMs: 0, beat, bar: Math.floor(beat / 4), beatInBar: beat % 4, bpm, beatsPerBar: 4, playing: true };
}

/** A solid-colour Effect: fast attack, long gate, so a frame shortly after the fire is lit. */
function solid(over: Partial<EffectInput> & Pick<EffectInput, 'id' | 'cell'>, color = '#ffffff'): Effect {
  return parseEffect({
    generator: { kind: 'solid', style: 'solid', params: { color } },
    amp: { attackMs: 0, length: { ms: 2000 }, releaseMs: 100 },
    ...over,
  });
}

function section(id: string, effects: Effect[] | undefined): SongSection {
  return { id, name: id, slots: {}, ...(effects ? { effects } : {}) };
}

function showOf(...sections: SongSection[]): Show {
  return { ...emptyShow(), songs: [{ id: 'song', name: 'Song', sections }] };
}

interface Harness {
  engine: RenderEngine;
  diags: VoiceDiagnostic[];
  m: PixelModel;
  now: number;
  /** Queue `ev` at the current time and advance `ms` (ticking every 10 ms). */
  send(ev: Omit<InputEvent, 'timeMs'>, ms?: number): void;
  advance(ms: number, beatAt?: (t: number) => number): void;
}

function harness(show: Show): Harness {
  const engine = createVoiceBusEngine({ onDiagnostic: (d) => h.diags.push(d) });
  const m = model();
  engine.setModel(m);
  engine.setShow(show);
  const h: Harness = {
    engine, diags: [], m, now: 0,
    send(ev, ms = 20) {
      engine.applyInput({ ...ev, timeMs: h.now } as InputEvent);
      h.advance(ms);
    },
    advance(ms, beatAt = () => 0) {
      const end = h.now + ms;
      do {
        engine.tick(h.now, 10, transport(beatAt(h.now)));
        if (h.now >= end) break;
        h.now = Math.min(end, h.now + 10);
      } while (true);
    },
  };
  h.engine.tick(0, 0, transport(0));
  return h;
}

/** Summed red channel over a pixel range. */
function sumRange(frame: Readonly<Float32Array>, start: number, end: number, channel = 0): number {
  let sum = 0;
  for (let i = start; i < end; i++) sum += frame[i * 4 + channel]!;
  return sum;
}

function drumLight(h: Harness, drumId: string, channel = 0): number {
  const d = h.m.drumById.get(drumId)!;
  return sumRange(h.engine.frame(), d.pixelStart, d.pixelStart + d.pixelCount, channel);
}

function litDrums(h: Harness, channel = 0): string[] {
  return DRUMS.filter((id) => drumLight(h, id, channel) > 1e-6);
}

/** Mean red level over one drum (0..1 for a white solid). */
function drumLevel(h: Harness, drumId: string): number {
  return drumLight(h, drumId) / h.m.drumById.get(drumId)!.pixelCount;
}

const recall = (sectionId: string): Omit<InputEvent, 'timeMs'> => ({ kind: 'recallSection', songId: 'song', sectionId });

describe('Effect path — zone triggers', () => {
  it('a zone Effect on (kick, slot 0) lights kick on a kick zone-0 hit and nothing on a snare hit', () => {
    const fx = solid({ id: 'k0', cell: { row: 'kick', column: { kind: 'zone', slot: 0 } } });
    const h = harness(showOf(section('s', [fx])));
    h.send({ kind: 'noteOn', drumId: 'snare', zone: '0', velocity: 1 });
    expect(litDrums(h)).toEqual([]);
    h.send({ kind: 'noteOn', drumId: 'kick', zone: '1', velocity: 1 });
    expect(litDrums(h)).toEqual([]);
    h.send({ kind: 'noteOn', drumId: 'kick', zone: '0', velocity: 1 });
    expect(litDrums(h)).toEqual(['kick']);
  });

  it('a hit that matches no Effect reports effect-missed, not a graph miss', () => {
    const h = harness(showOf(section('s', [])));
    h.send({ kind: 'noteOn', drumId: 'kick', zone: '0', velocity: 1 });
    expect(h.diags.map((d) => d.kind)).toContain('effect-missed');
    expect(h.diags.map((d) => d.kind)).not.toContain('graph-missed');
  });
});

describe('Effect path — cue triggers', () => {
  const cue = (id: string, source: Record<string, unknown>, color = '#ffffff'): Effect =>
    solid({ id, cell: { row: 'kit', column: { kind: 'cue' } }, trigger: { kind: 'cue', source } }, color);

  it('fires a Cue from its MIDI note, its CC and its OSC address', () => {
    for (const [source, ev] of [
      [{ midiNote: 60 }, { kind: 'noteOn', note: 60, velocity: 1 }],
      [{ midiCc: 20 }, { kind: 'cc', controller: 20, channel: 1, value: 127 }],
      [{ oscAddress: '/cue/a' }, { kind: 'osc', address: '/cue/a', value: 1 }],
    ] as const) {
      const h = harness(showOf(section('s', [cue('c', source)])));
      h.send(ev as Omit<InputEvent, 'timeMs'>);
      expect(litDrums(h), JSON.stringify(source)).toEqual([...DRUMS]);
    }
  });

  it('does not fire on a non-matching note, CC or address', () => {
    const h = harness(showOf(section('s', [cue('c', { midiNote: 60, midiCc: 20, oscAddress: '/a' })])));
    h.send({ kind: 'noteOn', note: 61, velocity: 1 });
    h.send({ kind: 'cc', controller: 21, value: 127 });
    h.send({ kind: 'osc', address: '/b', value: 1 });
    expect(litDrums(h)).toEqual([]);
  });

  it('a CC Cue fires once on the rising edge, not on every value while held high', () => {
    const h = harness(showOf(section('s', [cue('c', { midiCc: 20 })])));
    h.send({ kind: 'cc', controller: 20, value: 100 });
    h.send({ kind: 'cc', controller: 20, value: 110 });
    h.send({ kind: 'cc', controller: 20, value: 0 });
    h.send({ kind: 'cc', controller: 20, value: 127 });
    expect(h.diags.filter((d) => d.kind === 'effect-fired')).toHaveLength(2);
  });

  it('a zone-mapped note fires BOTH the zone Effect and a Cue on the same note, in section order', () => {
    const zone = solid({ id: 'z', cell: { row: 'kick', column: { kind: 'zone', slot: 0 } } }, '#ff0000');
    const c = solid({
      id: 'c', cell: { row: 'kit', column: { kind: 'cue' } }, trigger: { kind: 'cue', source: { midiNote: 36 } },
      target: { kind: 'select', drums: [{ drumId: 'snare' }] },
    }, '#0000ff');
    const h = harness(showOf(section('s', [zone, c])));
    h.send({ kind: 'noteOn', drumId: 'kick', zone: '0', note: 36, velocity: 1 });
    expect(h.diags.flatMap((d) => (d.kind === 'effect-fired' ? [d.effectId] : []))).toEqual(['z', 'c']);
    expect(litDrums(h, 0)).toEqual(['kick']); // red
    expect(litDrums(h, 2)).toEqual(['snare']); // blue
  });
});

describe('Effect path — Always', () => {
  it('renders after section recall and releases on recall of another section', () => {
    const always = solid({ id: 'a', cell: { row: 'kit', column: { kind: 'always' } } });
    const h = harness(showOf(section('A', [always]), section('B', [])));
    h.send(recall('A'), 50);
    expect(litDrums(h)).toEqual([...DRUMS]);
    expect(h.engine.stats().voices.map((v) => [v.mode, v.releasing])).toEqual([['loop', false]]);
    h.send(recall('B'), 20);
    expect(h.engine.stats().voices.map((v) => v.releasing)).toEqual([true]);
    h.advance(500);
    expect(litDrums(h)).toEqual([]);
    expect(h.engine.stats().voiceCount).toBe(0);
  });

  it('re-recalling the same section replaces rather than stacks its Always Effects', () => {
    const always = solid({ id: 'a', cell: { row: 'kit', column: { kind: 'always' } } });
    const h = harness(showOf(section('A', [always])));
    h.send(recall('A'));
    h.send(recall('A'));
    const live = h.engine.stats().voices.filter((v) => !v.releasing);
    expect(live).toHaveLength(1);
  });
});

describe('Effect path — Clock', () => {
  const clockShow = (): Show => showOf(section('s', [
    solid({ id: 'tick', cell: { row: 'kit', column: { kind: 'clock' } }, trigger: { kind: 'clock', every: { beats: 1 } }, amp: { attackMs: 0, length: { ms: 50 }, releaseMs: 60 } }),
  ]));

  /** Replay a fixed event log over 8 beats at 120 bpm (500 ms/beat), ticking every 10 ms. */
  function run(): { fires: number[]; frames: Float32Array[] } {
    const h = harness(clockShow());
    h.send(recall('s'), 0);
    const frames: Float32Array[] = [];
    for (let t = 10; t <= 4000; t += 10) {
      h.engine.tick(t, 10, transport(t / 500));
      if (t % 250 === 0) frames.push(Float32Array.from(h.engine.frame()));
    }
    const fires = h.diags.flatMap((d) => (d.kind === 'effect-fired' && d.trigger === 'clock' ? [d.effectId] : [])).map((_, i) => i);
    return { fires, frames };
  }

  it('`every: 1 beat` fires exactly once per beat crossing over N beats, identically on replay', () => {
    const a = run();
    const b = run();
    expect(a.fires).toHaveLength(8);
    expect(b.fires).toEqual(a.fires);
    expect(b.frames).toEqual(a.frames);
  });

  it('fires at the offset grid points and only on the active Effect section', () => {
    const offset = showOf(
      section('s', [solid({ id: 'o', cell: { row: 'kit', column: { kind: 'clock' } }, trigger: { kind: 'clock', every: { bars: 1 }, offsetBeats: 1 } })]),
      section('g', undefined),
    );
    const h = harness(offset);
    h.send(recall('s'), 0);
    const fireBeats: number[] = [];
    for (let t = 10; t <= 5000; t += 10) {
      const before = h.diags.length;
      h.engine.tick(t, 10, transport(t / 500));
      if (h.diags.slice(before).some((d) => d.kind === 'effect-fired')) fireBeats.push(t / 500);
    }
    expect(fireBeats).toEqual([1, 5, 9]);
    h.engine.applyInput({ kind: 'recallSection', songId: 'song', sectionId: 'g', timeMs: 5000 });
    const before = h.diags.filter((d) => d.kind === 'effect-fired').length;
    for (let t = 5010; t <= 7000; t += 10) h.engine.tick(t, 10, transport(t / 500));
    expect(h.diags.filter((d) => d.kind === 'effect-fired')).toHaveLength(before);
  });
});

describe('Effect path — retrigger', () => {
  function twoHits(retrigger: 'overlap' | 'restart' | 'ignore') {
    const h = harness(showOf(section('s', [
      solid({ id: 'r', retrigger, cell: { row: 'kick', column: { kind: 'zone', slot: 0 } } }),
    ])));
    h.send({ kind: 'noteOn', drumId: 'kick', zone: '0', velocity: 1 });
    h.send({ kind: 'noteOn', drumId: 'kick', zone: '0', velocity: 1 });
    return h.engine.stats().voices.map((v) => (v.releasing ? 'releasing' : 'live')).sort();
  }

  it('overlap spawns a second voice', () => expect(twoHits('overlap')).toEqual(['live', 'live']));
  it('restart releases the live voice, then spawns', () => expect(twoHits('restart')).toEqual(['live', 'releasing']));
  it('ignore skips while a voice is live', () => expect(twoHits('ignore')).toEqual(['live']));
});

describe('Effect path — amp envelope', () => {
  it('ramps the attack, decays to the sustain level, then releases', () => {
    const fx = parseEffect({
      id: 'env', cell: { row: 'kit', column: { kind: 'cue' } }, trigger: { kind: 'cue', source: { midiNote: 1 } },
      generator: { kind: 'solid', style: 'solid', params: { color: '#ffffff' } },
      amp: { attackMs: 100, decayMs: 100, sustainLevel: 0.5, length: { ms: 1000 }, releaseMs: 200 },
    });
    const h = harness(showOf(section('s', [fx])));
    h.send({ kind: 'noteOn', note: 1, velocity: 1 }, 50);
    const at = (): number => drumLevel(h, 'kick');
    expect(at()).toBeCloseTo(0.5, 2); // halfway up the attack
    h.advance(50);
    expect(at()).toBeCloseTo(1, 2); // attack peak
    h.advance(50);
    expect(at()).toBeCloseTo(0.75, 2); // halfway down the decay
    h.advance(100);
    expect(at()).toBeCloseTo(0.5, 2); // sustain level
    h.advance(700); // t = 950: still inside the 1000 ms gate
    expect(at()).toBeCloseTo(0.5, 2);
    h.advance(150); // t = 1100: 100 ms into a 200 ms release from 0.5
    expect(at()).toBeCloseTo(0.25, 2);
    h.advance(150);
    expect(at()).toBe(0);
  });

  it('the amp envelope owns the level at every sustain level: generator natural decay stays off', () => {
    // `simple` hosts whole-drum, which fades on its own decay unless an authored curve is
    // present. Sustain 1 and 0.999 must look the same mid-gate, not dark vs lit.
    const levelAt = (sustainLevel: number): number => {
      const fx = parseEffect({
        id: `s${sustainLevel}`, cell: { row: 'kick', column: { kind: 'zone', slot: 0 } },
        generator: { kind: 'solid', style: 'simple' },
        amp: { attackMs: 0, decayMs: 0, sustainLevel, length: { ms: 2000 }, releaseMs: 100 },
      });
      const h = harness(showOf(section('s', [fx])));
      h.send({ kind: 'noteOn', drumId: 'kick', zone: '0', velocity: 1 }, 1500);
      return drumLevel(h, 'kick');
    };
    const full = levelAt(1);
    expect(full).toBeGreaterThan(0.5);
    expect(levelAt(0.999)).toBeCloseTo(full, 2);
  });

  it('a `hold` Effect stays up until its note-off, then releases', () => {
    const fx = parseEffect({
      id: 'hold', cell: { row: 'kit', column: { kind: 'cue' } }, trigger: { kind: 'cue', source: { midiNote: 5 } },
      generator: { kind: 'solid', style: 'solid' }, amp: { attackMs: 0, length: 'hold', releaseMs: 100 },
    });
    const h = harness(showOf(section('s', [fx])));
    h.send({ kind: 'noteOn', note: 5, velocity: 1 }, 3000);
    expect(h.engine.stats().voices.map((v) => [v.mode, v.releasing])).toEqual([['hold', false]]);
    h.send({ kind: 'noteOff', note: 5 }, 300);
    expect(h.engine.stats().voiceCount).toBe(0);
  });
});

describe('Effect path — velocity control', () => {
  it('maps hit velocity onto a generator param, so different velocities give different frames', () => {
    const fx = parseEffect({
      id: 'vel', cell: { row: 'kick', column: { kind: 'zone', slot: 0 } },
      generator: { kind: 'solid', style: 'solid', params: { color: '#ffffff' } },
      amp: { attackMs: 0, length: { ms: 2000 } },
      controls: [{ uid: 'v1', kind: 'velocity', mappings: [{ device: 'generator', param: 'brightness' }] }],
    });
    const levelFor = (velocity: number): number => {
      const h = harness(showOf(section('s', [fx])));
      h.send({ kind: 'noteOn', drumId: 'kick', zone: '0', velocity });
      return drumLevel(h, 'kick');
    };
    expect(levelFor(0.3)).toBeCloseTo(0.3, 3);
    expect(levelFor(0.9)).toBeCloseTo(0.9, 3);
  });
});

describe('Effect path — target', () => {
  it('`select` of two drums lights exactly those drums', () => {
    const fx = solid({
      id: 't', cell: { row: 'kit', column: { kind: 'cue' } }, trigger: { kind: 'cue', source: { midiNote: 9 } },
      target: { kind: 'select', drums: [{ drumId: 'kick' }, { drumId: 'tom' }] },
    });
    const h = harness(showOf(section('s', [fx])));
    h.send({ kind: 'noteOn', note: 9, velocity: 1 });
    expect(litDrums(h)).toEqual(['kick', 'tom']);
  });

  it('`select` with hoops lights only those hoops', () => {
    const fx = solid({
      id: 't', cell: { row: 'kit', column: { kind: 'cue' } }, trigger: { kind: 'cue', source: { midiNote: 9 } },
      target: { kind: 'select', drums: [{ drumId: 'snare', hoops: [2] }] },
    });
    const h = harness(showOf(section('s', [fx])));
    h.send({ kind: 'noteOn', note: 9, velocity: 1 });
    const hoop1 = getHoopPixelRange(h.m, 'snare', 1)!;
    const hoop2 = getHoopPixelRange(h.m, 'snare', 2)!;
    expect(litDrums(h)).toEqual(['snare']);
    expect(sumRange(h.engine.frame(), hoop1.start, hoop1.end)).toBe(0);
    expect(sumRange(h.engine.frame(), hoop2.start, hoop2.end)).toBeGreaterThan(0);
  });

  it('`hitDrum` lights the drum that was struck', () => {
    const fx = solid({
      id: 't', cell: { row: 'kit', column: { kind: 'cue' } }, trigger: { kind: 'cue', source: { midiNote: 40 } },
      target: { kind: 'hitDrum' },
    });
    const h = harness(showOf(section('s', [fx])));
    h.send({ kind: 'noteOn', drumId: 'tom', zone: '3', note: 40, velocity: 1 });
    expect(litDrums(h)).toEqual(['tom']);
  });
});

describe('Effect path — fireEffect audition and robustness', () => {
  it('fireEffect auditions one Effect of the active section', () => {
    const fx = solid({ id: 'aud', cell: { row: 'snare', column: { kind: 'zone', slot: 2 } } });
    const h = harness(showOf(section('s', [fx])));
    h.send({ kind: 'fireEffect', effectId: 'aud' });
    expect(litDrums(h)).toEqual(['snare']);
    h.send({ kind: 'fireEffect', effectId: 'nope' });
    expect(h.diags).toContainEqual(expect.objectContaining({ kind: 'effect-skipped', effectId: 'nope', reason: 'no-such-effect' }));
  });

  it('bypassed Effects never fire', () => {
    const fx = solid({ id: 'b', bypass: true, cell: { row: 'kick', column: { kind: 'zone', slot: 0 } } });
    const h = harness(showOf(section('s', [fx])));
    h.send({ kind: 'noteOn', drumId: 'kick', zone: '0', velocity: 1 });
    h.send({ kind: 'fireEffect', effectId: 'b' });
    expect(litDrums(h)).toEqual([]);
  });

  it('an unknown Generator style is skipped with a diagnostic, never a throw', () => {
    const fx = parseEffect({
      id: 'u', cell: { row: 'kick', column: { kind: 'zone', slot: 0 } }, generator: { kind: 'noise', style: 'nope' },
    });
    const h = harness(showOf(section('s', [fx])));
    expect(() => h.send({ kind: 'noteOn', drumId: 'kick', zone: '0', velocity: 1 })).not.toThrow();
    expect(h.diags).toContainEqual(expect.objectContaining({ kind: 'effect-skipped', effectId: 'u', reason: 'unknown-generator' }));
    expect(litDrums(h)).toEqual([]);
  });
});
