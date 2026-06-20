import { describe, expect, it } from 'vitest';
import { encodeOsc, parseOsc } from './osc';

describe('osc', () => {
  it('round-trips an int, float, and string message', () => {
    const buf = Buffer.from(encodeOsc('/x', [1, 2.5, 'hi']));
    expect(buf.length % 4).toBe(0); // 4-byte aligned
    const e = parseOsc(buf)!;
    expect(e.address).toBe('/x');
    expect(e.args[0]).toBe(1);
    expect(e.args[1]).toBeCloseTo(2.5, 6);
    expect(e.args[2]).toBe('hi');
  });

  it('keeps float32 byte order (big-endian)', () => {
    const e = parseOsc(Buffer.from(encodeOsc('/p/brightness', [0.5])))!;
    expect(e.args[0]).toBeCloseTo(0.5, 6);
  });

  it('round-trips a blob argument', () => {
    const blob = new Uint8Array([9, 8, 7]);
    const e = parseOsc(Buffer.from(encodeOsc('/b', [blob])))!;
    expect(Array.from(e.args[0] as Uint8Array)).toEqual([9, 8, 7]);
  });

  it('parses an address-only message with no args', () => {
    const e = parseOsc(Buffer.from(encodeOsc('/ping')))!;
    expect(e.address).toBe('/ping');
    expect(e.args).toEqual([]);
  });

  it('rejects bundles and garbage cleanly', () => {
    expect(parseOsc(Buffer.from('#bundle\0'))).toBeNull();
    expect(parseOsc(Buffer.from([1, 2, 3]))).toBeNull();
  });
});
