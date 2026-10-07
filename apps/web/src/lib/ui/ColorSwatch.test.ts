// @vitest-environment jsdom
import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/svelte';
import { tick } from 'svelte';
import ColorSwatch from './ColorSwatch.svelte';

describe('ColorSwatch', () => {
  it('reflects hue/saturation/brightness as the box colour + hex readout', () => {
    const { container } = render(ColorSwatch, { props: { hue: 0, saturation: 1, brightness: 1 } });
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

  // Tim, 2026-10-07: "When you click on any given colour box you should be able to click on it
  // again to close the window" — the app's own colour window, not the browser's.
  it('a click opens the colour window, a click on the box again closes it', async () => {
    render(ColorSwatch, { props: { hue: 0, saturation: 1, brightness: 1, ariaLabel: 'Kick colour' } });
    const box = screen.getByRole('button', { name: 'Kick colour' });
    await fireEvent.click(box);
    await tick();
    expect(screen.getByRole('slider', { name: 'Hue' })).toBeTruthy();
    expect((screen.getByLabelText('Hex') as HTMLInputElement).value).toBe('#ff0000');
    await fireEvent.click(box);
    await tick();
    expect(screen.queryByRole('slider', { name: 'Hue' })).toBeNull();
  });

  it('decodes a picked colour back to HSV and writes it through onChange — one gesture per pick', async () => {
    const onChange = vi.fn();
    const onGestureStart = vi.fn();
    const onGestureEnd = vi.fn();
    render(ColorSwatch, { props: { hue: 0, saturation: 1, brightness: 1, onChange, onGestureStart, onGestureEnd, ariaLabel: 'C' } });
    const box = screen.getByRole('button', { name: 'C' });
    await fireEvent.click(box);
    await tick();
    expect(onGestureStart).toHaveBeenCalledTimes(1);
    const hex = screen.getByLabelText('Hex') as HTMLInputElement;
    await fireEvent.input(hex, { target: { value: '#00ff00' } });
    await fireEvent.keyDown(hex, { key: 'Enter' });
    expect(onChange).toHaveBeenCalled();
    const hsv = onChange.mock.calls.at(-1)![0] as { h: number; s: number; v: number };
    expect(hsv.h).toBeCloseTo(120, 0);
    expect(hsv.s).toBeCloseTo(1, 5);
    expect(hsv.v).toBeCloseTo(1, 5);
    await fireEvent.click(box);
    await tick();
    expect(onGestureEnd).toHaveBeenCalledTimes(1);
  });

  it('the square and the hue strip take the keyboard', async () => {
    const onChange = vi.fn();
    render(ColorSwatch, { props: { hue: 100, saturation: 0.5, brightness: 0.5, onChange, ariaLabel: 'C' } });
    await fireEvent.click(screen.getByRole('button', { name: 'C' }));
    await tick();
    await fireEvent.keyDown(screen.getByRole('slider', { name: 'Saturation and brightness' }), { key: 'ArrowRight' });
    expect(onChange.mock.calls.at(-1)![0]).toMatchObject({ h: 100, v: 0.5 });
    expect(onChange.mock.calls.at(-1)![0].s).toBeCloseTo(0.52, 5);
    await fireEvent.keyDown(screen.getByRole('slider', { name: 'Hue' }), { key: 'ArrowRight', shiftKey: true });
    expect(onChange.mock.calls.at(-1)![0].h).toBe(115);
  });

  it('shows the modulation badge and a "base" readout only when modulated', () => {
    const plain = render(ColorSwatch, { props: { hue: 0, saturation: 1, brightness: 1 } });
    expect(plain.container.querySelector('.badge')).toBeNull();
    expect(plain.container.querySelector('.hex')?.textContent).toBe('#ff0000');

    const mod = render(ColorSwatch, { props: { hue: 0, saturation: 1, brightness: 1, modulated: true } });
    expect(mod.container.querySelector('.badge')).not.toBeNull();
    expect(mod.container.querySelector('.hex')?.textContent).toBe('base #ff0000');
  });

  it('does not open while disabled', () => {
    render(ColorSwatch, { props: { hue: 0, saturation: 1, brightness: 1, disabled: true, ariaLabel: 'C' } });
    expect((screen.getByRole('button', { name: 'C' }) as HTMLButtonElement).disabled).toBe(true);
  });
});
