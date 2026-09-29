import { describe, expect, it } from 'vitest';
import { effectIds, tryGetEffect } from '../../effects/registry';
import { listGenerators } from './index';

/** Effect ids deliberately reachable through no Style (spec "Dropped as generators" + merges). */
const EXCLUDED = new Set([
  'wave-collapse', // merged: radial-wash `mode: 'collapse'` (Wave / Radial)
  'follow-hoop', // merged: whole-drum `hoopDelayMs` (Solid / Simple)
  'strobe', // the Strobe Modifier only
  'sidechain', // future "Duck" modifier
  'chase', 'burst', 'colour-melody', // already deprecated
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
