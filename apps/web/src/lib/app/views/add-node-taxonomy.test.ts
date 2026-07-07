import { describe, expect, it } from 'vitest';
import { buildAddGroups, EFFECT_GROUP_KEY, MODULATE_GROUP_KEY, ROUTE_GROUP_KEY } from './add-node-taxonomy';

const ids = (key: string): string[] => buildAddGroups().find((g) => g.key === key)?.items.map((i) => i.id) ?? [];

describe('buildAddGroups', () => {
  it('uses the approved Stage 1 categories', () => {
    expect(buildAddGroups().map((g) => g.label)).toEqual(['Effect', 'Route', 'Modulate', 'Modify']);
  });

  it('maps the approved Route taxonomy, with Mix visible but unavailable until runtime lands', () => {
    expect(ids(ROUTE_GROUP_KEY)).toEqual(['random', 'sequence', 'switch', 'chance', 'toggle', 'delay', 'scope', 'mix']);
    const mix = buildAddGroups().find((g) => g.key === ROUTE_GROUP_KEY)!.items.find((i) => i.id === 'mix')!;
    expect(mix.disabled).toBe(true);
  });

  it('maps Modulate presets and explicit live-source nodes', () => {
    expect(ids(MODULATE_GROUP_KEY)).toEqual([
      'envelope:pluck',
      'envelope:stab',
      'envelope:swell',
      'envelope:gate',
      'envelope:custom',
      'lfo:sine',
      'lfo:triangle',
      'lfo:saw',
      'lfo:square',
      'lfo:sample-hold',
      'cc',
      'note',
      'osc',
      'randomMod',
    ]);
  });

  it('keeps Effect backed by selectable collections', () => {
    expect(ids(EFFECT_GROUP_KEY).length).toBeGreaterThan(0);
  });
});
