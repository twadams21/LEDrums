import { describe, expect, it } from 'vitest';
import {
  packetsPerSecond,
  formatPacketsPerSecond,
  outputStateTone,
  outputStateLabel,
  defaultPort,
  type PacketSample,
} from './output-status';

const sample = (packetsSent: number, atMs: number): PacketSample => ({ packetsSent, atMs });

describe('packetsPerSecond', () => {
  it.each([
    // [name, prev, cur, expected]
    ['null on the first tick (no prior sample)', null, sample(1000, 1000), null],
    ['steady 1000 packets over 1s → 1000/s', sample(0, 0), sample(1000, 1000), 1000],
    ['500 packets over 500ms → 1000/s', sample(4000, 1000), sample(4500, 1500), 1000],
    ['zero delta over a positive interval → 0 (armed, nothing flowing)', sample(200, 0), sample(200, 500), 0],
    ['counter reset (delta < 0) → null (server restart / re-arm)', sample(9000, 1000), sample(12, 1500), null],
    ['non-advancing clock (dt === 0) → null', sample(0, 1000), sample(500, 1000), null],
    ['backwards clock (dt < 0) → null', sample(0, 2000), sample(500, 1000), null],
  ])('%s', (_name, prev, cur, expected) => {
    expect(packetsPerSecond(prev as PacketSample | null, cur as PacketSample)).toBe(expected);
  });

  it('is a pure function of the two samples (fractional rate preserved)', () => {
    // 3 packets over 200ms = 15/s
    expect(packetsPerSecond(sample(10, 800), sample(13, 1000))).toBeCloseTo(15, 10);
  });
});

describe('formatPacketsPerSecond', () => {
  it.each([
    [null, '—'],
    [0, '0/s'],
    [999, '999/s'],
    [1000, '1,000/s'],
    [44_318.7, '44,319/s'], // rounds to nearest integer, thousands-grouped
  ])('formats %p as %p', (rate, expected) => {
    expect(formatPacketsPerSecond(rate as number | null)).toBe(expected);
  });
});

describe('outputStateTone / outputStateLabel', () => {
  it('maps each output state to a tone and label', () => {
    expect(outputStateTone('armed')).toBe('live');
    expect(outputStateTone('dry-run')).toBe('warn');
    expect(outputStateTone('disabled')).toBe('muted');
    expect(outputStateLabel('armed')).toBe('Armed');
    expect(outputStateLabel('dry-run')).toBe('Dry-run');
    expect(outputStateLabel('disabled')).toBe('Disabled');
  });
});

describe('defaultPort', () => {
  it('defaults to the protocol standard port', () => {
    expect(defaultPort('sacn')).toBe(5568);
    expect(defaultPort('artnet')).toBe(6454);
  });
});
