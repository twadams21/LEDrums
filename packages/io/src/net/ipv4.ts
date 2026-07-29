/** Pure IPv4 dotted-decimal codecs, shared by the PixLite sweep and the server's
 * network-adapter enumeration (previously four private byte-identical copies). */

/** Parse dotted-decimal IPv4 to an unsigned 32-bit int. Throws on malformed input. */
export function ipToInt(addr: string): number {
  const parts = addr.split('.');
  if (parts.length !== 4) throw new Error(`invalid IPv4 address: ${addr}`);
  let n = 0;
  for (const p of parts) {
    const o = Number(p);
    if (!Number.isInteger(o) || o < 0 || o > 255) throw new Error(`invalid IPv4 address: ${addr}`);
    n = (n * 256 + o) >>> 0;
  }
  return n >>> 0;
}

export function intToIp(n: number): string {
  return [(n >>> 24) & 0xff, (n >>> 16) & 0xff, (n >>> 8) & 0xff, n & 0xff].join('.');
}
