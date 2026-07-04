import { describe, expect, it } from 'vitest';
import { EFFECT_ALIASES, isAliasedEffectId, resolveEffectAlias } from './aliases';
import { listEffects, tryGetEffect } from './registry';

describe('effect aliases (U3 populates the map)', () => {
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

  // Alias keys/values are LAB effect ids (`gen:<coreId>` for generator-backed effects, bare
  // lab ids for the retired pattern effects) — see aliases.ts. A `gen:`-prefixed target must
  // therefore name a live, non-deprecated CORE generator.
  it('every gen:-namespaced alias target is a live, non-deprecated core generator', () => {
    for (const newId of Object.values(EFFECT_ALIASES)) {
      if (!newId.startsWith('gen:')) continue;
      const coreId = newId.slice('gen:'.length);
      const gen = tryGetEffect(coreId);
      expect(gen, `${newId} → core generator ${coreId} does not exist`).toBeDefined();
      expect(gen!.deprecated, `${newId} target ${coreId} is itself deprecated`).toBeUndefined();
    }
  });

  it('every deprecated core generator names a live replacement', () => {
    for (const eff of listEffects()) {
      if (!eff.deprecated) continue;
      const target = tryGetEffect(eff.deprecated.replacedBy);
      expect(target, `${eff.id} → ${eff.deprecated.replacedBy} missing`).toBeDefined();
      expect(target!.deprecated, `${eff.id} replacement ${eff.deprecated.replacedBy} is itself deprecated`).toBeUndefined();
    }
  });

  it('migrates a show that references retired pattern + generator ids (hydrate migration)', () => {
    // The exact rewrites a stale show document's play-node effectIds go through.
    expect(resolveEffectAlias('whole')).toBe('gen:whole-drum'); // pattern flash
    expect(resolveEffectAlias('chase')).toBe('gen:chase-bands'); // pattern chase
    expect(resolveEffectAlias('rip')).toBe('gen:ripple-3d'); // pattern ripple
    expect(resolveEffectAlias('wash')).toBe('gen:radial-wash'); // pattern radial
    expect(resolveEffectAlias('swirl')).toBe('gen:helix');
    expect(resolveEffectAlias('strobe')).toBe('gen:strobe');
    // Retired / merged generators.
    expect(resolveEffectAlias('gen:chase')).toBe('gen:chase-bands');
    expect(resolveEffectAlias('gen:burst')).toBe('gen:radial-wash');
    expect(resolveEffectAlias('gen:colour-melody')).toBe('gen:whole-drum');
  });
});
