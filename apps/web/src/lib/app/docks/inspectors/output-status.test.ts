import { describe, expect, it } from 'vitest';
import {
  packetsPerSecond,
  formatPacketsPerSecond,
  outputStateTone,
  outputStateLabel,
  defaultPort,
  controllerHeadline,
  universeRxTone,
  universeProtocolLabel,
  formatTempC,
  formatFrameRate,
  formatBankVolts,
  formatEthLinks,
  formatQuietFor,
  type PacketSample,
} from './output-status';
import type { ControllerStatus, ControllerUniverseRx } from '../../../ws/protocol-types';

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

// --- PixLite controller derivations (S48) ----------------------------------

const uni = (overrides: Partial<ControllerUniverseRx> = {}): ControllerUniverseRx => ({
  uniNum: 1,
  protocol: 'sACN',
  receiving: true,
  inGood: 1000,
  inBadSeq: 0,
  ...overrides,
});

const ctrl = (overrides: Partial<ControllerStatus> = {}): ControllerStatus => ({
  host: '192.168.1.50',
  reachable: true,
  identity: { host: '192.168.1.50', prodName: 'PixLite A16-S Mk3', nickname: 'Roof', fwVer: '1.4.2', authReqd: false },
  universes: [uni()],
  rates: { inFrmRate: 40, outFrmRate: 40 },
  health: { tempC: 41 },
  lastSeen: 1000,
  ...overrides,
});

describe('controllerHeadline', () => {
  it('is LOST (loud, alert) when unreachable — even if a stale universe still reads receiving', () => {
    const h = controllerHeadline(ctrl({ reachable: false, universes: [uni({ receiving: true })] }));
    expect(h).toEqual({ tone: 'live', label: 'Lost', alert: true });
  });

  it('waits (calm warn) when reachable but no universe stats have landed yet', () => {
    const h = controllerHeadline(ctrl({ universes: [] }));
    expect(h).toEqual({ tone: 'warn', label: 'Waiting', alert: false });
  });

  it('is NOT RECEIVING (loud, alert) when any universe is not receiving', () => {
    const h = controllerHeadline(ctrl({ universes: [uni({ receiving: true }), uni({ uniNum: 2, receiving: false })] }));
    expect(h).toEqual({ tone: 'live', label: 'Not receiving', alert: true });
  });

  it('is RECEIVING (calm ok) only when every universe is receiving', () => {
    const h = controllerHeadline(ctrl({ universes: [uni({ receiving: true }), uni({ uniNum: 2, receiving: true })] }));
    expect(h).toEqual({ tone: 'ok', label: 'Receiving', alert: false });
  });
});

describe('universeRxTone', () => {
  it('is the loud live tone when a universe is not receiving, calm ok when it is', () => {
    expect(universeRxTone(false)).toBe('live');
    expect(universeRxTone(true)).toBe('ok');
  });
});

describe('universeProtocolLabel', () => {
  it.each([
    ['sACN', 'sACN'],
    ['artNet', 'Art-Net'],
  ] as const)('%s → %s', (proto, label) => {
    expect(universeProtocolLabel(proto)).toBe(label);
  });
});

describe('health / rate formatters', () => {
  it.each([
    [undefined, '—'],
    [41, '41°C'],
    [41.6, '42°C'],
  ])('formatTempC(%p) → %p', (t, expected) => {
    expect(formatTempC(t as number | undefined)).toBe(expected);
  });

  it.each([
    [undefined, '—'],
    [40, '40 Hz'],
    [39.4, '39 Hz'],
  ])('formatFrameRate(%p) → %p', (hz, expected) => {
    expect(formatFrameRate(hz as number | undefined)).toBe(expected);
  });

  it.each([
    [undefined, '—'],
    [[], '—'],
    [[12_100], '12.1 V'],
    [[12_100, 12_000], '12.1 / 12.0 V'],
  ])('formatBankVolts(%p) → %p', (mv, expected) => {
    expect(formatBankVolts(mv as number[] | undefined)).toBe(expected);
  });

  it.each([
    [undefined, '—'],
    [[], '—'],
    [[true, true, false], '2/3 up'],
    [[false], '0/1 up'],
  ])('formatEthLinks(%p) → %p', (links, expected) => {
    expect(formatEthLinks(links as boolean[] | undefined)).toBe(expected);
  });
});

describe('formatQuietFor', () => {
  it.each([
    ['never when lastSeen is null', null, 5000, 'never'],
    ['just now under 1s', 4600, 5000, 'just now'],
    ['just now on a non-positive delta (clock skew)', 6000, 5000, 'just now'],
    ['seconds', 5000, 17_000, '12s ago'],
    ['minutes', 0, 3 * 60_000, '3m ago'],
    ['hours', 0, 2 * 3_600_000, '2h ago'],
  ])('%s', (_name, lastSeen, now, expected) => {
    expect(formatQuietFor(lastSeen as number | null, now)).toBe(expected);
  });
});
