import { describe, expect, it } from 'vitest';
import type { KitConfig } from '@ledrums/core';
import type { HoopRef, PatchRouting } from '../../patch-routing';
import { addHoop, chainBlockers, gapToIndex, moveHoop, newBlockers, removeHoop, unassignedHoops } from './chain-editor';

const h = (drumId: string, hoop: number): HoopRef => ({ drumId, hoop });

const drum = (id: string, label: string): KitConfig['drums'][number] => ({
  id,
  label,
  color: '#fff',
  diameterIn: 22,
  hoopSpacingMm: 50,
  localSpinDeg: 0,
  startAngleDeg: 0,
  origin: { x: 0, y: 0, z: 0 },
  rotation: { x: 0, y: 0, z: 0 },
});

/** Two drums × 2 hoops (kit-global hoopCount), two outputs. */
const kit = (outputs: KitConfig['outputs'] = []): KitConfig => ({
  version: 1,
  units: 'mm',
  global: { ledDensityPxPerM: 60, hoopCount: 2, defaultHoopSpacingMm: 50, maxPixelsPerOutput: 304, mirror: 'none', expanded: false },
  drums: [drum('kick', 'Kick'), drum('snare', 'Snare')],
  outputs,
});

const routing = (...chains: HoopRef[][]): PatchRouting => ({
  outputs: chains.map((hoops, i) => ({ id: `o${i + 1}`, channelsPerPixel: 3, hoops })),
});

describe('unassignedHoops — the pool', () => {
  it('lists every kit hoop in rig order when nothing is chained', () => {
    expect(unassignedHoops(kit(), routing([], []))).toEqual([h('kick', 1), h('kick', 2), h('snare', 1), h('snare', 2)]);
  });

  it('omits chained hoops, wherever they sit', () => {
    const r = routing([h('kick', 2)], [h('snare', 1)]);
    expect(unassignedHoops(kit(), r)).toEqual([h('kick', 1), h('snare', 2)]);
  });

  it('is empty when every hoop is routed', () => {
    const r = routing([h('kick', 1), h('kick', 2)], [h('snare', 1), h('snare', 2)]);
    expect(unassignedHoops(kit(), r)).toEqual([]);
  });
});

describe('addHoop', () => {
  it('appends to the end of the named output chain', () => {
    const next = addHoop(routing([h('kick', 1)], []), 'o1', h('kick', 2));
    expect(next.outputs[0]!.hoops).toEqual([h('kick', 1), h('kick', 2)]);
    expect(next.outputs[1]!.hoops).toEqual([]);
  });

  it('refuses a hoop already on ANY chain (single-upstream invariant), returning the input', () => {
    const r = routing([h('kick', 1)], []);
    expect(addHoop(r, 'o2', h('kick', 1))).toBe(r);
  });

  it('does not mutate the input routing', () => {
    const r = routing([h('kick', 1)], []);
    addHoop(r, 'o1', h('kick', 2));
    expect(r.outputs[0]!.hoops).toEqual([h('kick', 1)]);
  });
});

describe('removeHoop', () => {
  it('removes the hoop at the index (it re-enters the pool by derivation)', () => {
    const next = removeHoop(routing([h('kick', 1), h('kick', 2)], []), 'o1', 0);
    expect(next.outputs[0]!.hoops).toEqual([h('kick', 2)]);
    expect(unassignedHoops(kit(), next)).toContainEqual(h('kick', 1));
  });

  it('ignores an out-of-range index or unknown output', () => {
    const r = routing([h('kick', 1)], []);
    expect(removeHoop(r, 'o1', 5).outputs[0]!.hoops).toEqual([h('kick', 1)]);
    expect(removeHoop(r, 'nope', 0).outputs[0]!.hoops).toEqual([h('kick', 1)]);
  });
});

describe('moveHoop — `to` is the final resting index', () => {
  const r = () => routing([h('kick', 1), h('kick', 2), h('snare', 1)], []);

  it('moves up (to = from - 1) and down (to = from + 1)', () => {
    expect(moveHoop(r(), 'o1', 2, 1).outputs[0]!.hoops).toEqual([h('kick', 1), h('snare', 1), h('kick', 2)]);
    expect(moveHoop(r(), 'o1', 0, 1).outputs[0]!.hoops).toEqual([h('kick', 2), h('kick', 1), h('snare', 1)]);
  });

  it('clamps the target into the list', () => {
    expect(moveHoop(r(), 'o1', 0, 99).outputs[0]!.hoops).toEqual([h('kick', 2), h('snare', 1), h('kick', 1)]);
    expect(moveHoop(r(), 'o1', 2, -5).outputs[0]!.hoops).toEqual([h('snare', 1), h('kick', 1), h('kick', 2)]);
  });

  it('no-ops on a no-motion move or an out-of-range source', () => {
    const base = r();
    expect(moveHoop(base, 'o1', 1, 1).outputs[0]).toBe(base.outputs[0]);
    expect(moveHoop(base, 'o1', 9, 0).outputs[0]).toBe(base.outputs[0]);
  });
});

describe('gapToIndex — drag gap → final index', () => {
  it('accounts for the dragged row leaving its slot', () => {
    expect(gapToIndex(0, 0)).toBe(0); // dropped back where it started
    expect(gapToIndex(0, 1)).toBe(0); // gap just after itself = same place
    expect(gapToIndex(0, 3)).toBe(2);
    expect(gapToIndex(2, 0)).toBe(0);
  });
});

describe('chainBlockers — the core validation seam, not a fork', () => {
  it('passes a healthy routing (uncovered hoops are warnings, not blockers)', () => {
    expect(chainBlockers(kit(), routing([h('kick', 1)], []))).toEqual([]);
  });

  it('blocks a fan-out routing (unreachable via the reducers, backstop only)', () => {
    const fanOut = routing([h('kick', 1)], [h('kick', 1)]);
    const issues = chainBlockers(kit(), fanOut);
    expect(issues.some((i) => i.code === 'hoop-fan-out')).toBe(true);
  });

  it('blocks a reference to an unknown drum', () => {
    const issues = chainBlockers(kit(), routing([h('ghost', 1)], []));
    expect(issues.some((i) => i.code === 'unknown-drum')).toBe(true);
  });
});

describe('newBlockers — delta validation, so pre-existing damage stays repairable', () => {
  /** The kit SHRUNK to 1 hoop per drum while hoops 2 were still routed — both chains now
      carry an out-of-range blocker the editor never introduced. */
  const shrunk = (): KitConfig => {
    const k = kit();
    return { ...k, global: { ...k.global, hoopCount: 1 } };
  };
  const damaged = () => routing([h('kick', 1), h('kick', 2)], [h('snare', 1), h('snare', 2)]);

  it('the damaged fixture really carries multiple blockers (old gate would wedge)', () => {
    expect(chainBlockers(shrunk(), damaged()).length).toBeGreaterThanOrEqual(2);
  });

  it('a removal that fixes ONE of several blockers introduces nothing — commit allowed', () => {
    const next = removeHoop(damaged(), 'o1', 1); // kick chain repaired, snare still broken
    expect(chainBlockers(shrunk(), next).length).toBeGreaterThan(0);
    expect(newBlockers(shrunk(), damaged(), next)).toEqual([]);
  });

  it('repair converges: removing each out-of-range hoop in turn always commits, ending clean', () => {
    const k = shrunk();
    let current = damaged();
    for (const [outputId, idx] of [['o1', 1], ['o2', 1]] as const) {
      const next = removeHoop(current, outputId, idx);
      expect(newBlockers(k, current, next)).toEqual([]);
      current = next;
    }
    expect(chainBlockers(k, current)).toEqual([]);
  });

  it('a genuinely NEW fan-out still refuses, even from an already-damaged routing', () => {
    // Snare alone shrunk to 1 hoop (per-drum override) so its chain carries the pre-existing
    // blocker while kick stays healthy — a fanned-out kick hoop is then genuinely NEW damage.
    // Unreachable via the reducers (pool model); construct the fan-out next directly.
    const k = kit();
    k.drums = [k.drums[0]!, { ...k.drums[1]!, hoopCount: 1 }];
    const current = routing([h('kick', 1)], [h('snare', 1), h('snare', 2)]);
    const next = routing([h('kick', 1)], [h('snare', 1), h('snare', 2), h('kick', 1)]);
    expect(chainBlockers(k, current).some((i) => i.code === 'hoop-out-of-range')).toBe(true);
    const introduced = newBlockers(k, current, next);
    expect(introduced.some((i) => i.code === 'hoop-fan-out')).toBe(true);
  });

  it('is empty for a healthy edit on a healthy routing', () => {
    const current = routing([h('kick', 1)], []);
    expect(newBlockers(kit(), current, addHoop(current, 'o1', h('kick', 2)))).toEqual([]);
  });
});
