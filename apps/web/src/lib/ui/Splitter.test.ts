// @vitest-environment jsdom
import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render } from '@testing-library/svelte';
import Splitter from './Splitter.svelte';

/* The Splitter is CONTROLLED: it never mutates its own `size`; it reports the next
   *clamped* size via onResize on keyboard nudge / Home / End (pointer drag needs a
   real pointer, covered by the live smoke test). This pins the pure clamp + key-map
   seam the callers (AuthorShell rails) rely on to persist sane sizes. */

function mount(props: Partial<Parameters<typeof render>[1]> = {}) {
  const onResize = vi.fn<(n: number) => void>();
  // Scope the lookup to THIS render's container — some tests mount twice, so a
  // body-wide getByRole would see multiple separators.
  const { container } = render(Splitter, {
    props: {
      orientation: 'vertical',
      size: 200,
      onResize,
      min: 100,
      max: 260,
      step: 16,
      label: 'Resize demo',
      ...props,
    },
  });
  const sep = container.querySelector('[role="separator"]') as HTMLElement;
  return { onResize, sep };
}

describe('Splitter', () => {
  it('exposes WAI-ARIA window-splitter semantics', () => {
    const { sep } = mount();
    expect(sep.getAttribute('aria-orientation')).toBe('vertical');
    expect(sep.getAttribute('aria-valuenow')).toBe('200');
    expect(sep.getAttribute('aria-valuemin')).toBe('100');
    expect(sep.getAttribute('aria-valuemax')).toBe('260');
    expect(sep.getAttribute('tabindex')).toBe('0');
  });

  it('nudges by step on the orientation arrow keys', async () => {
    const { onResize, sep } = mount({ size: 200 });
    await fireEvent.keyDown(sep, { key: 'ArrowRight' });
    expect(onResize).toHaveBeenLastCalledWith(216);
    await fireEvent.keyDown(sep, { key: 'ArrowLeft' });
    expect(onResize).toHaveBeenLastCalledWith(184);
  });

  it('clamps a nudge to max / min', async () => {
    const hi = mount({ size: 255, max: 260 });
    await fireEvent.keyDown(hi.sep, { key: 'ArrowRight' }); // 255+16 → 271, clamp 260
    expect(hi.onResize).toHaveBeenLastCalledWith(260);

    const lo = mount({ size: 108, min: 100 });
    await fireEvent.keyDown(lo.sep, { key: 'ArrowLeft' }); // 108-16 → 92, clamp 100
    expect(lo.onResize).toHaveBeenLastCalledWith(100);
  });

  it('Home / End jump to min / max', async () => {
    const { onResize, sep } = mount();
    await fireEvent.keyDown(sep, { key: 'Home' });
    expect(onResize).toHaveBeenLastCalledWith(100);
    await fireEvent.keyDown(sep, { key: 'End' });
    expect(onResize).toHaveBeenLastCalledWith(260);
  });

  it('maps the vertical axis to Right/Left and horizontal to Down/Up', async () => {
    const v = mount({ orientation: 'vertical', size: 200 });
    await fireEvent.keyDown(v.sep, { key: 'ArrowDown' }); // wrong axis — ignored
    expect(v.onResize).not.toHaveBeenCalled();

    const h = mount({ orientation: 'horizontal', size: 200 });
    await fireEvent.keyDown(h.sep, { key: 'ArrowDown' });
    expect(h.onResize).toHaveBeenLastCalledWith(216);
    await fireEvent.keyDown(h.sep, { key: 'ArrowRight' }); // wrong axis — ignored
    expect(h.onResize).toHaveBeenCalledTimes(1);
  });

  it('invert flips the nudge direction (far-anchored pane)', async () => {
    const { onResize, sep } = mount({ invert: true, size: 200 });
    await fireEvent.keyDown(sep, { key: 'ArrowRight' }); // inverted → shrinks
    expect(onResize).toHaveBeenLastCalledWith(184);
  });
});
