import { describe, expect, it } from 'vitest';
import { EFFECT_ALIASES, isAliasedEffectId, resolveEffectAlias } from './aliases';
import { effectIds } from './registry';

describe('effect aliases (mechanism — U3 populates the map)', () => {
  it('passes unknown / unaliased ids through unchanged', () => {
    expect(resolveEffectAlias('starfield')).toBe('starfield');
    expect(resolveEffectAlias('does-not-exist')).toBe('does-not-exist');
  });

  it('every alias target resolves to a live (non-alias) id', () => {
    for (const [oldId, newId] of Object.entries(EFFECT_ALIASES)) {
      expect(oldId, `${oldId} should not alias to itself`).not.toBe(newId);
      // Final resolution must terminate at a non-aliased id (no dangling / cyclic chains).
      const final = resolveEffectAlias(oldId);
      expect(isAliasedEffectId(final), `${oldId} → ${final} still aliased`).toBe(false);
    }
  });

  it('a registered id is never also an alias key (retired ids are removed from the registry)', () => {
    const registered = new Set(effectIds());
    for (const oldId of Object.keys(EFFECT_ALIASES)) {
      expect(registered.has(oldId), `${oldId} is both registered and aliased`).toBe(false);
    }
  });
});
