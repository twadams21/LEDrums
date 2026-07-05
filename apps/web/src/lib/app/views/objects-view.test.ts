import { describe, expect, it } from 'vitest';
import {
  OBJECT_TYPE_IDS,
  canvasSceneRows,
  effectRows,
  graphRows,
  librarySongRows,
  presetRows,
  showSongRows,
} from './objects-view';
import type { EffectDef, Preset } from '../../trigger-lab/sim';
import type { Song } from '../setlist';

/* Pure view-models behind the Objects view. The joins (effect→preset-count, preset→effect-name +
   usage), the sort order, and — most importantly — the preset delete-gating (`deletable`, which the
   menu trusts to disable Delete in lockstep with the store) are verified here in isolation. */

/** Minimal fully-typed EffectDef — the builders only read id/name, but a real shape keeps the
    fixtures honest (no casts). */
function eff(id: string, name: string): EffectDef {
  return {
    id,
    name,
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
  it('is the rail order — Songs · Song Library · Effects · Graphs · Presets · Canvas Scenes', () => {
    expect(OBJECT_TYPE_IDS).toEqual(['songs', 'library', 'effects', 'graphs', 'presets', 'canvas-scenes']);
  });
});

describe('canvasSceneRows', () => {
  const scene = (id: string, name: string, elements = 1, lenses = 0) => ({
    id,
    name,
    tags: ['canvas'],
    sampler: { kind: 'cylinder' as const },
    lenses: Array.from({ length: lenses }, () => ({ kind: 'polar' as const })),
    elements: Array.from({ length: elements }, () => ({
      kind: 'stripes' as const,
      angleDeg: 0,
      widthU: 0.2,
      duty: 0.5,
      speedUps: 0.2,
      hue: 140,
      sat: 1,
      softness: 0.08,
    })),
  });

  it('summarizes element/lens counts + sampler and sorts by name', () => {
    const rows = canvasSceneRows([scene('s2', 'Beta', 3, 1), scene('s1', 'Alpha', 2, 0)]);
    expect(rows.map((r) => r.name)).toEqual(['Alpha', 'Beta']);
    expect(rows[0]).toMatchObject({ id: 's1', elementCount: 2, lensCount: 0, sampler: 'cylinder' });
    expect(rows[1]).toMatchObject({ id: 's2', elementCount: 3, lensCount: 1 });
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

function song(id: string, name: string, sectionCount = 1): Song {
  return {
    id,
    name,
    sections: Array.from({ length: sectionCount }, (_, i) => ({
      id: `${id}-s${i}`,
      name: `Section ${i}`,
      graphs: [],
      looks: {},
    })),
  };
}

describe('showSongRows', () => {
  it('marks local songs and library references by origin, in resolved order', () => {
    const local = [song('song-1', 'Opener'), song('song-2', 'Bridge')];
    // resolveSongRefs returns [...local, ...referenced]; the tail is a library ref.
    const resolved = [...local, song('song-9', 'Anthem (lib)', 3)];
    const rows = showSongRows(local, resolved);
    expect(rows.map((r) => r.origin)).toEqual(['local', 'local', 'reference']);
    expect(rows.map((r) => r.name)).toEqual(['Opener', 'Bridge', 'Anthem (lib)']);
    expect(rows.find((r) => r.id === 'song-9')!.sectionCount).toBe(3);
  });

  it('is all-local when the show references nothing', () => {
    const local = [song('song-1', 'Only')];
    const rows = showSongRows(local, local);
    expect(rows).toHaveLength(1);
    expect(rows[0]!.origin).toBe('local');
  });
});

describe('librarySongRows', () => {
  const list = [
    { id: 'song-1', name: 'Shared', usedBy: [{ id: 'show-a', name: 'Show A' }, { id: 'show-b', name: 'Show B' }] },
    { id: 'song-2', name: 'Orphan', usedBy: [] as { id: string; name: string }[] },
  ];

  it('carries the used-by count/names and gates delete like the store', () => {
    const rows = librarySongRows(list, []);
    const shared = rows.find((r) => r.id === 'song-1')!;
    expect(shared.usedByCount).toBe(2);
    expect(shared.usedByNames).toEqual(['Show A', 'Show B']);
    expect(shared.deletable).toBe(false); // referenced → delete blocked
    const orphan = rows.find((r) => r.id === 'song-2')!;
    expect(orphan.usedByCount).toBe(0);
    expect(orphan.deletable).toBe(true);
  });

  it('flags rows the active show already references (Import → Detach)', () => {
    const rows = librarySongRows(list, ['song-1']);
    expect(rows.find((r) => r.id === 'song-1')!.inThisShow).toBe(true);
    expect(rows.find((r) => r.id === 'song-2')!.inThisShow).toBe(false);
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
