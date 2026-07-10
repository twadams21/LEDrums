import { describe, expect, it } from 'vitest';
import { listNetworkAdapters, recommendControllerIp, type NicInfo } from './network-adapters';

describe('recommendControllerIp', () => {
  it('recommends a memorable high host on a /24, avoiding the PC and .1/.0/.255', () => {
    expect(recommendControllerIp('192.168.1.10', '255.255.255.0')).toBe('192.168.1.50');
  });

  it('avoids recommending the PC\'s own address', () => {
    // PC is .50 → the first offset (.50) collides, so it steps to the next (.100).
    expect(recommendControllerIp('192.168.1.50', '255.255.255.0')).toBe('192.168.1.100');
  });

  it('stays inside the subnet for a non-/24 mask', () => {
    // /16: network 10.0.0.0, network+50 = 10.0.0.50 (in range, not the PC).
    expect(recommendControllerIp('10.0.5.9', '255.255.0.0')).toBe('10.0.0.50');
  });

  it('handles a small /29 (6 usable hosts)', () => {
    // 192.168.1.8/29 → hosts .9–.14. PC is .9. The high offsets (50,100,…) fall outside the block;
    // the final offset (network+2 = .10) lands in range and isn't the PC → .10.
    const ip = recommendControllerIp('192.168.1.9', '255.255.255.248');
    expect(ip).toBe('192.168.1.10');
  });

  it('returns the PC address unchanged on a /31 (no room for a second host)', () => {
    expect(recommendControllerIp('192.168.1.0', '255.255.255.254')).toBe('192.168.1.0');
  });

  it('recommendation is always a usable host, never network/broadcast/self', () => {
    const rec = recommendControllerIp('172.16.4.4', '255.255.255.0');
    expect(rec).not.toBe('172.16.4.0'); // network
    expect(rec).not.toBe('172.16.4.255'); // broadcast
    expect(rec).not.toBe('172.16.4.4'); // self
  });
});

describe('listNetworkAdapters', () => {
  const fake = (nics: Record<string, NicInfo[]>) => () => nics;

  it('maps a non-internal IPv4 NIC to its subnet + recommended IP', () => {
    const adapters = listNetworkAdapters(
      fake({
        Ethernet: [
          { family: 'IPv4', internal: false, address: '192.168.1.10', netmask: '255.255.255.0', cidr: '192.168.1.10/24' },
        ],
      }),
    );
    expect(adapters).toEqual([
      {
        name: 'Ethernet',
        address: '192.168.1.10',
        netmask: '255.255.255.0',
        cidr: '192.168.1.10/24',
        subnet: '192.168.1.0/24',
        recommendedIp: '192.168.1.50',
      },
    ]);
  });

  it('skips loopback, IPv6, and address-less entries', () => {
    const adapters = listNetworkAdapters(
      fake({
        lo: [{ family: 'IPv4', internal: true, address: '127.0.0.1', netmask: '255.0.0.0' }],
        eth0: [
          { family: 'IPv6', internal: false, address: 'fe80::1', netmask: 'ffff::' },
          { family: 'IPv4', internal: false, address: '10.0.0.5', netmask: '255.255.255.0', cidr: '10.0.0.5/24' },
        ],
      }),
    );
    expect(adapters.map((a) => a.address)).toEqual(['10.0.0.5']);
  });

  it('derives the CIDR prefix from the netmask when cidr is absent (legacy Node)', () => {
    const [a] = listNetworkAdapters(
      fake({ en0: [{ family: 4, internal: false, address: '192.168.0.20', netmask: '255.255.255.0' }] }),
    );
    expect(a?.cidr).toBe('192.168.0.20/24');
    expect(a?.subnet).toBe('192.168.0.0/24');
  });

  it('skips a NIC whose address/mask will not parse instead of throwing', () => {
    const adapters = listNetworkAdapters(
      fake({
        bad: [{ family: 'IPv4', internal: false, address: 'not-an-ip', netmask: '255.255.255.0' }],
        good: [{ family: 'IPv4', internal: false, address: '192.168.9.9', netmask: '255.255.255.0', cidr: '192.168.9.9/24' }],
      }),
    );
    expect(adapters.map((a) => a.address)).toEqual(['192.168.9.9']);
  });
});
