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

  it('does not treat fixed-decimal formatting as a unit suffix', () => {
    const { container, getByLabelText } = render(Slider, {
      props: { value: 1, min: 0, max: 1, step: 0.01, ariaLabel: 'Saturation', format: (v: number) => v.toFixed(2) },
    });

    expect((getByLabelText('Saturation value') as HTMLInputElement).value).toBe('1');
    expect(container.querySelector('.unit')).toBeNull();
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
});
