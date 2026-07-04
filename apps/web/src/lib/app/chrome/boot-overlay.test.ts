import { describe, expect, it } from 'vitest';
import { computeBootOverlay } from './boot-overlay';
import { initialBootStatus, type BootStatus } from '../boot-reducer';

function status(patch: Partial<BootStatus>): BootStatus {
  return { ...initialBootStatus, ...patch };
}

describe('computeBootOverlay', () => {
  it('shows nothing when inactive (plain browser), even mid-update', () => {
    expect(computeBootOverlay(false, status({ stage: 'updating', progressPct: 40 }))).toBeNull();
    expect(computeBootOverlay(false, status({ stage: 'error' }))).toBeNull();
  });

  it('shows nothing once running / no-tunnel — the app is visible behind', () => {
    expect(computeBootOverlay(true, status({ stage: 'running' }))).toBeNull();
    expect(computeBootOverlay(true, status({ stage: 'no-tunnel' }))).toBeNull();
  });

  it('starting → a spinner overlay, no progress', () => {
    const v = computeBootOverlay(true, status({ stage: 'starting' }));
    expect(v?.variant).toBe('starting');
    expect(v?.progressPct).toBeNull();
    expect(v?.title).toMatch(/Starting/);
  });

  it('updating → carries the streamed progress percentage', () => {
    const v = computeBootOverlay(true, status({ stage: 'updating', progressPct: 42 }));
    expect(v?.variant).toBe('updating');
    expect(v?.progressPct).toBe(42);
  });

  it('updating with unknown progress → indeterminate (null)', () => {
    const v = computeBootOverlay(true, status({ stage: 'updating', progressPct: null }));
    expect(v?.variant).toBe('updating');
    expect(v?.progressPct).toBeNull();
  });

  it('clamps out-of-range progress into 0–100', () => {
    expect(computeBootOverlay(true, status({ stage: 'updating', progressPct: 140 }))?.progressPct).toBe(100);
    expect(computeBootOverlay(true, status({ stage: 'updating', progressPct: -5 }))?.progressPct).toBe(0);
  });

  it('error → the error variant with the failure message', () => {
    const v = computeBootOverlay(true, status({ stage: 'error', message: 'sidecar died' }));
    expect(v?.variant).toBe('error');
    expect(v?.message).toBe('sidecar died');
  });

  it('falls back to sensible copy when no message is supplied', () => {
    expect(computeBootOverlay(true, status({ stage: 'error' }))?.message).toMatch(/failed to start/);
    expect(computeBootOverlay(true, status({ stage: 'updating' }))?.message).toMatch(/Downloading/);
  });
});
