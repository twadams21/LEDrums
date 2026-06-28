import { describe, expect, it } from 'vitest';
import { encodeE131, sacnMulticastAddress } from './sacn';

describe('encodeE131', () => {
  it('writes the root, framing, and DMP vectors', () => {
    const pkt = Buffer.from(encodeE131(1, 5, new Uint8Array(512), new Uint8Array(16)));
    expect(pkt.readUInt32BE(18)).toBe(0x00000004); // root vector
    expect(pkt.readUInt32BE(40)).toBe(0x00000002); // framing vector
    expect(pkt[117]).toBe(0x02); // DMP set-property vector
  });

  it('sets the universe and a 513 property count (start code + 512 slots)', () => {
    const pkt = Buffer.from(encodeE131(42, 0, new Uint8Array(512), new Uint8Array(16)));
    expect(pkt.readUInt16BE(113)).toBe(42); // framing-layer universe
    expect(pkt.readUInt16BE(123)).toBe(513); // property count
    expect(pkt[125]).toBe(0x00); // DMX start code
    expect(pkt.length).toBe(126 + 512);
  });

  it('carries the ACN packet identifier and sequence number', () => {
    const pkt = Buffer.from(encodeE131(1, 99, new Uint8Array(3), new Uint8Array(16)));
    expect(pkt.toString('ascii', 4, 12)).toBe('ASC-E1.1');
    expect(pkt[111]).toBe(99);
  });

  it('writes the framing-layer priority (default 100, else the configured value)', () => {
    const def = Buffer.from(encodeE131(1, 0, new Uint8Array(3), new Uint8Array(16)));
    expect(def[108]).toBe(100); // default priority
    const hi = Buffer.from(encodeE131(1, 0, new Uint8Array(3), new Uint8Array(16), 'LEDrums', 200));
    expect(hi[108]).toBe(200); // configured priority reaches the wire
  });

  it('derives the per-universe multicast address', () => {
    expect(sacnMulticastAddress(258)).toBe('239.255.1.2');
    expect(sacnMulticastAddress(1)).toBe('239.255.0.1');
  });
});
