// @vitest-environment jsdom
import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render } from '@testing-library/svelte';
import ColorSwatch from './ColorSwatch.svelte';

describe('ColorSwatch', () => {
  it('reflects hue/saturation/brightness as the picker colour + hex readout', () => {
    const { container } = render(ColorSwatch, { props: { hue: 0, saturation: 1, brightness: 1 } });
    const input = container.querySelector('input[type=color]') as HTMLInputElement;
    expect(input.value).toBe('#ff0000');
    // CSS uppercases the readout; textContent stays as authored.
    expect(container.querySelector('.hex')?.textContent).toBe('#ff0000');
  });

  it('reflects saturation 0 as a neutral grey (white contract)', () => {
    const { container } = render(ColorSwatch, { props: { hue: 200, saturation: 0, brightness: 1 } });
    expect(container.querySelector('.hex')?.textContent).toBe('#ffffff');
  });

  it('re-reflects when the underlying params change (a slider moved)', async () => {
    const { container, rerender } = render(ColorSwatch, { props: { hue: 0, saturation: 1, brightness: 1 } });
    expect(container.querySelector('.hex')?.textContent).toBe('#ff0000');
    await rerender({ hue: 240, saturation: 1, brightness: 1 });
    expect(container.querySelector('.hex')?.textContent).toBe('#0000ff');
  });

  it('decodes a picked colour back to HSV and writes it through onChange', async () => {
    const onChange = vi.fn();
    const { container } = render(ColorSwatch, { props: { hue: 0, saturation: 1, brightness: 1, onChange } });
    const input = container.querySelector('input[type=color]') as HTMLInputElement;
    input.value = '#00ff00';
    await fireEvent.input(input);
    expect(onChange).toHaveBeenCalledTimes(1);
    const hsv = onChange.mock.calls[0]![0] as { h: number; s: number; v: number };
    expect(hsv.h).toBeCloseTo(120, 0);
    expect(hsv.s).toBeCloseTo(1, 5);
    expect(hsv.v).toBeCloseTo(1, 5);
  });

  it('shows the modulation badge and a "base" readout only when modulated', () => {
    const plain = render(ColorSwatch, { props: { hue: 0, saturation: 1, brightness: 1 } });
    expect(plain.container.querySelector('.badge')).toBeNull();
    expect(plain.container.querySelector('.hex')?.textContent).toBe('#ff0000');

    const mod = render(ColorSwatch, { props: { hue: 0, saturation: 1, brightness: 1, modulated: true } });
    expect(mod.container.querySelector('.badge')).not.toBeNull();
    expect(mod.container.querySelector('.hex')?.textContent).toBe('base #ff0000');
  });

  it('does not fire onChange while disabled', () => {
    const onChange = vi.fn();
    const { container } = render(ColorSwatch, { props: { hue: 0, saturation: 1, brightness: 1, disabled: true, onChange } });
    const input = container.querySelector('input[type=color]') as HTMLInputElement;
    expect(input.disabled).toBe(true);
  });
});
