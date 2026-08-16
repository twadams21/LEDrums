import { describe, expect, it } from 'vitest';
import { listEffects, type ParamSpec } from '@ledrums/core';
import { GENERATOR_EFFECTS } from '../../../trigger-lab/fixtures';
import {
  FAMILY_ORDER,
  familyOf,
  groupParams,
  groupParamsFiltered,
  matchesParamFilter,
} from './param-families';

const spec = (key: string, label = key): ParamSpec => ({ key, label, type: 'number', default: 0 });

describe('familyOf', () => {
  it('matches every hue spelling the library actually declares', () => {
    for (const key of [
      'hue',
      'baseHue',
      'hueSpread',
      'hueSpan',
      'hueOffset',
      'hueDrift',
      'hueShift',
      'hueRange',
      'hueJitter',
      'warmHue',
      'coolHue',
      'flashHue',
      'tipHue',
      'hogHue',
      'haloHue',
      'noteHue',
    ]) {
      expect(familyOf(key), key).toBe('colour');
    }
    expect(familyOf('saturation')).toBe('colour');
    expect(familyOf('brightness')).toBe('colour');
  });

  it('matches all four decay/life spellings', () => {
    for (const key of ['decayMs', 'baseDecayMs', 'lifeMs', 'lifeBeats', 'life']) {
      expect(familyOf(key), key).toBe('life');
    }
  });

  it('matches the speed family', () => {
    for (const key of ['speed', 'fallSpeed', 'rate']) {
      expect(familyOf(key), key).toBe('speed');
    }
  });

  it('leaves genuinely effect-specific and ambiguous keys unmatched', () => {
    // Ambiguous on purpose — the fold is always a safe home (S4 escalation note).
    for (const key of ['width', 'palette', 'amp', 'duckDepth', 'recoverMs', 'delayMs', 'freq', 'trail', 'arms']) {
      expect(familyOf(key), key).toBeNull();
    }
  });
});

describe('groupParams', () => {
  it('orders common families colour → life → speed → level regardless of declaration order', () => {
    const grouped = groupParams([spec('level'), spec('speed'), spec('decayMs'), spec('hue')]);
    expect(grouped.common.map((g) => g.family)).toEqual(['colour', 'life', 'speed', 'level']);
  });

  it('preserves declaration order inside a family', () => {
    const grouped = groupParams([spec('brightness'), spec('hue'), spec('saturation')]);
    expect(grouped.common[0]?.params.map((p) => p.key)).toEqual(['brightness', 'hue', 'saturation']);
  });

  it('drops families with no declared member rather than inventing rows', () => {
    const grouped = groupParams([spec('hue'), spec('width')]);
    expect(grouped.common.map((g) => g.family)).toEqual(['colour']);
    expect(grouped.specific.map((p) => p.key)).toEqual(['width']);
  });

  it('renders each param under its own declared spec, never a substituted one', () => {
    const declared: ParamSpec = { key: 'lifeBeats', label: 'Life', type: 'number', default: 2, min: 0.25, max: 8, unit: 'beats' };
    const grouped = groupParams([declared]);
    expect(grouped.common[0]?.params[0]).toBe(declared);
  });
});

describe('completeness across the whole effect registry', () => {
  const effects = listEffects();

  it('has effects to check', () => {
    expect(effects.length).toBeGreaterThan(30);
  });

  it.each(effects.map((e) => [e.id, e] as const))(
    'common ∪ fold === declared param set for %s',
    (_id, effect) => {
      const grouped = groupParams(effect.paramSpec);
      const seen = [...grouped.commonParams, ...grouped.specific];

      // Nothing vanishes, nothing is duplicated, nothing is invented.
      expect(seen).toHaveLength(effect.paramSpec.length);
      expect(new Set(seen.map((p) => p.key)).size).toBe(seen.length);
      expect([...seen].sort(byKey)).toEqual([...effect.paramSpec].sort(byKey));

      // Every rendered row is the generator's own spec object, not a copy or a stand-in.
      for (const p of seen) expect(effect.paramSpec).toContain(p);
    },
  );

  it('puts a colour row in the common section for every effect that declares one', () => {
    for (const effect of effects) {
      const declaresColour = effect.paramSpec.some((p) => /hue|saturation|brightness/i.test(p.key));
      const grouped = groupParams(effect.paramSpec);
      const hasColourGroup = grouped.common.some((g) => g.family === 'colour');
      expect(hasColourGroup, effect.id).toBe(declaresColour);
    }
  });

  /* The inspector renders the WEB-side mapped specs (`kind`), not core's (`type`). Assert
     completeness on that shape too, so grouping cannot pass on core and drop a row in the UI. */
  it.each(GENERATOR_EFFECTS.map((e) => [e.id, e] as const))(
    'common ∪ fold === rendered param set for %s (mapped EffectDef)',
    (_id, effect) => {
      const grouped = groupParams(effect.params);
      const seen = [...grouped.commonParams, ...grouped.specific];
      expect(seen).toHaveLength(effect.params.length);
      expect(new Set(seen.map((p) => p.key)).size).toBe(seen.length);
      for (const p of effect.params) expect(seen).toContain(p);
    },
  );

  it('never assigns a param to a family whose label it does not carry', () => {
    for (const effect of effects) {
      for (const group of groupParams(effect.paramSpec).common) {
        expect(FAMILY_ORDER).toContain(group.family);
        for (const p of group.params) expect(familyOf(p.key)).toBe(group.family);
      }
    }
  });
});

describe('filtering', () => {
  const params = [spec('hue', 'Hue'), spec('brightness', 'Brightness'), spec('trail', 'Trail')];

  it('matches on label or declared key, case-insensitively', () => {
    expect(matchesParamFilter(params[0]!, 'HU')).toBe(true);
    expect(matchesParamFilter(spec('tailDeg', 'Tail'), 'deg')).toBe(true);
    expect(matchesParamFilter(params[2]!, 'hue')).toBe(false);
  });

  it('an empty query hides nothing', () => {
    const all = groupParamsFiltered(params, '   ');
    expect([...all.commonParams, ...all.specific]).toHaveLength(params.length);
  });

  it('narrows both sections at once', () => {
    const grouped = groupParamsFiltered(params, 'r'); // brightness (common) + trail (fold)
    expect(grouped.commonParams.map((p) => p.key)).toEqual(['brightness']);
    expect(grouped.specific.map((p) => p.key)).toEqual(['trail']);
  });
});

function byKey(a: ParamSpec, b: ParamSpec): number {
  return a.key.localeCompare(b.key);
}
