import { describe, expect, it } from 'vitest';
import { intToIp, ipToInt } from './ipv4';

describe('ipv4 codecs', () => {
  it('throws on a three-octet address with the exact message the callers rely on', () => {
    expect(() => ipToInt('1.2.3')).toThrow('invalid IPv4 address: 1.2.3');
  });

  it('throws on an out-of-range octet', () => {
    expect(() => ipToInt('1.2.3.256')).toThrow('invalid IPv4 address: 1.2.3.256');
  });

  it('throws on non-numeric octets', () => {
    expect(() => ipToInt('a.b.c.d')).toThrow('invalid IPv4 address: a.b.c.d');
  });

  it('parses the all-ones address unsigned', () => {
    expect(ipToInt('255.255.255.255')).toBe(4294967295);
  });

  it('round-trips a typical address', () => {
    expect(intToIp(ipToInt('192.168.1.50'))).toBe('192.168.1.50');
  });
});
