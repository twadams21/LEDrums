import { describe, expect, it } from 'vitest';
import { deviceListEmptyState } from './midi-devices';

describe('deviceListEmptyState', () => {
  it('explains a missing WebMIDI API', () => {
    expect(deviceListEmptyState(false, 'no-api', 0)).toMatch(/doesn’t support WebMIDI/);
  });

  it('points at browser permission for a blocked/denied access', () => {
    expect(deviceListEmptyState(false, 'SecurityError: denied', 0)).toMatch(/permission/i);
    // an unavailable access with no specific reason still reads as a permission issue
    expect(deviceListEmptyState(false, undefined, 0)).toMatch(/permission/i);
  });

  it('invites hot-plugging when available but no devices are present', () => {
    expect(deviceListEmptyState(true, undefined, 0)).toMatch(/Connect one/);
  });

  it('returns null when devices exist (render the list instead)', () => {
    expect(deviceListEmptyState(true, undefined, 2)).toBeNull();
  });
});
