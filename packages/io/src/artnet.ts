import { createSocket, type Socket } from 'node:dgram';
import type { PixelOutput } from './interfaces';

export const ARTNET_PORT = 6454;

/**
 * Encode an ArtDmx packet (pure, no sockets). Header layout:
 * `Art-Net\0` | opcode 0x5000 (LE) | protVer 14 (BE) | seq | physical |
 * universe (15-bit, LE) | length (BE, even-padded) | data.
 */
export function encodeArtDmx(universe: number, sequence: number, data: Uint8Array): Uint8Array {
  // Length must be even (Art-Net spec); pad a trailing zero byte if needed.
  const len = data.length % 2 === 0 ? data.length : data.length + 1;
  const buf = Buffer.alloc(18 + len);
  buf.write('Art-Net', 0, 'ascii'); // byte 7 stays 0 (zero-filled) => null terminator
  buf[8] = 0x00;
  buf[9] = 0x50; // OpOutput / ArtDmx = 0x5000, low byte first
  buf[10] = 0x00;
  buf[11] = 14; // protocol version, big-endian
  buf[12] = sequence & 0xff;
  buf[13] = 0x00; // physical
  buf[14] = universe & 0xff; // universe LSB
  buf[15] = (universe >> 8) & 0x7f; // universe MSB (15-bit)
  buf.writeUInt16BE(len, 16); // length, big-endian
  buf.set(data, 18);
  return buf;
}

export interface ArtNetOptions {
  host: string;
  port?: number;
  broadcast?: boolean;
}

/** Art-Net pixel output. One per-frame sequence counter is shared across universes. */
export class ArtNetOutput implements PixelOutput {
  private socket: Socket;
  private readonly host: string;
  private readonly port: number;
  private seq = 0;
  private ready = false;

  constructor(opts: ArtNetOptions) {
    this.host = opts.host;
    this.port = opts.port ?? ARTNET_PORT;
    this.socket = createSocket('udp4');
    this.socket.on('error', () => {});
    this.socket.bind(() => {
      if (opts.broadcast) {
        try {
          this.socket.setBroadcast(true);
        } catch {
          /* ignore */
        }
      }
      this.ready = true;
    });
  }

  nextFrame(): void {
    this.seq = (this.seq + 1) & 0xff;
    if (this.seq === 0) this.seq = 1; // 0 disables sequence tracking; keep it active
  }

  send(universe: number, channels: Uint8Array): void {
    if (!this.ready) return;
    const pkt = encodeArtDmx(universe, this.seq, channels);
    this.socket.send(pkt, this.port, this.host, () => {});
  }

  close(): void {
    try {
      this.socket.close();
    } catch {
      /* ignore */
    }
  }
}
