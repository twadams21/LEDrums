// @vitest-environment jsdom
import { beforeAll, describe, expect, it, vi } from 'vitest';
import { render, fireEvent } from '@testing-library/svelte';
import type { EffectDef, GraphNode, ParamSpec } from '../../../trigger-lab/sim';
import type { TriggerLab } from '../../../trigger-lab/store.svelte';
import { GENERATOR_EFFECTS } from '../../../trigger-lab/fixtures';
import EffectParamsSection from './EffectParamsSection.svelte';
import { paramFold } from './param-disclosure.svelte';

// Slider (bits-ui) observes its track; jsdom has no ResizeObserver (same stub as Slider.test.ts).
beforeAll(() => {
  vi.stubGlobal(
    'ResizeObserver',
    class {
      observe() {}
      unobserve() {}
      disconnect() {}
    },
  );
});

const p = (key: string, label: string, extra: Partial<ParamSpec> = {}): ParamSpec =>
  ({ key, label, kind: 'number', min: 0, max: 1, step: 0.01, default: 0, ...extra }) as ParamSpec;

const effect = (name: string, params: ParamSpec[]): EffectDef =>
  ({ id: name.toLowerCase(), name, params }) as unknown as EffectDef;

const node = (id = 'fx'): GraphNode => ({ id, kind: 'effect', x: 0, y: 0, scope: 'kit' }) as GraphNode;

const stubStore = (): TriggerLab =>
  ({ liveParams: () => ({}), setParam() {}, mappingsFor: () => [] }) as unknown as TriggerLab;

/** Every visible param label, in DOM order. */
const labels = (c: HTMLElement): string[] =>
  [...c.querySelectorAll('.plabel')].map((e) => e.textContent?.trim() ?? '');

const mount = (eff: EffectDef) =>
  render(EffectParamsSection, { props: { store: stubStore(), node: node(), eff } });

describe('EffectParamsSection — progressive disclosure', () => {
  it('puts declared common params up top and effect-specific ones in the fold', () => {
    const eff = effect('Comet Trails', [p('hue', 'Hue'), p('comets', 'Comets'), p('speed', 'Speed')]);
    const { container } = mount(eff);

    const common = container.querySelector('.common');
    expect(common).not.toBeNull();
    expect(labels(common as HTMLElement)).toEqual(['Hue', 'Speed']);

    const fold = container.querySelector('.disclosure');
    expect(fold).not.toBeNull();
    expect(labels(fold as HTMLElement)).toEqual(['Comets']);
    expect(fold?.querySelector('.dlabel')?.textContent).toBe('Comet Trails');
    expect(fold?.querySelector('.count')?.textContent).toBe('1');
  });

  it('binds odd hue spellings by their own declared key — no rename, no drop', () => {
    // Confetti Burst declares baseHue + hueSpan; Temp Sweep declares warmHue. Neither has `hue`.
    const confetti = effect('Confetti Burst', [p('baseHue', 'Base Hue'), p('hueSpan', 'Hue Span'), p('gravity', 'Gravity')]);
    const { container } = mount(confetti);
    expect(labels(container.querySelector('.common') as HTMLElement)).toEqual(['Base Hue', 'Hue Span']);
    expect(labels(container.querySelector('.disclosure') as HTMLElement)).toEqual(['Gravity']);
  });

  it('renders the colour swatch only when hue + saturation + brightness are all declared', () => {
    const withAll = mount(effect('Plasma', [p('hue', 'Hue'), p('saturation', 'Saturation'), p('brightness', 'Brightness')]));
    expect(withAll.container.querySelector('[aria-label="Effect colour"]')).not.toBeNull();

    const withoutHue = mount(effect('Temp Sweep', [p('warmHue', 'Warm Hue'), p('brightness', 'Brightness')]));
    expect(withoutHue.container.querySelector('[aria-label="Effect colour"]')).toBeNull();
  });

  it('shows a fold note rather than an empty fold when an effect declares only common params', () => {
    const { container } = mount(effect('Whole Kit', [p('hue', 'Hue'), p('brightness', 'Brightness')]));
    expect(container.querySelector('.disclosure .none')?.textContent).toContain('no parameters of its own');
  });
});

describe('EffectParamsSection — filter', () => {
  const eff = effect('Comet Trails', [p('hue', 'Hue'), p('comets', 'Comets'), p('speed', 'Speed')]);

  it('narrows both sections at once', async () => {
    const { container, getByLabelText } = mount(eff);
    await fireEvent.input(getByLabelText('Filter parameters'), { target: { value: 'com' } });

    // No common param matches "com", so the section drops out rather than showing an empty header.
    expect(container.querySelector('.common')).toBeNull();
    expect(labels(container.querySelector('.disclosure') as HTMLElement)).toEqual(['Comets']);
  });

  it('matches the declared key, not just the label', async () => {
    const odd = effect('Confetti Burst', [p('baseHue', 'Tint'), p('gravity', 'Gravity')]);
    const { container, getByLabelText } = mount(odd);
    await fireEvent.input(getByLabelText('Filter parameters'), { target: { value: 'basehue' } });
    expect(labels(container.querySelector('.common') as HTMLElement)).toEqual(['Tint']);
  });

  it('steps the colour swatch aside while filtering — it would edit hidden rows', async () => {
    const plasma = effect('Plasma', [p('hue', 'Hue'), p('saturation', 'Saturation'), p('brightness', 'Brightness')]);
    const { container, getByLabelText } = mount(plasma);
    expect(container.querySelector('[aria-label="Effect colour"]')).not.toBeNull();

    await fireEvent.input(getByLabelText('Filter parameters'), { target: { value: 'sat' } });
    expect(container.querySelector('[aria-label="Effect colour"]')).toBeNull();
    // …and the matching row is still reachable under its own key.
    expect(labels(container.querySelector('.common') as HTMLElement)).toEqual(['Saturation']);
  });

  it('says so when nothing matches instead of showing a blank panel', async () => {
    const { container, getByLabelText } = mount(eff);
    await fireEvent.input(getByLabelText('Filter parameters'), { target: { value: 'zzz' } });
    expect(container.querySelector('.empty')?.textContent).toContain('No parameter matches');
  });

  it('forces the fold open while filtering so a match inside it is never hidden', async () => {
    paramFold.open = false;
    try {
      const { container, getByLabelText } = mount(eff);
      expect((container.querySelector('.disclosure') as HTMLDetailsElement).open).toBe(false);

      await fireEvent.input(getByLabelText('Filter parameters'), { target: { value: 'com' } });
      expect((container.querySelector('.disclosure') as HTMLDetailsElement).open).toBe(true);
      // …and filtering did not overwrite what the user left the fold set to.
      expect(paramFold.open).toBe(false);
    } finally {
      paramFold.open = true;
    }
  });
});

describe('EffectParamsSection — nothing vanishes, for every real effect', () => {
  it.each(GENERATOR_EFFECTS.map((e) => [e.id, e] as const))('renders every declared param of %s', (_id, eff) => {
    const { container } = mount(eff);
    const rendered = labels(container).filter((l) => l !== 'Colour');
    // One row per declared param, no duplicates, no invented rows.
    expect(rendered.length).toBe(eff.params.length);
    for (const spec of eff.params) expect(rendered).toContain(spec.label);
  });
});
