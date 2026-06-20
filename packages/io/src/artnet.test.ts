import { describe, expect, it } from 'vitest';
import { encodeArtDmx } from './artnet';

describe('encodeArtDmx', () => {
  it('writes the Art-Net header, opcode, and a 512-channel frame', () => {
    const data = new Uint8Array(512).fill(7);
    const pkt = Buffer.from(encodeArtDmx(7, 3, data));
    expect(pkt.toString('ascii', 0, 7)).toBe('Art-Net');
    expect(pkt[7]).toBe(0); // null terminator
    expect(pkt[8]).toBe(0x00);
    expect(pkt[9]).toBe(0x50); // OpDmx 0x5000, low byte first
    expect(pkt[10]).toBe(0x00);
    expect(pkt[11]).toBe(14); // protocol version
    expect(pkt[12]).toBe(3); // sequence
    expect(pkt.length).toBe(18 + 512);
  });

  it('encodes universe little-endian and length big-endian', () => {
    const pkt = Buffer.from(encodeArtDmx(300, 0, new Uint8Array(512)));
    expect(pkt[14]).toBe(300 & 0xff); // 44
    expect(pkt[15]).toBe((300 >> 8) & 0x7f); // 1
    expect(pkt.readUInt16BE(16)).toBe(512); // length big-endian
  });

  it('pads odd-length data to an even length', () => {
    const pkt = Buffer.from(encodeArtDmx(0, 0, new Uint8Array(3)));
    expect(pkt.readUInt16BE(16)).toBe(4);
    expect(pkt.length).toBe(18 + 4);
  });
});
