// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/svelte';
import LevelMeter from './LevelMeter.svelte';

describe('LevelMeter', () => {
  it('exposes a meter role with the clamped percentage', () => {
    render(LevelMeter, { props: { label: 'Bass', value: 0.256 } });
    const m = screen.getByRole('meter', { name: 'Bass' });
    expect(m.getAttribute('aria-valuenow')).toBe('26');
    expect(m.getAttribute('aria-valuetext')).toBe('26%');
    expect(screen.getByText('26%')).toBeTruthy();
  });

  it('clamps out-of-range and non-finite values instead of drawing past the track', () => {
    const { unmount } = render(LevelMeter, { props: { label: 'Level', value: 1.7 } });
    expect(screen.getByRole('meter', { name: 'Level' }).getAttribute('aria-valuenow')).toBe('100');
    unmount();
    render(LevelMeter, { props: { label: 'Level', value: Number.NaN } });
    expect(screen.getByRole('meter', { name: 'Level' }).getAttribute('aria-valuenow')).toBe('0');
  });
});
