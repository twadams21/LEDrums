import { createSocket, type Socket } from 'node:dgram';
import type { PixelOutput } from './interfaces';

export const SACN_PORT = 5568;

export const ROOT_VECTOR_DATA = 0x00000004;
export const FRAMING_VECTOR_DATA = 0x00000002;
export const DMP_VECTOR_SET_PROPERTY = 0x02;

const ACN_PID = Buffer.from([0x41, 0x53, 0x43, 0x2d, 0x45, 0x31, 0x2e, 0x31, 0x37, 0x00, 0x00, 0x00]);

/** Default multicast group for a sACN universe: 239.255.<hi>.<lo>. */
export function sacnMulticastAddress(universe: number): string {
  return `239.255.${(universe >> 8) & 0xff}.${universe & 0xff}`;
}

/**
 * Encode an ANSI E1.31 (sACN) data packet (pure). Builds the Root, Framing, and DMP
 * layers; property count = 513 (DMX start code + 512 slots) for a full universe.
 */
export function encodeE131(
  universe: number,
  sequence: number,
  data: Uint8Array,
  cid: Uint8Array,
  sourceName = 'LEDrums',
  priority = 100,
): Uint8Array {
  const slots = data.length;
  const total = 126 + slots; // 38 root + 77 framing + 10 dmp header + 1 start code + slots
  const buf = Buffer.alloc(total);

  // --- Root layer ---
  buf.writeUInt16BE(0x0010, 0); // preamble size
  buf.writeUInt16BE(0x0000, 2); // postamble size
  ACN_PID.copy(buf, 4);
  buf.writeUInt16BE(0x7000 | (total - 16), 16); // flags + PDU length
  buf.writeUInt32BE(ROOT_VECTOR_DATA, 18);
  Buffer.from(cid).copy(buf, 22, 0, 16);

  // --- Framing layer (offset 38) ---
  buf.writeUInt16BE(0x7000 | (total - 38), 38);
  buf.writeUInt32BE(FRAMING_VECTOR_DATA, 40);
  buf.write(sourceName.slice(0, 63), 44, 'utf8'); // 64-byte field, null-padded
  buf.writeUInt8(priority, 108);
  buf.writeUInt16BE(0, 109); // sync address
  buf.writeUInt8(sequence & 0xff, 111);
  buf.writeUInt8(0, 112); // options
  buf.writeUInt16BE(universe & 0xffff, 113);

  // --- DMP layer (offset 115) ---
  buf.writeUInt16BE(0x7000 | (total - 115), 115);
  buf.writeUInt8(DMP_VECTOR_SET_PROPERTY, 117);
  buf.writeUInt8(0xa1, 118); // address + data type
  buf.writeUInt16BE(0x0000, 119); // first property address
  buf.writeUInt16BE(0x0001, 121); // address increment
  buf.writeUInt16BE(slots + 1, 123); // property value count (start code + slots)
  buf.writeUInt8(0x00, 125); // DMX start code
  buf.set(data, 126);

  return buf;
}

let cidCounter = 0;
function makeCid(): Uint8Array {
  // Deterministic-ish CID; stable per process is sufficient for a single source.
  const cid = Buffer.alloc(16);
  cid.write('LEDRUMS-SACN', 0, 'ascii');
  cid.writeUInt32BE((Date.now() ^ (cidCounter++)) >>> 0, 12);
  return cid;
}

export interface SacnOptions {
  /** Explicit unicast/broadcast host; when omitted, per-universe multicast is used. */
  host?: string;
  port?: number;
  sourceName?: string;
  /** Outbound multicast interface address (multi-NIC safety). */
  iface?: string;
  /** E1.31 framing-layer priority 1–200 (default 100); higher wins at a merging node. */
  priority?: number;
}

/** sACN (E1.31) pixel output. Uses per-universe multicast unless `host` is given. */
export class SacnOutput implements PixelOutput {
  private socket: Socket;
  private readonly cid = makeCid();
  private readonly opts: SacnOptions;
  private seq = 0;
  private ready = false;

  constructor(opts: SacnOptions = {}) {
    this.opts = opts;
    this.socket = createSocket({ type: 'udp4', reuseAddr: true });
    this.socket.on('error', () => {});
    this.socket.bind(() => {
      try {
        if (opts.iface) this.socket.setMulticastInterface(opts.iface);
        this.socket.setMulticastTTL(16);
      } catch {
        /* ignore */
      }
      this.ready = true;
    });
  }

  nextFrame(): void {
    this.seq = (this.seq + 1) & 0xff;
  }

  send(universe: number, channels: Uint8Array): void {
    if (!this.ready) return;
    const pkt = encodeE131(universe, this.seq, channels, this.cid, this.opts.sourceName, this.opts.priority);
    const host = this.opts.host ?? sacnMulticastAddress(universe);
    this.socket.send(pkt, this.opts.port ?? SACN_PORT, host, () => {});
  }

  close(): void {
    try {
      this.socket.close();
    } catch {
      /* ignore */
    }
  }
}
