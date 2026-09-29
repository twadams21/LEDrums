/* Effect chains S02 §4 — the section Master chain at the engine seam:
   setModel → setShow (sections with `effects` + `master`) → recall → tick → frame. */
import { describe, expect, it } from 'vitest';
import type { TransportState } from '../engine/render-context';
import { parseKit } from '../geometry/kit-schema';
import { buildPixelModel } from '../geometry/pixel-model';
import { masterChainSchema, parseEffect } from '../effect-chain/types';
import { createVoiceBusEngine, type InputEvent, type RenderEngine } from './engine';
import { emptyShow, type Show, type SongSection } from './types';

const transport: TransportState = { timeMs: 0, beat: 0, bar: 0, beatInBar: 0, bpm: 120, beatsPerBar: 4, playing: true };

/** A kit-wide white Always Effect: lit at full level from the section recall on. */
const wash = parseEffect({
  id: 'wash',
  cell: { row: 'kit', column: { kind: 'always' } },
  generator: { kind: 'solid', style: 'solid', params: { color: '#ffffff' } },
  amp: { attackMs: 0, releaseMs: 0 },
});

function showOf(...sections: SongSection[]): Show {
  return { ...emptyShow(), songs: [{ id: 'song', name: 'Song', sections }] };
}

const section = (id: string, master?: unknown[]): SongSection => ({
  id, name: id, slots: {}, effects: [wash], ...(master ? { master: masterChainSchema.parse(master) } : {}),
});

const HALF = [{ uid: 'l', modifierId: 'levels', params: { brightness: 0.5 } }];

interface Harness {
  engine: RenderEngine;
  now: number;
  /** Apply `ev` at the current time and tick once (no time passes). */
  send(ev: Omit<InputEvent, 'timeMs'>): void;
  /** Advance `ms`, ticking every 10 ms. */
  advance(ms: number): void;
}

function harness(show: Show): Harness {
  const engine = createVoiceBusEngine();
  engine.setModel(buildPixelModel(parseKit({
    global: { ledDensityPxPerM: 30, hoopCount: 2, defaultHoopSpacingMm: 50 },
    drums: [{ id: 'kick', diameterIn: 12, hoopSpacingMm: 50, origin: { x: 0, y: 0, z: 0 }, rotation: { x: 0, y: 0, z: 0 } }],
  })));
  engine.setShow(show);
  const h: Harness = {
    engine, now: 0,
    send(ev) {
      engine.applyInput({ ...ev, timeMs: h.now } as InputEvent);
      engine.tick(h.now, 0, transport);
    },
    advance(ms) {
      const end = h.now + ms;
      while (h.now < end) {
        h.now = Math.min(end, h.now + 10);
        engine.tick(h.now, 10, transport);
      }
    },
  };
  engine.tick(0, 0, transport);
  return h;
}

/** Mean red level over the whole frame (0..1 for a white wash). */
function level(engine: RenderEngine): number {
  const f = engine.frame();
  let sum = 0;
  for (let i = 0; i < f.length; i += 4) sum += f[i]!;
  return sum / (f.length / 4);
}

const recall = (sectionId: string): Omit<InputEvent, 'timeMs'> => ({ kind: 'recallSection', songId: 'song', sectionId });
const control = (action: InputEvent['action'], value?: number): Omit<InputEvent, 'timeMs'> =>
  ({ kind: 'globalControl', action, ...(value !== undefined ? { value } : {}) });

/** Run `steps` on a one-section show with `master`, returning the frame level after each step.
    The same steps on the same show WITHOUT a master chain are the reference. */
function levels(master: unknown[] | undefined, steps: Array<(h: Harness) => void>, extra: SongSection[] = []): number[] {
  const h = harness(showOf(section('A', master), ...extra));
  return steps.map((step) => { step(h); return level(h.engine); });
}

const recallA = (h: Harness): void => { h.send(recall('A')); h.advance(50); };

describe('engine — section Master chain', () => {
  it('a section without a master chain renders the wash lit', () => {
    const [lit] = levels(undefined, [recallA]);
    expect(lit).toBeGreaterThan(0.5);
  });

  it('a master levels at brightness 0.5 halves the whole frame', () => {
    const [dry] = levels(undefined, [recallA]);
    const [wet] = levels(HALF, [recallA]);
    expect(wet).toBeCloseTo(dry! * 0.5, 6);
  });

  it('applies only while its own section is active', () => {
    const toB = (h: Harness): void => { h.send(recall('B')); h.advance(50); };
    const [dry] = levels(undefined, [toB], [section('B')]);
    const [wet] = levels(HALF, [toB], [section('B')]);
    expect(wet).toBeCloseTo(dry!, 6);
  });

  it('master brightness and blackout still apply after the master chain', () => {
    const steps = [
      recallA,
      (h: Harness) => h.send(control('masterBrightness', 0.5)),
      (h: Harness) => h.send(control('panicBlackoutLatch')),
    ];
    const [dry] = levels(undefined, steps);
    const [, dimmed, blackout] = levels(HALF, steps);
    expect(dimmed).toBeCloseTo(dry! * 0.25, 6);
    expect(blackout).toBe(0);
  });

  it('its clock restarts on section recall', () => {
    // 1 Hz, 50 % duty strobe: on for section-ms [0, 500), off for [500, 1000).
    const STROBE = [{ uid: 's', modifierId: 'strobe', params: { rate: 1, duty: 0.5 } }];
    const steps = [
      (h: Harness) => { h.advance(250); h.send(recall('A')); h.advance(100); }, // section-ms 100
      (h: Harness) => h.advance(500), // section-ms 600
      (h: Harness) => { h.send(recall('A')); h.advance(100); }, // restarted: section-ms 100
    ];
    const dry = levels(undefined, steps);
    const wet = levels(STROBE, steps);
    expect(dry.every((v) => v > 0.5)).toBe(true);
    expect(wet[0]).toBeCloseTo(dry[0]!, 6);
    expect(wet[1]).toBe(0);
    expect(wet[2]).toBeCloseTo(dry[2]!, 6);
  });
});
