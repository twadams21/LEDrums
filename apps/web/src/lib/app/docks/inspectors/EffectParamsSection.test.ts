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
  ({
    liveParams: () => ({}),
    setParam() {},
    mappingsFor: () => [],
    // the face-expose affordance each row carries since S5
    isParamOnFace: () => false,
    addFaceParam() {},
    removeFaceParam() {},
  }) as unknown as TriggerLab;

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

/* F5 — the envelope replaced the Brightness and Decay sliders, and there is no longer a toggle
   between "sliders" and "curve". These pin the consequences of that: the block is always there
   for an effect that declares a decay, its two axis sliders are the effect's OWN params (moved,
   not duplicated), and merely mounting it authors nothing. */

const decayEffect = (): EffectDef => GENERATOR_EFFECTS.find((e) => e.id === 'gen:whole-drum')!;
const plainEffect = (): EffectDef => GENERATOR_EFFECTS.find((e) => e.id === 'gen:breathing-kit')!;

describe('EffectParamsSection — the decay envelope is the control, always', () => {
  it('shows the curve with no toggle to reach it, for an effect that declares a decay', () => {
    const { container } = mount(decayEffect());
    expect(container.querySelector('[aria-label="Decay envelope"]')).not.toBeNull();
    // The two affordances the toggle used to need are gone, not merely hidden.
    expect(container.querySelector('[aria-label^="Draw "]')).toBeNull();
    expect(container.querySelector('[aria-label^="Detach the curve"]')).toBeNull();
  });

  it('and shows no curve at all for an effect that declares none', () => {
    const { container } = mount(plainEffect());
    expect(container.querySelector('[aria-label="Decay envelope"]')).toBeNull();
  });

  it('puts the decay and brightness sliders inside the block, exactly once each', () => {
    const eff = decayEffect();
    const { container } = mount(eff);
    const block = container.querySelector('.lifeenv') as HTMLElement;
    expect(labels(block)).toEqual(['Decay', 'Brightness']);
    // …and nowhere else: the invariant test above counts every label once, so a row that both
    // moved into the block and stayed in the flat list would fail there. This pins the pair.
    expect(labels(container).filter((l) => l === 'Decay' || l === 'Brightness')).toEqual(['Decay', 'Brightness']);
  });

  it('steps aside under a filter, handing the two scalars back as ordinary rows', async () => {
    const { container, getByLabelText } = mount(decayEffect());
    await fireEvent.input(getByLabelText('Filter parameters'), { target: { value: 'decay' } });
    expect(container.querySelector('[aria-label="Decay envelope"]')).toBeNull();
    expect(labels(container.querySelector('.common') as HTMLElement)).toContain('Decay');
  });

  it('authors nothing by being opened', () => {
    // The seed is what the author is SHOWN, not what they made. A control that corrects its
    // own value as it mounts must not turn that into an edit — with the envelope always on,
    // that would write a curve (and an undo entry) into every effect node merely browsed.
    const store = stubStore();
    const setLifeEnvelope = vi.fn();
    const updateLifeEnvelope = vi.fn();
    Object.assign(store, { setLifeEnvelope, updateLifeEnvelope });
    render(EffectParamsSection, { props: { store, node: node(), eff: decayEffect() } });
    expect(setLifeEnvelope).not.toHaveBeenCalled();
    expect(updateLifeEnvelope).not.toHaveBeenCalled();
  });
});
