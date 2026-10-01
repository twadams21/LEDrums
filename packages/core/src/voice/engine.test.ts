import { describe, expect, it } from 'vitest';
import { parseKit } from '../geometry/kit-schema';
import { buildPixelModel, type PixelModel } from '../geometry/pixel-model';
import type { TransportState } from '../engine/render-context';
import { CHAIN_BUS_ID } from '../effect-chain/runtime';
import type { Effect } from '../effect-chain/types';
import { createNullEngine, createVoiceBusEngine, type InputEvent } from './engine';
import type { VoiceDiagnostic } from './diagnostics';
import { effectShowOf, sectionOf, songOf, zoneEffect } from './effect-test-fixtures';
import type { Show } from './types';

/* Engine-level behaviour that does not belong to one feature suite: the null adapter, the
   per-voice stats stream, drum / kit targeting, determinism, the voice cap, the dock's
   releaseBus stop, section-recall validation and the unrouted-input diagnostics. Effect
   firing itself (zones, cues, clocks, retrigger, amp) lives in engine.effect-chain.test.ts. */

// ---- fixtures ---------------------------------------------------------------

function testModel(): PixelModel {
  const kit = parseKit({
    global: { ledDensityPxPerM: 30, hoopCount: 2, defaultHoopSpacingMm: 50 },
    drums: [
      { id: 'kick', diameterIn: 12, hoopSpacingMm: 50, origin: { x: 0, y: 0, z: 0 }, rotation: { x: 0, y: 0, z: 0 } },
      { id: 'snare', diameterIn: 10, hoopSpacingMm: 50, origin: { x: 300, y: 0, z: 0 }, rotation: { x: 0, y: 0, z: 0 } },
    ],
  });
  return buildPixelModel(kit);
}

/** A kick-zone solid Effect: 10ms attack, 110ms gate, 100ms release. */
function fx(id: string, over: Record<string, unknown> = {}, row = 'kick'): Effect {
  return zoneEffect(id, { kind: 'solid', style: 'swirl', params: { brightness: 1 } }, {
    amp: { attackMs: 10, length: { ms: 110 }, releaseMs: 100 },
    target: { kind: 'kit' },
    ...over,
  }, row, 0);
}

/** Two Effects on kick's first zone — one hit spawns two voices. */
function twoEffectShow(): Show {
  return effectShowOf(sectionOf('s', [fx('fxA'), fx('fxB')]));
}

function transport(now: number, beat = 0, bpm = 120): TransportState {
  return {
    timeMs: now,
    beat,
    bar: Math.floor(beat / 4),
    beatInBar: beat - Math.floor(beat / 4) * 4,
    bpm,
    beatsPerBar: 4,
    playing: true,
  };
}

function hit(drumId = 'kick', timeMs = 0, velocity = 1): InputEvent {
  return { kind: 'noteOn', drumId, zone: '', velocity, timeMs };
}

function recallSection(songId: string | null, sectionId: string | null, timeMs = 0): InputEvent {
  return { kind: 'recallSection', songId, sectionId, timeMs };
}

const litCount = (f: Readonly<Float32Array>, n: number): number => {
  let lit = 0;
  for (let i = 0; i < n; i++) {
    const j = i * 4;
    if (f[j]! > 0.004 || f[j + 1]! > 0.004 || f[j + 2]! > 0.004) lit++;
  }
  return lit;
};

// ---- tests ------------------------------------------------------------------

describe('createNullEngine', () => {
  it('returns an all-zero frame of pixelCount*4', () => {
    const m = testModel();
    const e = createNullEngine();
    e.setModel(m);
    e.setShow(twoEffectShow());
    e.applyInput(hit());
    e.tick(16, 16, transport(16));
    const f = e.frame();
    expect(f.length).toBe(m.pixelCount * 4);
    expect(Array.from(f).every((x) => x === 0)).toBe(true);
    expect(e.stats().voiceCount).toBe(0);
    expect(e.stats().voices).toEqual([]);
  });
});

describe('VoiceBusEngine — stats().voices per-voice detail (S17)', () => {
  it('lists one entry per active voice with bus / effect / mode / level / release / via', () => {
    const e = createVoiceBusEngine();
    e.setModel(testModel());
    e.setShow(twoEffectShow());
    e.applyInput(hit('kick', 0));
    e.tick(5, 5, transport(5));

    const { voices } = e.stats();
    expect(voices).toHaveLength(2);
    // The dock groups by bus and names the Effect — both must survive onto the wire shape.
    expect(new Set(voices.map((v) => v.busId))).toEqual(new Set([CHAIN_BUS_ID]));
    expect(new Set(voices.map((v) => v.via))).toEqual(new Set(['Effect: fxA', 'Effect: fxB']));
    for (const v of voices) {
      expect(v.mode).toBe('oneshot');
      expect(v.id).toBeTruthy();
      expect(v.level).toBeGreaterThanOrEqual(0);
      expect(v.releasing).toBe(false); // fresh voices are attacking, not releasing
    }
  });

  it('flags a voice as releasing once it enters its release phase', () => {
    const e = createVoiceBusEngine();
    e.setModel(testModel());
    e.setShow(twoEffectShow()); // attack 10, gate 110, release 100
    e.applyInput(hit('kick', 0));
    e.tick(5, 5, transport(5)); // spawn → attacking
    e.tick(120, 115, transport(120)); // attack level hits 1 → sustain
    e.tick(160, 40, transport(160)); // gate elapsed (age 155 ≥ 110) → release, not yet reaped

    const fxA = e.stats().voices.find((v) => v.via === 'Effect: fxA');
    expect(fxA).toBeDefined();
    expect(fxA!.releasing).toBe(true);
  });

  it('attributes each voice to the Effect that fired it via `pad`', () => {
    // The attribution a client needs to show WHICH Effect is currently lighting the kit.
    const e = createVoiceBusEngine();
    e.setModel(testModel());
    e.setShow(twoEffectShow());
    e.applyInput(hit('kick', 0));
    e.tick(5, 5, transport(5));

    expect(e.stats().voices.map((v) => v.pad).sort()).toEqual(['effect:fxA', 'effect:fxB']);
  });

  it('surfaces an Always Effect as a looped voice after a recall, with a bus level', () => {
    const e = createVoiceBusEngine();
    e.setModel(testModel());
    const always = zoneEffect('wash', { kind: 'solid', style: 'swirl', params: { brightness: 1 } }, {
      cell: { row: 'kit', column: { kind: 'always' } },
    });
    e.setShow(effectShowOf(sectionOf('a', []), sectionOf('b', [always])));
    e.applyInput(recallSection('song', 'b', 0));
    e.tick(5, 5, transport(5)); // drain recall → spawn the Always Effect
    e.tick(40, 35, transport(40)); // age past attack so levels register

    const stats = e.stats();
    expect(stats.voices.find((v) => v.pad === 'effect:wash')).toMatchObject({ busId: CHAIN_BUS_ID, mode: 'loop' });
    // Bus levels are derived from the live voices (the offline Sim's meter rule).
    expect(stats.busLevels[CHAIN_BUS_ID]).toBeGreaterThan(0);
  });
});

describe('VoiceBusEngine — drum / kit targeting', () => {
  const fireTargeted = (target: Record<string, unknown>, drumId: string): Readonly<Float32Array> => {
    const e = createVoiceBusEngine();
    e.setModel(testModel()); // drums: kick, snare
    e.setShow(effectShowOf(sectionOf('s', [fx('fxA', { target }, drumId)])));
    e.applyInput(hit(drumId, 0));
    e.tick(5, 5, transport(5));
    e.tick(40, 35, transport(40)); // age past attack so level > 0
    return e.frame();
  };

  it('lights pixels for a hit-drum Effect and scopes it to the struck drum range', () => {
    const m = testModel();
    const lit = litCount(fireTargeted({ kind: 'hitDrum' }, 'kick'), m.pixelCount);
    expect(lit).toBeGreaterThan(0);
    expect(lit).toBeLessThanOrEqual(m.drumById.get('kick')!.pixelCount);
  });

  // Regression: a drum-targeted voice whose drum is absent from the engine's kit renders
  // NOTHING (the compositor `drumById.get(id)` misses → skip). This is the failure mode behind
  // "effects don't trigger reliably" when authored drum ids drift from the kit's (e.g. 'tom' vs
  // 'tom1'). A kit-target voice with the same unknown id still lights (it ignores the drum).
  it('a hit-drum voice with an unknown drum id lights nothing (id-drift regression)', () => {
    const m = testModel();
    expect(litCount(fireTargeted({ kind: 'hitDrum' }, 'kick'), m.pixelCount)).toBeGreaterThan(0);
    expect(litCount(fireTargeted({ kind: 'hitDrum' }, 'ghost'), m.pixelCount)).toBe(0);
  });

  it('a kit-target voice lights regardless of the source drum id', () => {
    const m = testModel();
    expect(litCount(fireTargeted({ kind: 'kit' }, 'ghost'), m.pixelCount)).toBeGreaterThan(0);
  });
});

describe('VoiceBusEngine — determinism', () => {
  it('two engines with identical (model, show, inputs, ticks) produce byte-identical frames', () => {
    const events: InputEvent[] = [hit('kick', 5, 0.9), hit('kick', 40, 0.4), hit('kick', 90, 1), hit('kick', 130, 0.7)];
    const run = (): number[] => {
      const e = createVoiceBusEngine();
      e.setModel(testModel());
      // A random Control on brightness exercises the seeded PRNG path per fire.
      const random = fx('fxR', {
        amp: { attackMs: 10, length: { ms: 2000 }, releaseMs: 100 },
        controls: [{ uid: 'r', kind: 'random', mappings: [{ device: 'generator', param: 'brightness', rangeMin: 0, rangeMax: 1 }] }],
      });
      e.setShow(effectShowOf(sectionOf('s', [random, fx('fxB', { target: { kind: 'hitDrum' } })])));
      for (const ev of events) e.applyInput(ev);
      let now = 0;
      for (let i = 0; i < 40; i++) {
        now += 16;
        e.tick(now, 16, transport(now, (now / 1000) * 2));
      }
      return Array.from(e.frame());
    };
    const a = run();
    expect(a.some((x) => x > 0)).toBe(true);
    expect(run()).toEqual(a);
  });
});

describe('VoiceBusEngine — zero-alloc / cap sanity', () => {
  it('rapid triggers stay within the voice cap and never throw', () => {
    const e = createVoiceBusEngine();
    e.setModel(testModel());
    e.setShow(twoEffectShow());
    let now = 0;
    expect(() => {
      for (let i = 0; i < 2000; i++) {
        now += 4;
        e.applyInput(hit('kick', now, 1));
        e.tick(now, 4, transport(now, (now / 1000) * 2));
        expect(e.stats().voiceCount).toBeLessThanOrEqual(256);
      }
    }).not.toThrow();
  });

  it('frame() is the same Float32Array instance across ticks (no per-frame copy)', () => {
    const e = createVoiceBusEngine();
    e.setModel(testModel());
    e.setShow(twoEffectShow());
    e.tick(16, 16, transport(16));
    const a = e.frame();
    e.tick(32, 16, transport(32));
    const b = e.frame();
    expect(a).toBe(b);
  });
});

describe('VoiceBusEngine — section recall validation', () => {
  it('recalls a valid zero-section song and clears the section pointer', () => {
    const e = createVoiceBusEngine();
    e.setShow({ songs: [songOf('empty-song', [])] });
    e.applyInput(recallSection('empty-song', null, 0));
    e.tick(5, 5, transport(5));

    expect(e.getActiveSelection()).toEqual({ activeSongId: 'empty-song', activeSectionId: null });
  });

  it('rejects a null section recall for a non-empty song', () => {
    const e = createVoiceBusEngine();
    e.setShow({ songs: [songOf('song1', [sectionOf('sec1', [])])] });
    e.applyInput(recallSection('song1', null, 0));
    e.tick(5, 5, transport(5));

    expect(e.getActiveSelection()).toEqual({ activeSongId: 'song1', activeSectionId: 'sec1' });
  });

  it('a show with no songs has no active selection, and a recall into it is refused', () => {
    const e = createVoiceBusEngine();
    e.setShow({ songs: [] });
    e.applyInput(recallSection(null, 'sec1', 0));
    e.tick(5, 5, transport(5));

    expect(e.getActiveSelection()).toEqual({ activeSongId: null, activeSectionId: null });
  });
});

describe('VoiceBusEngine — input resolution diagnostics', () => {
  const runDiagnostics = (s: Show, events: InputEvent[]): VoiceDiagnostic[] => {
    const diagnostics: VoiceDiagnostic[] = [];
    const e = createVoiceBusEngine({ onDiagnostic: (d) => diagnostics.push(d) });
    e.setModel(testModel());
    e.setShow(s);
    for (const ev of events) e.applyInput(ev);
    e.tick(5, 5, transport(5));
    return diagnostics;
  };

  it('reports an unrouted input for a raw note that matches no zone and no Cue', () => {
    const diagnostics = runDiagnostics(twoEffectShow(), [{ kind: 'noteOn', note: 7, velocity: 1, timeMs: 0 }]);

    expect(diagnostics).toContainEqual(
      expect.objectContaining({ kind: 'input-unrouted', input: expect.objectContaining({ note: 7 }) }),
    );
    expect(diagnostics.some((d) => d.kind === 'effect-missed' || d.kind === 'effect-fired')).toBe(false);
  });

  it('reports an unrouted input for a raw OSC address that matches no Cue', () => {
    const diagnostics = runDiagnostics(twoEffectShow(), [{ kind: 'osc', address: '/nope', value: 1, timeMs: 0 }]);

    expect(diagnostics).toContainEqual(
      expect.objectContaining({ kind: 'input-unrouted', input: expect.objectContaining({ address: '/nope' }) }),
    );
    expect(diagnostics.some((d) => d.kind === 'effect-missed')).toBe(false);
  });

  it('reports a miss (not unrouted) for a routed drum hit no Effect matches', () => {
    // A zone-mapped hit carries a drumId (the server resolved the zone); nothing fires on the
    // snare — but the input WAS routed to a drum, so it is a miss, not unrouted.
    const diagnostics = runDiagnostics(twoEffectShow(), [hit('snare', 0)]);

    expect(diagnostics).toContainEqual(expect.objectContaining({ kind: 'effect-missed', sectionId: 's' }));
    expect(diagnostics.some((d) => d.kind === 'input-unrouted')).toBe(false);
  });

  it('reports a miss with no section when none is active', () => {
    const diagnostics = runDiagnostics({ songs: [] }, [hit('kick', 0)]);

    expect(diagnostics).toContainEqual(expect.objectContaining({ kind: 'effect-missed', sectionId: null }));
  });
});

describe('VoiceBusEngine — releaseBus input (dock stop buttons)', () => {
  it('releases only the targeted bus; absent busId releases every voice', () => {
    const e = createVoiceBusEngine();
    e.setModel(testModel());
    e.setShow(twoEffectShow());
    e.applyInput(hit('kick', 0));
    e.tick(5, 5, transport(5)); // spawn both voices
    e.tick(20, 15, transport(20)); // attack (10ms) complete -> sustaining at full level
    expect(e.stats().voices.filter((v) => !v.releasing)).toHaveLength(2);

    // Another bus holds none of these voices: nothing releases.
    e.applyInput({ kind: 'releaseBus', busId: 'lead', timeMs: 21 });
    e.tick(25, 5, transport(25));
    expect(e.stats().voices.filter((v) => !v.releasing)).toHaveLength(2);

    e.applyInput({ kind: 'releaseBus', busId: CHAIN_BUS_ID, timeMs: 26 });
    e.tick(30, 5, transport(30));
    expect(e.stats().voices.length).toBeGreaterThan(0);
    for (const v of e.stats().voices) expect(v.releasing).toBe(true);
  });

  it('an absent busId releases every voice (panic)', () => {
    const e = createVoiceBusEngine();
    e.setModel(testModel());
    e.setShow(twoEffectShow());
    e.applyInput(hit('kick', 0));
    e.tick(5, 5, transport(5)); // spawn both voices
    e.tick(20, 15, transport(20)); // attack complete
    e.applyInput({ kind: 'releaseBus', timeMs: 21 });
    e.tick(25, 5, transport(25));
    expect(e.stats().voices.length).toBe(2);
    for (const v of e.stats().voices) expect(v.releasing).toBe(true);
  });
});
