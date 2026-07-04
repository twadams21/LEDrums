import { describe, expect, it } from 'vitest';
import { makeFakeProber } from './fake';
import { expandCidr, expandTargets, sweep } from './sweep';
import type { ControllerIdentity } from './types';

const identity = (host: string, prodName: string): ControllerIdentity => ({
  host,
  prodName,
  nickname: '',
  fwVer: '1.0.0',
  apiVer: [],
  authReqd: false,
});

describe('expandCidr', () => {
  it('expands a /30 to its 2 usable hosts (network + broadcast skipped)', () => {
    expect(expandCidr('192.168.1.0/30')).toEqual(['192.168.1.1', '192.168.1.2']);
  });

  it('expands a /24 to 254 hosts', () => {
    const hosts = expandCidr('10.0.0.0/24');
    expect(hosts).toHaveLength(254);
    expect(hosts[0]).toBe('10.0.0.1');
    expect(hosts[253]).toBe('10.0.0.254');
  });

  it('treats a /32 as a single host', () => {
    expect(expandCidr('192.168.1.7/32')).toEqual(['192.168.1.7']);
  });

  it('refuses a range too large to sweep', () => {
    expect(() => expandCidr('10.0.0.0/8')).toThrow(/too large|max/i);
  });

  it('rejects malformed CIDRs', () => {
    expect(() => expandCidr('10.0.0.0/33')).toThrow();
    expect(() => expandCidr('999.0.0.0/24')).toThrow();
  });
});

describe('expandTargets', () => {
  it('mixes CIDRs and single addresses and dedupes', () => {
    expect(expandTargets(['192.168.1.0/30', '192.168.1.1', '10.0.0.9'])).toEqual([
      '192.168.1.1',
      '192.168.1.2',
      '10.0.0.9',
    ]);
  });
});

describe('sweep', () => {
  it('finds responders without a network, via the injected prober', async () => {
    const prober = makeFakeProber({
      '192.168.1.2': identity('192.168.1.2', 'PixLite A4-S Mk3'),
    });
    const found = await sweep('192.168.1.0/30', prober);
    expect(found).toHaveLength(1);
    expect(found[0]?.host).toBe('192.168.1.2');
  });

  it('ranks PixLite-branded controllers above generic responders', async () => {
    const prober = makeFakeProber({
      '10.0.0.1': identity('10.0.0.1', 'Some Other Device'),
      '10.0.0.2': identity('10.0.0.2', 'PixLite A16-S Mk3'),
    });
    const found = await sweep(['10.0.0.1', '10.0.0.2'], prober);
    expect(found.map((c) => c.host)).toEqual(['10.0.0.2', '10.0.0.1']);
    expect(found[0]?.score).toBeGreaterThan(found[1]!.score);
  });

  it('returns nothing when no host responds', async () => {
    const found = await sweep('192.168.99.0/30', makeFakeProber({}));
    expect(found).toEqual([]);
  });

  it('respects a concurrency limit while covering every host', async () => {
    let inFlight = 0;
    let maxInFlight = 0;
    const seen = new Set<string>();
    const prober = async (host: string): Promise<ControllerIdentity | null> => {
      inFlight++;
      maxInFlight = Math.max(maxInFlight, inFlight);
      seen.add(host);
      await new Promise((r) => setTimeout(r, 2));
      inFlight--;
      return null;
    };
    await sweep('10.0.0.0/24', prober, { concurrency: 4 });
    expect(maxInFlight).toBeLessThanOrEqual(4);
    expect(seen.size).toBe(254);
  });
});
