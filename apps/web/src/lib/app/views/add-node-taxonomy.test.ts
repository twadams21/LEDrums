import { describe, expect, it } from 'vitest';
import { voice } from '@ledrums/core';
import { buildAddGroups, EFFECT_GROUP_KEY, MODULATE_GROUP_KEY, MODIFIER_GROUP_PREFIX, ROUTE_GROUP_KEY } from './add-node-taxonomy';

const ids = (key: string): string[] => buildAddGroups().find((g) => g.key === key)?.items.map((i) => i.id) ?? [];

describe('buildAddGroups', () => {
  it('uses the approved Stage 1 categories', () => {
    expect(buildAddGroups().map((g) => g.label)).toEqual(['Effect', 'Route', 'Modulate', 'Modify']);
  });

  it('maps the approved Route taxonomy, with Mix available as a runtime node', () => {
    expect(ids(ROUTE_GROUP_KEY)).toEqual(['random', 'sequence', 'switch', 'chance', 'toggle', 'delay', 'scope', 'mix']);
    const mix = buildAddGroups().find((g) => g.key === ROUTE_GROUP_KEY)!.items.find((i) => i.id === 'mix')!;
    expect(mix.disabled).toBeUndefined();
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

  // INIT-06 S5(c). The Modulate palette is deliberately NOT derived from MOD_SOURCE_KINDS —
  // envelope and lfo each expand into five named PRESETS with distinct ids/labels/hints, so
  // deriving would change the palette. Instead the relationship is asserted as PARITY, which is
  // exactly what the repeated-switches-0002 verdict said this test was missing: every mod-source
  // kind must be REACHABLE from the palette, and no non-source kind may appear there. A seventh
  // source kind added to core with no palette entry now fails here. The id-list assertion above is
  // kept deliberately, so a palette change still has to be made on purpose.
  it('reaches every core mod-source kind from the Modulate group, and no other kind', () => {
    const modulate = buildAddGroups().find((g) => g.key === MODULATE_GROUP_KEY)!;
    const previewKinds = new Set(modulate.items.map((i) => i.previewKind));
    expect(previewKinds).toEqual(new Set(voice.MOD_SOURCE_KINDS));
  });

  it('keeps Effect backed by selectable collections', () => {
    expect(ids(EFFECT_GROUP_KEY).length).toBeGreaterThan(0);
  });

  it('surfaces registered modifiers in the Modify add flow', () => {
    expect(ids(`${MODIFIER_GROUP_PREFIX}all`)).toContain('slice');
  });
});
