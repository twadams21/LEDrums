/* The Generator standard holds in code (docs/design/generator-standard.md): every Generator lays
   its settings out FORM first (when it has any), then the standard sections in order, and never
   has a Brightness slider of its own — a brightness is the darkness of a Colour box, never a
   separate setting. A plugin that strays fails here rather than drifting (Tim, 2026-10-06: "I want
   there to be a commonality, or standard flow/order"). */
import { describe, expect, it } from 'vitest';
import { generatorParamSpec, listGenerators } from '../effect-chain';
import { GENERATOR_SECTIONS } from './types';

const styles = listGenerators().flatMap((g) => g.styles.map((s) => ({ name: `${g.id}/${s.id}`, spec: generatorParamSpec(g.id, s.id) })));
const STANDARD = GENERATOR_SECTIONS as readonly string[];

describe('the Generator standard', () => {
  it('covers every Style (the sweep, 2026-10-07)', () => {
    expect(styles.filter((s) => s.spec.length && !s.spec.every((p) => p.section)).map((s) => s.name)).toEqual([]);
  });

  for (const { name, spec } of styles) {
    if (!spec.length) continue;
    it(`${name}: FORM first, then the standard sections in order, each once`, () => {
      const runs: string[] = [];
      for (const p of spec) if (runs[runs.length - 1] !== p.section) runs.push(p.section!);
      const rest = STANDARD.includes(runs[0]!) ? runs : runs.slice(1);
      expect(new Set(rest).size, `a section appears in one run: ${runs.join(', ')}`).toBe(rest.length);
      const order = rest.map((r) => STANDARD.indexOf(r));
      expect(order.every((i) => i >= 0), `standard sections only: ${rest.join(', ')}`).toBe(true);
      expect([...order].sort((a, b) => a - b)).toEqual(order);
    });

    it(`${name}: no Brightness slider (a Colour box's darkness, or the Effect's Opacity)`, () => {
      const brightness = spec.find((p) => p.key === 'brightness');
      if (!brightness) return;
      // Behind a colour, off the card — still a setting a Control can drive.
      const owner = spec.find((p) => p.key === brightness.partOf);
      expect(owner?.section, 'brightness sits behind a COLOUR setting').toBe('Colour');
    });

    it(`${name}: one word per idea — no Hue … names, Tail, Afterglow, Jitter or Fall speed`, () => {
      const banned = /^(hue |base hue|.* hue$|tail|afterglow|.*jitter|fall speed|decay)$/i;
      expect(spec.filter((p) => !p.partOf && banned.test(p.label)).map((p) => p.label)).toEqual([]);
    });
  }
});
