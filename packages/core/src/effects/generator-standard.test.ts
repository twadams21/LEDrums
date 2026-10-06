/* The Generator standard holds in code (docs/design/generator-standard.md): a Generator that
   declares sections lays them out FORM first, then the standard sections in order, and never has
   a Brightness of its own. A plugin that strays fails here rather than drifting (Tim, 2026-10-06:
   "I want there to be a commonality, or standard flow/order"). Plugins not yet brought in line
   (no sections) are skipped until they are. */
import { describe, expect, it } from 'vitest';
import { generatorParamSpec, listGenerators } from '../effect-chain';
import { GENERATOR_SECTIONS } from './types';

const styles = listGenerators().flatMap((g) => g.styles.map((s) => ({ name: `${g.id}/${s.id}`, spec: generatorParamSpec(g.id, s.id) })));
const sectioned = styles.filter((s) => s.spec.some((p) => p.section));

describe('the Generator standard', () => {
  it('has at least one plugin laid out by it (Dot)', () => {
    expect(sectioned.map((s) => s.name)).toContain('dot/dot');
  });

  for (const { name, spec } of sectioned) {
    it(`${name}: FORM first, then the standard sections in order, each once`, () => {
      expect(spec.every((p) => p.section), 'every param has a section').toBe(true);
      const runs: string[] = [];
      for (const p of spec) if (runs[runs.length - 1] !== p.section) runs.push(p.section!);
      const [form, ...rest] = runs;
      expect(GENERATOR_SECTIONS as readonly string[]).not.toContain(form);
      expect(new Set(rest).size, 'a section appears in one run').toBe(rest.length);
      const order = rest.map((r) => (GENERATOR_SECTIONS as readonly string[]).indexOf(r));
      expect(order.every((i) => i >= 0), `standard sections only: ${rest.join(', ')}`).toBe(true);
      expect([...order].sort((a, b) => a - b)).toEqual(order);
    });

    it(`${name}: no Brightness of its own (the Effect's Opacity does it)`, () => {
      expect(spec.find((p) => p.key === 'brightness')).toBeUndefined();
    });
  }
});
