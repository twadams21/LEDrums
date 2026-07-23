import { describe, expect, it } from 'vitest';
import {
  CURRENT_KIT_VERSION,
  logicalOutputCount,
  parseKit,
  reconcileOutputs,
  type KitConfig,
  type OutputConfig,
} from './kit-schema';

// Outputs are a STATIC rig shape: exactly `logicalOutputCount` physical ports (4 normal /
// 8 expanded), driven solely by the controller `expanded` toggle — never freely add/deleted.
// reconcileOutputs is the single enforcer of that count, self-healing any drifted `kit.outputs`
// (the drummer's 3-in-expanded corruption from the old delete keypath).

const global = { ledDensityPxPerM: 100, hoopCount: 4, defaultHoopSpacingMm: 50 };
const drums = [
  { id: 'A', diameterIn: 6, hoopSpacingMm: 50, hoopCount: 4, pixelsPerHoop: 12, origin: { x: 0, y: 0, z: 0 }, rotation: { x: 0, y: 0, z: 0 } },
];

/** A wired output carrying one hoop run on drum A (real geometry, so the kit parses + compiles). */
const wired = (id: string): OutputConfig => ({ id, channelsPerPixel: 3, segments: [{ drumId: 'A', hoopStart: 1, hoopEnd: 4 }] });

/** Build a valid kit at the current version with an explicit `expanded` mode + output list. */
const kitWith = (expanded: boolean, outputs: OutputConfig[]): KitConfig =>
  parseKit({ version: CURRENT_KIT_VERSION, global: { ...global, expanded }, drums, outputs });

describe('reconcileOutputs — output count is derived from the controller mode', () => {
  it('grows 3 → 8 in expanded mode, preserving existing outputs in order', () => {
    const kit = kitWith(true, [wired('a'), wired('b'), wired('c')]);
    const out = reconcileOutputs(kit).outputs;
    expect(out).toHaveLength(8);
    expect(out.slice(0, 3).map((o) => o.id)).toEqual(['a', 'b', 'c']);
    // The kept outputs keep their wiring untouched.
    expect(out[0]!.segments).toEqual([{ drumId: 'A', hoopStart: 1, hoopEnd: 4 }]);
    // Appended ports are empty (unwired) — inert until the user wires them.
    expect(out.slice(3).every((o) => o.segments.length === 0)).toBe(true);
  });

  it('shrinks 8 → 4 in normal mode, keeping the first 4 in order', () => {
    const kit = kitWith(false, Array.from({ length: 8 }, (_u, i) => wired(`o${i + 1}`)));
    const out = reconcileOutputs(kit).outputs;
    expect(out).toHaveLength(4);
    expect(out.map((o) => o.id)).toEqual(['o1', 'o2', 'o3', 'o4']);
  });

  it('is identity (same array ref) when already at the canonical count', () => {
    const kit = kitWith(false, Array.from({ length: 4 }, (_u, i) => wired(`o${i + 1}`)));
    const result = reconcileOutputs(kit);
    expect(result).toBe(kit); // unchanged — no needless reallocation / render churn
    expect(result.outputs).toHaveLength(4);
  });

  it('grows empty → 4 in normal mode (all seeded empty)', () => {
    const kit = kitWith(false, []);
    const out = reconcileOutputs(kit).outputs;
    expect(out).toHaveLength(4);
    expect(out.every((o) => o.segments.length === 0 && o.channelsPerPixel === 3)).toBe(true);
    // Deterministic, collision-free ids over the final 1-based count.
    expect(out.map((o) => o.id)).toEqual(['output:1', 'output:2', 'output:3', 'output:4']);
  });

  it('matches logicalOutputCount for both modes and re-parses cleanly (empty ports are schema-valid)', () => {
    for (const expanded of [false, true]) {
      const kit = kitWith(expanded, []);
      const reconciled = reconcileOutputs(kit);
      expect(reconciled.outputs).toHaveLength(logicalOutputCount(kit));
      // The reconciled kit (empty ports included) survives a serialize → parse round-trip.
      expect(() => parseKit(JSON.parse(JSON.stringify(reconciled)))).not.toThrow();
    }
  });

  it('grows sparse survivors (output:1,2,8) → 8 with UNIQUE ids and the full count (no id collision)', () => {
    // The stuck-state defect: the old minting appended `output:${len+i+1}` (→ output:4..8),
    // duplicating the surviving `output:8` and leaving the count pinned below target forever.
    const kit = kitWith(true, [wired('output:1'), wired('output:2'), wired('output:8')]);
    const out = reconcileOutputs(kit).outputs;
    expect(out).toHaveLength(8);
    const ids = out.map((o) => o.id);
    expect(new Set(ids).size).toBe(8); // every id unique — no duplicate to stick the count
    // Survivors kept verbatim in order; appended ports take the lowest unused output:<n> (skips 8).
    expect(ids.slice(0, 3)).toEqual(['output:1', 'output:2', 'output:8']);
    expect(ids.slice(3)).toEqual(['output:3', 'output:4', 'output:5', 'output:6', 'output:7']);
    // A second reconcile is now a no-op — the count reached target, so it self-heals for good.
    expect(reconcileOutputs(reconcileOutputs(kit)).outputs).toHaveLength(8);
  });

  it('is idempotent — reconciling twice yields the same count', () => {
    const kit = kitWith(true, [wired('a')]);
    const once = reconcileOutputs(kit);
    const twice = reconcileOutputs(once);
    expect(twice.outputs).toHaveLength(8);
    expect(twice.outputs.map((o) => o.id)).toEqual(once.outputs.map((o) => o.id));
  });
});
