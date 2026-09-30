import { describe, expect, it } from 'vitest';
import { effectIds, tryGetEffect } from '../../effects/registry';
import { listGenerators } from './index';

/** Effect ids still registered but deliberately reachable through no Style (spec "Dropped as
    generators"). The rest of that list (wave-collapse, follow-hoop, strobe, sidechain, burst,
    colour-melody) was deleted from the registry in S08, so it needs no exclusion. */
const EXCLUDED = new Set([
  // Deprecated, but kept: the legacy Composition engine's `defaultProject()` trigger clip still
  // renders `effectId: 'chase'`. It goes when that engine is removed (spec "Out of scope").
  'chase',
]);

describe('Generator Style coverage (spec "Style mapping")', () => {
  const styleEffects = listGenerators().flatMap((g) => g.styles.map((s) => ({ kind: g.id, style: s.id, effectId: s.effectId })));

  it('every Style hosts a registered effect', () => {
    for (const s of styleEffects) expect(tryGetEffect(s.effectId), `${s.kind}/${s.style}`).toBeDefined();
  });

  it('every non-excluded effect is reachable through exactly one Style', () => {
    const counts = new Map<string, number>();
    for (const s of styleEffects) counts.set(s.effectId, (counts.get(s.effectId) ?? 0) + 1);
    for (const id of effectIds()) {
      if (EXCLUDED.has(id)) {
        expect(counts.get(id) ?? 0, `${id} is excluded but has a Style`).toBe(0);
        continue;
      }
      expect(counts.get(id) ?? 0, `${id} must be exactly one Style`).toBe(1);
    }
  });
});
