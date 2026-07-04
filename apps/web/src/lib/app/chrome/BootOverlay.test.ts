// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/svelte';
import BootOverlay from './BootOverlay.svelte';
import { initialBootStatus, type BootStatus } from '../boot-reducer';

function status(patch: Partial<BootStatus>): BootStatus {
  return { ...initialBootStatus, ...patch };
}

describe('BootOverlay', () => {
  it('renders nothing in a plain browser (inactive), even mid-update', () => {
    const { container } = render(BootOverlay, {
      props: { active: false, status: status({ stage: 'updating', progressPct: 50 }) },
    });
    expect(container.querySelector('.boot-overlay')).toBeNull();
  });

  it('renders nothing once the server is running', () => {
    const { container } = render(BootOverlay, {
      props: { active: true, status: status({ stage: 'running' }) },
    });
    expect(container.querySelector('.boot-overlay')).toBeNull();
  });

  it('starting → shows the spinner takeover, no progress bar', () => {
    const { container } = render(BootOverlay, {
      props: { active: true, status: status({ stage: 'starting' }) },
    });
    expect(screen.getByText('Starting LEDrums')).toBeTruthy();
    expect(container.querySelector('.ring')).not.toBeNull();
    expect(screen.queryByRole('progressbar')).toBeNull();
  });

  it('updating → the bar width reflects the streamed percentage (no separate % label)', () => {
    const { container } = render(BootOverlay, {
      props: { active: true, status: status({ stage: 'updating', progressPct: 42 }) },
    });
    const bar = screen.getByRole('progressbar');
    expect(bar.getAttribute('aria-valuenow')).toBe('42');
    expect(container.querySelector('.fill')?.getAttribute('style')).toContain('42%');
    // The percentage lives in the status message now; there is no redundant label beside the bar.
    expect(container.querySelector('.pct')).toBeNull();
  });

  it('updating → shows a "downloaded / total MB" readout when byte counts are known', () => {
    render(BootOverlay, {
      props: {
        active: true,
        status: status({ stage: 'updating', progressPct: 45, downloadedBytes: 65_000_000, totalBytes: 144_000_000 }),
      },
    });
    expect(screen.getByText('65 / 144 MB')).toBeTruthy();
  });

  it('updating → omits the MB readout when byte counts are unknown', () => {
    const { container } = render(BootOverlay, {
      props: { active: true, status: status({ stage: 'updating', progressPct: 20 }) },
    });
    expect(container.querySelector('.size')).toBeNull();
  });

  it('updating with unknown progress → indeterminate bar, no percentage label', () => {
    const { container } = render(BootOverlay, {
      props: { active: true, status: status({ stage: 'updating', progressPct: null }) },
    });
    expect(screen.getByRole('progressbar')).toBeTruthy();
    expect(container.querySelector('.fill.indeterminate')).not.toBeNull();
    expect(screen.queryByText(/%$/)).toBeNull();
  });

  it('error → shows the failure message and no spinner', () => {
    const { container } = render(BootOverlay, {
      props: { active: true, status: status({ stage: 'error', message: 'the sidecar crashed' }) },
    });
    expect(screen.getByText('the sidecar crashed')).toBeTruthy();
    expect(container.querySelector('.boot-overlay')?.getAttribute('data-variant')).toBe('error');
    expect(container.querySelector('.ring')).toBeNull();
    expect(screen.queryByRole('progressbar')).toBeNull();
  });
});
