// @vitest-environment jsdom
import { afterEach, expect, it, vi } from 'vitest';
import { render } from '@testing-library/svelte';
import { tick } from 'svelte';
import { tryGetEffect } from '@ledrums/core';
import EffectThumb from './EffectThumb.svelte';

const canvasContext = Object.getOwnPropertyDescriptor(HTMLCanvasElement.prototype, 'getContext')!;
afterEach(() => {
  Object.defineProperty(HTMLCanvasElement.prototype, 'getContext', canvasContext);
  vi.restoreAllMocks(); vi.unstubAllGlobals();
});

it('keeps mutable generator scratch opaque during real reduced-motion renders and prop/fire updates', async () => {
  vi.stubGlobal('matchMedia', () => ({ matches: true, addEventListener: vi.fn(), removeEventListener: vi.fn() }));
  const context = { fillRect: vi.fn(), drawImage: vi.fn(), beginPath: vi.fn(), ellipse: vi.fn(), stroke: vi.fn() };
  // Supply only the real 2D path exercised here; other context kinds remain unavailable.
  // Avoid treating an overloaded getContext spy as its final WebGPU overload.
  Object.defineProperty(HTMLCanvasElement.prototype, 'getContext', {
    configurable: true, value: (kind: string) => kind === '2d' ? context : null,
  });
  const generator = tryGetEffect('spatial-field')!;
  const create = generator.createState!;
  const realRender = generator.render;
  const allocated: unknown[] = [];
  const stateful = generator as typeof generator & { createState: typeof create };
  vi.spyOn(stateful, 'createState').mockImplementation((model) => {
    const state = create(model); allocated.push(state); return state;
  });
  const renders = vi.spyOn(generator, 'render').mockImplementation((...args) => {
    // Fail FAST before the real scratch writes if Svelte wrapped this in a deep proxy.
    // Otherwise a static draw subscribes to scratch and schedules itself forever, hanging CI.
    expect(allocated.includes(args[3]), 'core render state must not become a reactive proxy').toBe(true);
    return realRender(...args);
  });
  const view = render(EffectThumb, { generatorId: 'spatial-field', params: { warp: 0.75, detail: 0.65 }, triggered: true, triggerAt: null });
  try {
    expect(renders).toHaveBeenCalled();
    expect(context.fillRect).toHaveBeenCalled();
    const initial = renders.mock.calls.length;
    await tick();
    expect(renders.mock.calls.length).toBe(initial); // static really means static
    await view.rerender({ params: { warp: 0.2, detail: 0.8 } });
    expect(renders.mock.calls.length).toBeGreaterThan(initial);
    const states = allocated.length;
    await view.rerender({ triggerAt: 1000 });
    expect(allocated.length).toBeGreaterThan(states);
    const settled = renders.mock.calls.length;
    await tick();
    expect(renders.mock.calls.length).toBe(settled);
    expect(settled).toBeLessThan(10);
  } finally { view.unmount(); }
});
