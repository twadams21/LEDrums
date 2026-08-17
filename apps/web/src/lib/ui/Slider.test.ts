// @vitest-environment jsdom
import { fireEvent, render } from '@testing-library/svelte';
import { beforeAll, describe, expect, it, vi } from 'vitest';
import Slider from './Slider.svelte';

beforeAll(() => {
  class ResizeObserverMock {
    observe() {}
    unobserve() {}
    disconnect() {}
  }

  vi.stubGlobal('ResizeObserver', ResizeObserverMock);
});

describe('Slider', () => {
  it('commits typed values on Enter', async () => {
    const onChange = vi.fn();
    const { getByLabelText } = render(Slider, {
      props: { value: 10, min: 0, max: 100, onChange, ariaLabel: 'Opacity' },
    });

    const input = getByLabelText('Opacity value') as HTMLInputElement;
    await fireEvent.focus(input);
    await fireEvent.input(input, { target: { value: '64' } });
    await fireEvent.keyDown(input, { key: 'Enter' });

    expect(onChange).toHaveBeenLastCalledWith(64);
    expect(input.value).toBe('64');
  });

  it('commits typed values on blur', async () => {
    const onChange = vi.fn();
    const { getByLabelText } = render(Slider, {
      props: { value: 10, min: 0, max: 100, onChange, ariaLabel: 'Opacity' },
    });

    const input = getByLabelText('Opacity value') as HTMLInputElement;
    await fireEvent.input(input, { target: { value: '32' } });
    await fireEvent.blur(input);

    expect(onChange).toHaveBeenLastCalledWith(32);
    expect(input.value).toBe('32');
  });

  it('clamps and rounds to step on commit', async () => {
    const onChange = vi.fn();
    const { getByLabelText } = render(Slider, {
      props: { value: 0.4, min: 0, max: 1, step: 0.25, onChange, ariaLabel: 'Depth' },
    });

    const input = getByLabelText('Depth value') as HTMLInputElement;
    await fireEvent.input(input, { target: { value: '1.8' } });
    await fireEvent.blur(input);
    expect(onChange).toHaveBeenLastCalledWith(1);
    expect(input.value).toBe('1');

    await fireEvent.input(input, { target: { value: '0.62' } });
    await fireEvent.blur(input);
    expect(onChange).toHaveBeenLastCalledWith(0.5);
    expect(input.value).toBe('0.5');
  });

  it('reverts invalid and empty drafts without committing', async () => {
    const onChange = vi.fn();
    const { getByLabelText } = render(Slider, {
      props: { value: 42, min: 0, max: 100, onChange, ariaLabel: 'Level' },
    });

    const input = getByLabelText('Level value') as HTMLInputElement;
    await fireEvent.input(input, { target: { value: 'abc' } });
    await fireEvent.blur(input);
    expect(onChange).not.toHaveBeenCalled();
    expect(input.value).toBe('42');

    await fireEvent.input(input, { target: { value: '' } });
    await fireEvent.blur(input);
    expect(onChange).not.toHaveBeenCalled();
    expect(input.value).toBe('42');
  });

  it('keeps formatted units readable without requiring typed suffixes', () => {
    const { getByLabelText, getByText } = render(Slider, {
      props: { value: 48, min: 0, max: 100, ariaLabel: 'Opacity', format: (v: number) => `${v}%` },
    });

    expect((getByLabelText('Opacity value') as HTMLInputElement).value).toBe('48');
    expect(getByText('%')).toBeTruthy();
  });

  /* F3 item 8: a fixed-decimal format prints `0.60` while the input used to print `0.6`, and
     the old slice-by-length unit inference turned the difference into a stray `0` outside the
     box. The box now shows the formatter's own rendering, so there is no difference to strand. */
  it('shows fixed-decimal formatting IN the box, never as a unit suffix', () => {
    const { container, getByLabelText } = render(Slider, {
      props: { value: 1, min: 0, max: 1, step: 0.01, ariaLabel: 'Saturation', format: (v: number) => v.toFixed(2) },
    });

    expect((getByLabelText('Saturation value') as HTMLInputElement).value).toBe('1.00');
    expect(container.querySelector('.unit')).toBeNull();
  });

  it('keeps a trailing zero inside the box even with a unit beside it', () => {
    const { container, getByLabelText } = render(Slider, {
      props: { value: 0.6, min: 0, max: 1, step: 0.01, ariaLabel: 'Depth', format: (v: number) => `${v.toFixed(2)}×` },
    });

    expect((getByLabelText('Depth value') as HTMLInputElement).value).toBe('0.60');
    expect(container.querySelector('.unit')?.textContent).toBe('×');
  });

  it('hides the unit when the caller carries it on the label instead', () => {
    const { container } = render(Slider, {
      props: { value: 210, min: 0, max: 360, ariaLabel: 'Hue', format: (v: number) => `${v}°`, showUnit: false },
    });

    expect(container.querySelector('.unit')).toBeNull();
  });

  /* A format that TRANSFORMS the value (0…1 depth shown as a percentage) must not put its own
     number in the box — the box commits what it shows. */
  it('keeps the real value in the box when the format rescales it', () => {
    const { getByLabelText } = render(Slider, {
      props: { value: 0.45, min: 0, max: 1, step: 0.01, ariaLabel: 'Amount', format: (v: number) => `${Math.round(v * 100)}%` },
    });

    expect((getByLabelText('Amount value') as HTMLInputElement).value).toBe('0.45');
  });

  it('disables the numeric input with the slider', () => {
    const { getByLabelText } = render(Slider, {
      props: { value: 10, disabled: true, ariaLabel: 'Disabled slider' },
    });

    expect((getByLabelText('Disabled slider value') as HTMLInputElement).disabled).toBe(true);
  });

  it('stays synchronized with external value updates', async () => {
    const { getByLabelText, rerender } = render(Slider, {
      props: { value: 10, min: 0, max: 100, ariaLabel: 'Synced' },
    });

    await rerender({ value: 73, min: 0, max: 100, ariaLabel: 'Synced' });

    expect((getByLabelText('Synced value') as HTMLInputElement).value).toBe('73');
  });

  it('adjusts by one step per wheel tick, and swallows the scroll so the page stays put', async () => {
    const onChange = vi.fn();
    const { container } = render(Slider, {
      props: { value: 10, min: 0, max: 100, onChange, ariaLabel: 'Wheeled' },
    });
    const root = container.querySelector('.slider')!;

    const up = new WheelEvent('wheel', { deltaY: -100, cancelable: true, bubbles: true });
    root.dispatchEvent(up);
    expect(onChange).toHaveBeenLastCalledWith(11);
    expect(up.defaultPrevented).toBe(true);

    root.dispatchEvent(new WheelEvent('wheel', { deltaY: 100, cancelable: true, bubbles: true }));
    expect(onChange).toHaveBeenLastCalledWith(10);
  });

  it('marks the notch and fills from it rather than from min', () => {
    const { container } = render(Slider, {
      props: { value: 0.5, min: -1, max: 1, step: 0.01, notchAt: 0, ariaLabel: 'Bipolar' },
    });

    // The notch sits at the middle of the travel...
    expect((container.querySelector('.notch') as HTMLElement).style.getPropertyValue('--notch')).toBe('50%');
    // ...and the fill is the band BETWEEN it and the thumb (50% → 75%), not 0 → 75%.
    const band = container.querySelector('.band') as HTMLElement;
    expect(band.style.getPropertyValue('--band-start')).toBe('50%');
    expect(band.style.getPropertyValue('--band-size')).toBe('25%');
  });

  it('puts the band on the other side of the notch for a negative value', () => {
    const { container } = render(Slider, {
      props: { value: -0.5, min: -1, max: 1, step: 0.01, notchAt: 0, ariaLabel: 'Bipolar' },
    });

    const band = container.querySelector('.band') as HTMLElement;
    expect(band.style.getPropertyValue('--band-start')).toBe('25%');
    expect(band.style.getPropertyValue('--band-size')).toBe('25%');
  });

  it('leaves a step near the notch exact when no pointer is down — the notch must not trap the thumb', () => {
    const onChange = vi.fn();
    const { container } = render(Slider, {
      props: { value: 0.03, min: -1, max: 1, step: 0.01, notchAt: 0, notchSnap: 0.05, onChange, ariaLabel: 'Bipolar' },
    });

    container
      .querySelector('.slider')!
      .dispatchEvent(new WheelEvent('wheel', { deltaY: 100, cancelable: true, bubbles: true }));

    expect(onChange).toHaveBeenLastCalledWith(0.02);
  });

  it('snaps into the notch while a pointer gesture is in progress, and releases on pointerup', async () => {
    const onChange = vi.fn();
    const { container } = render(Slider, {
      props: { value: 0.03, min: -1, max: 1, step: 0.01, notchAt: 0, notchSnap: 0.05, onChange, ariaLabel: 'Bipolar' },
    });
    const root = container.querySelector('.slider')!;
    const tick = (): void =>
      void root.dispatchEvent(new WheelEvent('wheel', { deltaY: 100, cancelable: true, bubbles: true }));

    await fireEvent.pointerDown(root);
    tick();
    expect(onChange).toHaveBeenLastCalledWith(0);

    await fireEvent.pointerUp(window);
    tick();
    expect(onChange).toHaveBeenLastCalledWith(-0.01);
  });

  it('ignores the wheel when disabled, leaving the page free to scroll', async () => {
    const onChange = vi.fn();
    const { container } = render(Slider, {
      props: { value: 10, disabled: true, onChange, ariaLabel: 'Wheeled' },
    });

    const ev = new WheelEvent('wheel', { deltaY: -100, cancelable: true, bubbles: true });
    container.querySelector('.slider')!.dispatchEvent(ev);

    expect(onChange).not.toHaveBeenCalled();
    expect(ev.defaultPrevented).toBe(false);
  });
});
