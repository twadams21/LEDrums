import { describe, expect, it } from 'vitest';
import { SACN_UNIVERSE_MIN, isUniverseValid, universeDomain } from './universe';
import { sacnMulticastAddress } from './sacn';

describe('universe domains', () => {
  it('rejects sACN universe 0 and out-of-range values', () => {
    expect(isUniverseValid('sacn', 0)).toBe(false);
    expect(isUniverseValid('sacn', 1)).toBe(true);
    expect(isUniverseValid('sacn', 63999)).toBe(true);
    expect(isUniverseValid('sacn', 64000)).toBe(false);
    expect(isUniverseValid('sacn', 1.5)).toBe(false);
  });

  it('accepts the full 15-bit Art-Net range including 0', () => {
    expect(isUniverseValid('artnet', 0)).toBe(true);
    expect(isUniverseValid('artnet', 32767)).toBe(true);
    expect(isUniverseValid('artnet', 32768)).toBe(false);
  });

  it('documents the exact defect: universe 0 multicasts to a dead group', () => {
    expect(sacnMulticastAddress(0)).toBe('239.255.0.0');
    expect(sacnMulticastAddress(SACN_UNIVERSE_MIN)).toBe('239.255.0.1');
  });

  it('exposes the per-protocol domain', () => {
    expect(universeDomain('sacn')).toEqual({ min: 1, max: 63999 });
    expect(universeDomain('artnet')).toEqual({ min: 0, max: 32767 });
  });
});
