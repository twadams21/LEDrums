import { describe, expect, it } from 'vitest';
import { parseKit } from '../geometry/kit-schema';
import { buildPixelModel, type PixelModel } from '../geometry/pixel-model';
import type { TransportState } from '../engine/render-context';
import { createVoiceBusEngine, type InputEvent } from './engine';
import { orderedByPattern, resolveSplices, sequenceRanks, spliceDrumRanks, spliceOrderIndex, spliceUnitOrder, type SplicePartitionUnit } from './splice';
import type { SpliceConfig, SpliceNode } from './types';
import type { Effect } from '../effect-chain/types';
import { effectShowOf, sectionOf, zoneEffect } from './effect-test-fixtures';

/* MOVE THROUGH's dragged order: the author picks exactly which drum (THROUGH KIT) or hoop (THROUGH
   DRUM) lights first, second, third. The part worth pinning hardest is that a sequence is always a
   PERMUTATION — a stale or partial one can never lengthen the cascade or drop a drum — and that the
   engine really fires in the dragged order, on a Splice and on a Slice. */

function node(over: Partial<SpliceNode> = {}): SpliceNode {
  return { ...over };
}

/** A kick-zone, kit-target Splice / Slice Effect of one white slot. `params` are the device's
    params; `gateMs` is the amp length (the unit hold is `params.holdMs`). */
function spliceEffect(kind: 'splice' | 'slice', params: Record<string, unknown>, gateMs: number, releaseMs = 300): Effect {
  return zoneEffect('fx', { kind, style: '', params: { count: 1, ...params }, slots: [{ color: '#ffffff' }] }, {
    amp: { attackMs: 10, length: { ms: gateMs }, releaseMs },
    target: { kind: 'kit' },
  });
}

describe('sequenceRanks', () => {
  const ids = ['kick', 'snare', 'tom1', 'tom2'];

  it('ranks the named ids in the order given', () => {
    expect(sequenceRanks(ids, ['tom2', 'kick', 'tom1', 'snare'])).toEqual([1, 3, 2, 0]);
  });

  it('puts ids the sequence left out after it, in model order', () => {
    // A drum added to the kit after the order was dragged joins at the end, never vanishes.
    expect(sequenceRanks(ids, ['tom1'])).toEqual([1, 2, 0, 3]);
  });

  it('drops unknown and repeated ids, so the result is always a permutation', () => {
    const ranks = sequenceRanks(ids, ['ghost', 'snare', 'snare', 'kick']);
    expect([...ranks].sort()).toEqual([0, 1, 2, 3]);
    expect(ranks[1]).toBe(0); // snare first
    expect(ranks[0]).toBe(1); // then kick
  });
});

describe('orderedByPattern', () => {
  it('is the inverse of the pattern ranking — the chips read in firing order', () => {
    for (const order of ['up', 'down', 'outside-in', 'random'] as const) {
      const seq = orderedByPattern(5, order, 7);
      seq.forEach((ordinal, rank) => expect(spliceOrderIndex(ordinal, 5, order, 7), order).toBe(rank));
    }
  });
});

describe('spliceUnitOrder', () => {
  const model = buildPixelModel(
    parseKit({
      global: { ledDensityPxPerM: 30, hoopCount: 3, defaultHoopSpacingMm: 50 },
      drums: [
        { id: 'kick', diameterIn: 12, pixelsPerHoop: 4, hoopSpacingMm: 50, origin: { x: 0, y: 0, z: 0 }, rotation: { x: 0, y: 0, z: 0 } },
        { id: 'snare', diameterIn: 10, pixelsPerHoop: 4, hoopSpacingMm: 50, origin: { x: 300, y: 0, z: 0 }, rotation: { x: 0, y: 0, z: 0 } },
      ],
    }),
  );
  const unit = (over: Partial<SplicePartitionUnit>): SplicePartitionUnit => ({
    start: 0, end: 4, index: 0, ordinal: 0, ordinalCount: 3, drumOrdinal: 0, drumCount: 2, ...over,
  });
  const cfg = (over: Partial<SpliceConfig>): SpliceConfig => ({ ...resolveSplices(node({ splices: [{ color: '#fff' }] }), 120)!.config, ...over });

  it('a drum sequence decides the drum axis of a hoop cut', () => {
    const c = cfg({ drumSequence: ['snare', 'kick'] });
    const ranks = spliceDrumRanks(model, c);
    expect(spliceUnitOrder(unit({ drumOrdinal: 0 }), c, ranks).drumOrderIndex, 'kick second').toBe(1);
    expect(spliceUnitOrder(unit({ drumOrdinal: 1 }), c, ranks).drumOrderIndex, 'snare first').toBe(0);
  });

  it('a drum sequence decides the PRIMARY axis of a drum cut, where the drums are the units', () => {
    const c = cfg({ partition: 'drum', drumSequence: ['snare', 'kick'] });
    const ranks = spliceDrumRanks(model, c);
    expect(spliceUnitOrder(unit({ ordinal: 1, ordinalCount: 2, drumOrdinal: 1 }), c, ranks).orderIndex).toBe(0);
  });

  it('a hoop sequence decides the primary axis of a hoop cut', () => {
    const c = cfg({ hoopSequence: [3, 1, 2] });
    const order = (hoop: number) => spliceUnitOrder(unit({ ordinal: hoop - 1 }), c, null).orderIndex;
    expect([order(1), order(2), order(3)]).toEqual([1, 2, 0]); // hoop 3 fires first
  });

  it('without a sequence, the patterns are exactly what they were', () => {
    const c = cfg({ order: 'down', drumOrder: 'down' });
    const o = spliceUnitOrder(unit({ ordinal: 0, drumOrdinal: 0 }), c, spliceDrumRanks(model, c));
    expect(o).toEqual({ orderIndex: spliceOrderIndex(0, 3, 'down', c.seed), drumOrderIndex: spliceOrderIndex(0, 2, 'down', c.seed) });
  });

  it('no sequence means no ranking work at all', () => {
    expect(spliceDrumRanks(model, cfg({}))).toBeNull();
  });
});

describe('resolveSplices carries the sequences', () => {
  it('keeps a clean sequence, and treats empty or junk as "use the pattern"', () => {
    const good = resolveSplices(node({ splices: [{ color: '#fff' }], spliceDrumSequence: ['snare', 'kick'], spliceHoopSequence: [2, 1] }), 120)!.config;
    expect(good.drumSequence).toEqual(['snare', 'kick']);
    expect(good.hoopSequence).toEqual([2, 1]);
    const junk = resolveSplices(node({ splices: [{ color: '#fff' }], spliceDrumSequence: [], spliceHoopSequence: [0, -1, 1.5] as number[] }), 120)!.config;
    expect(junk.drumSequence).toBeUndefined();
    expect(junk.hoopSequence).toBeUndefined();
  });
});

/* End to end: the engine fires drums in the dragged order. Kick is drum 0 in the model, so a
   sequence that puts the SNARE first must light the snare while the kick still waits. */
describe('the engine fires in the dragged order', () => {
  function model(): PixelModel {
    return buildPixelModel(
      parseKit({
        global: { ledDensityPxPerM: 30, hoopCount: 2, defaultHoopSpacingMm: 50 },
        drums: [
          { id: 'kick', diameterIn: 12, pixelsPerHoop: 4, hoopSpacingMm: 50, origin: { x: 0, y: 0, z: 0 }, rotation: { x: 0, y: 0, z: 0 } },
          { id: 'snare', diameterIn: 12, pixelsPerHoop: 4, hoopSpacingMm: 50, origin: { x: 600, y: 0, z: 0 }, rotation: { x: 0, y: 0, z: 0 } },
        ],
      }),
    );
  }
  const transport = (now: number): TransportState => ({ timeMs: now, beat: 0, bar: 0, beatInBar: 0, bpm: 120, beatsPerBar: 4, playing: true });

  function peaksAt(kind: 'splice' | 'slice', over: Record<string, unknown>, atMs: number) {
    const m = model();
    const engine = createVoiceBusEngine();
    engine.setModel(m);
    engine.setShow(effectShowOf(sectionOf('s', [spliceEffect(kind, { holdMs: 60000, ...over }, 60010)])));
    engine.applyInput({ kind: 'noteOn', drumId: 'kick', zone: '', velocity: 1, timeMs: 0 } as InputEvent);
    for (let t = 5; t <= atMs; t += 5) engine.tick(t, 5, transport(t));
    const f = engine.frame();
    const peak = (id: string) => {
      const d = m.drumById.get(id)!;
      let p = 0;
      for (let i = d.pixelStart; i < d.pixelStart + d.pixelCount; i++) p = Math.max(p, f[i * 4]!, f[i * 4 + 1]!, f[i * 4 + 2]!);
      return p;
    };
    return { kick: peak('kick'), snare: peak('snare') };
  }

  const throughKit = { waitMode: 'dark', drumOffsetMode: 'time', drumOffsetMs: 400, drumSequence: 'snare,kick' };

  it('Splice: THROUGH KIT lights the snare first when the order says so', () => {
    const early = peaksAt('splice', throughKit, 150);
    expect(early.snare, 'snare first').toBeGreaterThan(0.5);
    expect(early.kick, 'kick waits its turn').toBe(0);
    expect(peaksAt('splice', throughKit, 550).kick, 'kick second').toBeGreaterThan(0.5);
  });

  it('Slice: THROUGH KIT follows the same dragged order', () => {
    const early = peaksAt('slice', throughKit, 150);
    expect(early.snare).toBeGreaterThan(0.5);
    expect(early.kick).toBe(0);
  });

  it('without the sequence, the kick (first in the model) goes first as before', () => {
    const { drumSequence: _drop, ...pattern } = throughKit;
    const early = peaksAt('splice', pattern, 150);
    expect(early.kick).toBeGreaterThan(0.5);
    expect(early.snare).toBe(0);
  });
});

/* Found live by Tim: dragging an order did nothing until the Smudge was moved, and setting Smudge
   back to 0 reverted to Up. The compositor caches each splice's layout — including every unit's
   place in the cascades — under a key of the settings that shape it; the dragged sequences were
   missing from that key, so a changed order reused the layout cut for the old one, and only a
   smudge change (which IS in the key) forced a rebuild. The tests above all start a fresh engine
   with the order already set, which is why none of them saw it: it takes an order that CHANGES on a
   running engine, which is exactly what editing in the inspector does. */
describe('changing the order on a running engine', () => {
  function engineFor() {
    const m = buildPixelModel(
      parseKit({
        global: { ledDensityPxPerM: 30, hoopCount: 2, defaultHoopSpacingMm: 50 },
        drums: [
          { id: 'kick', diameterIn: 12, pixelsPerHoop: 4, hoopSpacingMm: 50, origin: { x: 0, y: 0, z: 0 }, rotation: { x: 0, y: 0, z: 0 } },
          { id: 'snare', diameterIn: 12, pixelsPerHoop: 4, hoopSpacingMm: 50, origin: { x: 600, y: 0, z: 0 }, rotation: { x: 0, y: 0, z: 0 } },
        ],
      }),
    );
    const engine = createVoiceBusEngine();
    engine.setModel(m);
    let now = 0;
    const transport = (t: number): TransportState => ({ timeMs: t, beat: 0, bar: 0, beatInBar: 0, bpm: 120, beatsPerBar: 4, playing: true });
    /** Load `over` into a fresh show on the SAME engine, hit the kick, and read both drums `afterMs` later. */
    const hitWith = (kind: 'splice' | 'slice', over: Record<string, unknown>, afterMs: number) => {
      engine.setShow(effectShowOf(sectionOf('s', [spliceEffect(kind, { holdMs: 200, releaseMs: 10, ...over }, 210, 10)])));
      // Let anything from the previous hit die out first, so the frame below is this hit alone.
      for (let t = now + 5; t <= now + 3000; t += 5) engine.tick(t, 5, transport(t));
      now += 3000;
      engine.applyInput({ kind: 'noteOn', drumId: 'kick', zone: '', velocity: 1, timeMs: now } as InputEvent);
      for (let t = now + 5; t <= now + afterMs; t += 5) engine.tick(t, 5, transport(t));
      now += afterMs;
      const f = engine.frame();
      const span = (from: number, to: number) => {
        let p = 0;
        for (let i = from; i < to; i++) p = Math.max(p, f[i * 4]!, f[i * 4 + 1]!, f[i * 4 + 2]!);
        return p;
      };
      const kick = m.drumById.get('kick')!;
      const snare = m.drumById.get('snare')!;
      return {
        kick: span(kick.pixelStart, kick.pixelStart + kick.pixelCount),
        snare: span(snare.pixelStart, snare.pixelStart + snare.pixelCount),
        // Each drum here is two 4-pixel hoops: hoop 1 is the first four pixels, hoop 2 the next.
        kickHoop1: span(kick.pixelStart, kick.pixelStart + 4),
        kickHoop2: span(kick.pixelStart + 4, kick.pixelStart + 8),
      };
    };
    return hitWith;
  }

  const kitChase = { waitMode: 'dark', drumOffsetMode: 'time', drumOffsetMs: 400 };

  it('a dragged drum order takes effect on the next hit, with smudge at 0', () => {
    const hitWith = engineFor();
    // First hit on the pattern order caches the layout...
    expect(hitWith('splice', kitChase, 150).kick, 'Up: kick first').toBeGreaterThan(0.5);
    // ...then the author drags the snare first. Nothing else changes — least of all the smudge.
    const dragged = hitWith('splice', { ...kitChase, drumSequence: 'snare,kick' }, 150);
    expect(dragged.snare, 'snare first now').toBeGreaterThan(0.5);
    expect(dragged.kick, 'kick waits').toBe(0);
  });

  it('a dragged hoop order takes effect on the next hit, with smudge at 0', () => {
    const hitWith = engineFor();
    const hoopChase = { waitMode: 'dark', offsetMode: 'time', offsetMs: 400 };
    const up = hitWith('splice', hoopChase, 150); // caches the Up layout
    expect(up.kickHoop1, 'Up: hoop 1 first').toBeGreaterThan(0.5);
    expect(up.kickHoop2).toBe(0);
    // Drag hoop 2 in front. Per-HOOP brightness, not per drum: either hoop lit gives the drum the
    // same peak, which is how the first version of this test passed while the bug was live.
    const dragged = hitWith('splice', { ...hoopChase, hoopSequence: '2,1' }, 150);
    expect(dragged.kickHoop2, 'hoop 2 first now').toBeGreaterThan(0.5);
    expect(dragged.kickHoop1, 'hoop 1 waits').toBe(0);
  });

  it('a Slice picks up a changed drum order on the next hit too', () => {
    // Slice ranks its drums per frame rather than caching them, so this passes today; it is here so
    // that caching them later cannot quietly bring the same bug to Slice.
    const hitWith = engineFor();
    expect(hitWith('slice', kitChase, 150).kick).toBeGreaterThan(0.5);
    const dragged = hitWith('slice', { ...kitChase, drumSequence: 'snare,kick' }, 150);
    expect(dragged.snare).toBeGreaterThan(0.5);
    expect(dragged.kick).toBe(0);
  });

  it('going back to a pattern takes effect too', () => {
    const hitWith = engineFor();
    hitWith('splice', { ...kitChase, drumSequence: 'snare,kick' }, 150);
    const back = hitWith('splice', kitChase, 150);
    expect(back.kick, 'Up again: kick first').toBeGreaterThan(0.5);
    expect(back.snare).toBe(0);
  });
});
