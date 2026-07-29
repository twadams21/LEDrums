import { describe, expect, it } from 'vitest';
import { model, ctx, render, litCount, allFinite01 } from '../test-support/effect-harness';
import { type EffectGenerator, type ResolvedParams } from './types';
import { plasma } from './impl/plasma';
import { fire } from './impl/fire';
import { ripplePond } from './impl/ripple-pond';
import { rainbowFlow } from './impl/rainbow-flow';
import { tunnel } from './impl/tunnel';
import { checkerPulse } from './impl/checker-pulse';

const effects: ReadonlyArray<{ effect: EffectGenerator; id: string }> = [
  { effect: plasma, id: 'plasma' },
  { effect: fire, id: 'fire' },
  { effect: ripplePond, id: 'ripple-pond' },
  { effect: rainbowFlow, id: 'rainbow-flow' },
  { effect: tunnel, id: 'tunnel' },
  { effect: checkerPulse, id: 'checker-pulse' },
];

describe('batch-a texture effects', () => {
  for (const { effect, id } of effects) {
    describe(id, () => {
      it('declares the texture category and matching id', () => {
        expect(effect.id).toBe(id);
        expect(effect.category).toBe('texture');
      });

      it('lights at least one pixel at a non-trivial time', () => {
        const m = model(2);
        // Sample a couple of non-zero times so we never accidentally hit a global dark frame.
        const a = litCount(render(effect, m, ctx(m, { timeMs: 1234 })));
        const b = litCount(render(effect, m, ctx(m, { timeMs: 4870 })));
        expect(Math.max(a, b)).toBeGreaterThan(0);
      });

      it('emits only finite channel values in [0,1] across several frames', () => {
        const m = model(2);
        for (const timeMs of [0, 250, 1234, 4870, 9999]) {
          const fb = render(effect, m, ctx(m, { timeMs }));
          expect(allFinite01(fb)).toBe(true);
        }
      });

      it('stays finite and in range under extreme params', () => {
        const m = model(2);
        const spec = effect.paramSpec;
        const lo: ResolvedParams = {};
        const hi: ResolvedParams = {};
        for (const s of spec) {
          if (s.type === 'number') {
            lo[s.key] = s.min ?? 0;
            hi[s.key] = s.max ?? 1;
          }
        }
        for (const params of [lo, hi]) {
          for (const timeMs of [0, 2222, 8888]) {
            const fb = render(effect, m, ctx(m, { timeMs }), params);
            expect(allFinite01(fb)).toBe(true);
          }
        }
      });
    });
  }
});
