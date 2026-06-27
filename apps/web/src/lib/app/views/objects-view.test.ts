import { describe, expect, it } from 'vitest';
import { OBJECT_TYPE_IDS, effectRows, graphRows, presetRows } from './objects-view';
import type { EffectDef, Preset } from '../../trigger-lab/sim';

/* Pure view-models behind the Objects view. The joins (effect→preset-count, preset→effect-name +
   usage), the sort order, and — most importantly — the preset delete-gating (`deletable`, which the
   menu trusts to disable Delete in lockstep with the store) are verified here in isolation. */

/** Minimal fully-typed EffectDef — the builders only read id/name, but a real shape keeps the
    fixtures honest (no casts). */
function eff(id: string, name: string): EffectDef {
  return {
    id,
    name,
    pattern: 'flash',
    busId: '',
    scope: 'kit',
    params: [],
    attackMs: 0,
    sustainMs: 0,
    releaseMs: 0,
  };
}
function pre(id: string, name: string, effectId: string): Preset {
  return { id, name, effectId, params: {} };
}

describe('OBJECT_TYPE_IDS', () => {
  it('is the rail order — Songs · Effects · Graphs · Presets', () => {
    expect(OBJECT_TYPE_IDS).toEqual(['songs', 'effects', 'graphs', 'presets']);
  });
});

describe('effectRows', () => {
  it('counts presets per effect and sorts by name', () => {
    const effects = [eff('swirl', 'Swirl'), eff('aurora', 'Aurora')];
    const presets = [
      pre('swirl:default', 'Default', 'swirl'),
      pre('swirl:wide', 'Wide', 'swirl'),
      pre('aurora:default', 'Default', 'aurora'),
    ];
    const rows = effectRows(effects, presets);
    expect(rows.map((r) => r.name)).toEqual(['Aurora', 'Swirl']); // alphabetical
    expect(rows.find((r) => r.id === 'swirl')!.presetCount).toBe(2);
    expect(rows.find((r) => r.id === 'aurora')!.presetCount).toBe(1);
  });

  it('reports zero presets for an effect nothing targets', () => {
    const rows = effectRows([eff('lonely', 'Lonely')], []);
    expect(rows[0]!.presetCount).toBe(0);
  });
});

describe('presetRows', () => {
  const effects = [eff('swirl', 'Swirl')];

  it('joins the effect name, resolves usage, and sorts by effect then preset name', () => {
    const presets = [pre('swirl:wide', 'Wide', 'swirl'), pre('swirl:fast', 'Fast', 'swirl')];
    const rows = presetRows(presets, effects, (id) => (id === 'swirl:wide' ? 3 : 0));
    expect(rows.map((r) => r.name)).toEqual(['Fast', 'Wide']); // same effect → by preset name
    expect(rows.every((r) => r.effectName === 'Swirl')).toBe(true);
    expect(rows.find((r) => r.id === 'swirl:wide')!.usage).toBe(3);
  });

  it('a plain unused preset is deletable', () => {
    const rows = presetRows([pre('swirl:wide', 'Wide', 'swirl')], effects, () => 0);
    expect(rows[0]!.deletable).toBe(true);
    expect(rows[0]!.isDefault).toBe(false);
  });

  it('a used preset is NOT deletable (gated like the store)', () => {
    const rows = presetRows([pre('swirl:wide', 'Wide', 'swirl')], effects, () => 2);
    expect(rows[0]!.deletable).toBe(false);
  });

  it("a live effect's foundational `:default` is never deletable, even when unused", () => {
    const rows = presetRows([pre('swirl:default', 'Default', 'swirl')], effects, () => 0);
    expect(rows[0]!.isDefault).toBe(true);
    expect(rows[0]!.deletable).toBe(false);
  });

  it("a `:default` whose effect is gone is just an ordinary preset (deletable when unused)", () => {
    const rows = presetRows([pre('ghost:default', 'Default', 'ghost')], effects, () => 0);
    expect(rows[0]!.isDefault).toBe(false); // effect 'ghost' no longer exists
    expect(rows[0]!.deletable).toBe(true);
    expect(rows[0]!.effectName).toBe('ghost'); // falls back to the id when the effect is missing
  });
});

describe('graphRows', () => {
  it('sorts the library by label then key', () => {
    const rows = graphRows([
      { key: 'graph-2', label: 'Zephyr' },
      { key: 'graph-1', label: 'Anthem' },
      { key: 'graph-3', label: 'Anthem' },
    ]);
    expect(rows.map((r) => r.key)).toEqual(['graph-1', 'graph-3', 'graph-2']); // Anthem(1,3) then Zephyr(2)
  });
});
