import { describe, expect, it } from 'vitest';
import { parseKit } from '../geometry/kit-schema';
import { buildPixelModel, type PixelModel } from '../geometry/pixel-model';
import type { TransportState } from '../engine/render-context';
import { createVoiceBusEngine, type InputEvent } from './engine';
import type { Show } from './types';
import type { Effect, SpliceSlot } from '../effect-chain/types';
import { effectShowOf, sectionOf, zoneEffect } from './effect-test-fixtures';

/* Slice end to end: a hit fires a Slice Effect and the real engine (resolver → voice pool →
   compositor) draws it. The pure tests pin the geometry; these pin the JOINS — that a slice
   is resolved at all, spawns a lit voice, reaches the compositor's 3D branch, and keeps the
   parts it borrows from the splice working (colour fill, velocity, target, the voice
   outliving its cascade). Each is a place a new generator kind silently falls through. */

/** Kick at x=0, snare 600mm to its right — two 8-pixel hoops each, 32 pixels in all. */
function testModel(): PixelModel {
  return buildPixelModel(
    parseKit({
      global: { ledDensityPxPerM: 30, hoopCount: 2, defaultHoopSpacingMm: 50 },
      drums: [
        { id: 'kick', diameterIn: 12, pixelsPerHoop: 8, hoopSpacingMm: 50, origin: { x: 0, y: 0, z: 0 }, rotation: { x: 0, y: 0, z: 0 } },
        { id: 'snare', diameterIn: 12, pixelsPerHoop: 8, hoopSpacingMm: 50, origin: { x: 600, y: 0, z: 0 }, rotation: { x: 0, y: 0, z: 0 } },
      ],
    }),
  );
}

/**
 * A kick-zone Slice Effect over `slots`. `params` are the Slice device's params; the unit hold
 * defaults to a minute and the amp envelope gates the voice for the same span, so the slice is
 * steady over the test window. `over` merges into the authored Effect (target, amp…).
 */
function sliceEffect(slots: SpliceSlot[], params: Record<string, unknown> = {}, over: Record<string, unknown> = {}): Effect {
  return zoneEffect('slice', { kind: 'slice', style: '', params: { count: slots.length, holdMs: 60000, ...params }, slots }, {
    amp: { attackMs: 10, length: { ms: 60010 }, releaseMs: 300 },
    target: { kind: 'kit' },
    ...over,
  });
}

const show = (effect: Effect): Show => effectShowOf(sectionOf('s', [effect]));

const transport = (now: number): TransportState => ({ timeMs: now, beat: 0, bar: 0, beatInBar: 0, bpm: 120, beatsPerBar: 4, playing: true });

/** Fire the Effect with `velocity`, run to `atMs` in small steps, and return per-drum peaks. */
function render(effect: Effect, atMs = 60, velocity = 1) {
  const model = testModel();
  const engine = createVoiceBusEngine();
  engine.setModel(model);
  engine.setShow(show(effect));
  engine.applyInput({ kind: 'noteOn', drumId: 'kick', zone: '', velocity, timeMs: 0 } as InputEvent);
  for (let t = 5; t <= atMs; t += 5) engine.tick(t, 5, transport(t));
  const frame = engine.frame();
  const rgb = (i: number): [number, number, number] => [frame[i * 4]!, frame[i * 4 + 1]!, frame[i * 4 + 2]!];
  const peak = (drumId: string): number => {
    const d = model.drumById.get(drumId)!;
    let p = 0;
    for (let i = d.pixelStart; i < d.pixelStart + d.pixelCount; i++) p = Math.max(p, ...rgb(i));
    return p;
  };
  return { model, rgb, peak, voices: engine.stats().voices.length };
}

describe('slice — through the real engine', () => {
  it('cuts the kit into slabs along X: the left drum takes one colour, the right the other', () => {
    const { model, rgb } = render(sliceEffect([{ color: '#ff0000' }, { color: '#0000ff' }]));
    const kick = model.drumById.get('kick')!;
    const snare = model.drumById.get('snare')!;
    const [kr, , kb] = rgb(kick.pixelStart);
    const [sr, , sb] = rgb(snare.pixelStart);
    expect(kr, 'kick is red').toBeGreaterThan(0.5);
    expect(kb, 'kick is not blue').toBeCloseTo(0, 2);
    expect(sb, 'snare is blue').toBeGreaterThan(0.5);
    expect(sr, 'snare is not red').toBeCloseTo(0, 2);
  });

  it('spawns nothing when every slice is blank', () => {
    expect(render(sliceEffect([{}, { muted: true }])).voices).toBe(0);
  });

  // The Generator standard (2026-10-07): velocity is the Velocity Control's job — a new Slice comes
  // with one on the Effect's Opacity (effects-doc addEffect); the Slice itself has no Velocity.
  it('answers velocity through a Velocity Control on Opacity — a soft hit is a dimmer slice', () => {
    const controls = [{ uid: 'v', kind: 'velocity', mappings: [{ device: 'effect', param: 'opacity', rangeMin: 0, rangeMax: 1 }] }];
    const hard = render(sliceEffect([{ color: '#ffffff' }], {}, { controls }), 60, 1).peak('kick');
    const soft = render(sliceEffect([{ color: '#ffffff' }], {}, { controls }), 60, 0.25).peak('kick');
    expect(soft).toBeLessThan(hard * 0.5);
  });

  it('without that Control it ignores velocity — even a leftover Velocity param', () => {
    const hard = render(sliceEffect([{ color: '#ffffff' }], { velocity: 1 }), 60, 1).peak('kick');
    const soft = render(sliceEffect([{ color: '#ffffff' }], { velocity: 1 }), 60, 0.25).peak('kick');
    expect(soft).toBeCloseTo(hard, 3);
  });

  it('a SPACE slice lights only the pixels inside its box', () => {
    // A box round the kick alone.
    const r = render(sliceEffect([{ color: '#ffffff' }], { regionCx: 0, regionCy: 0, regionCz: 0, regionSx: 400, regionSy: 400, regionSz: 400 }));
    expect(r.peak('kick')).toBeGreaterThan(0.5);
    expect(r.peak('snare')).toBe(0);
  });

  it('a slice targeted at one drum lights only that drum', () => {
    const r = render(sliceEffect([{ color: '#ffffff' }], {}, { target: { kind: 'select', drums: [{ drumId: 'snare' }] } }));
    expect(r.peak('snare')).toBeGreaterThan(0.5);
    expect(r.peak('kick')).toBe(0);
  });

  it('outlives a long DRUM CHASE, so the far drum lights when its turn comes', () => {
    // A short authored envelope (10 + 200 + 100ms) against a 1500ms drum delay: without the
    // engine extending the voice by the cascade, the snare's turn would come after it died.
    const graph = sliceEffect([{ color: '#ffffff' }], {
      waitMode: 'dark',
      drumOffsetMode: 'time',
      drumOffsetMs: 1500,
      attackMs: 10,
      holdMs: 200,
      releaseMs: 100,
    }, { amp: { attackMs: 10, length: { ms: 210 }, releaseMs: 100 } });
    const early = render(graph, 400);
    expect(early.peak('kick'), 'kick first').toBeGreaterThan(0.5);
    expect(early.peak('snare'), 'snare still waiting').toBe(0);
    expect(render(graph, 1600).peak('snare'), 'snare on its turn').toBeGreaterThan(0.5);
  });
});
