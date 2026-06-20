import { createSocket, type Socket } from 'node:dgram';
import type { EventInput, OscArg, OscEvent } from './interfaces';

export const OSC_DEFAULT_PORT = 9000;

const align4 = (n: number): number => (n + 3) & ~3;

function readString(buf: Buffer, offset: number): { value: string; next: number } {
  let end = offset;
  while (end < buf.length && buf[end] !== 0) end++;
  return { value: buf.toString('ascii', offset, end), next: align4(end + 1) };
}

/** Parse an OSC 1.0 message (big-endian, 4-byte aligned). Returns null for bundles/garbage. */
export function parseOsc(buf: Buffer): OscEvent | null {
  if (buf.length < 4 || buf[0] === 0x23 /* '#' bundle */) return null;
  try {
    let off = 0;
    const addr = readString(buf, off);
    off = addr.next;
    if (off >= buf.length || buf[off] !== 0x2c /* ',' */) {
      return { address: addr.value, args: [] };
    }
    const tags = readString(buf, off);
    off = tags.next;
    const args: OscArg[] = [];
    for (const tag of tags.value.slice(1)) {
      switch (tag) {
        case 'i':
          args.push(buf.readInt32BE(off));
          off += 4;
          break;
        case 'f':
          args.push(buf.readFloatBE(off));
          off += 4;
          break;
        case 's': {
          const s = readString(buf, off);
          args.push(s.value);
          off = s.next;
          break;
        }
        case 'b': {
          const size = buf.readInt32BE(off);
          args.push(new Uint8Array(buf.subarray(off + 4, off + 4 + size)));
          off = align4(off + 4 + size);
          break;
        }
        case 'T':
          args.push(1);
          break;
        case 'F':
          args.push(0);
          break;
        default:
          return null; // unknown type tag
      }
    }
    return { address: addr.value, args };
  } catch {
    return null;
  }
}

function writeString(s: string): Buffer {
  const raw = Buffer.from(s, 'ascii');
  const buf = Buffer.alloc(align4(raw.length + 1)); // zero-filled: null terminator + padding
  raw.copy(buf, 0);
  return buf;
}

/** Encode an OSC message. Numbers default to int32 when integral, else float32. */
export function encodeOsc(address: string, args: OscArg[] = []): Uint8Array {
  const parts: Buffer[] = [writeString(address)];
  let tags = ',';
  const argBufs: Buffer[] = [];
  for (const a of args) {
    if (typeof a === 'number') {
      if (Number.isInteger(a)) {
        tags += 'i';
        const b = Buffer.alloc(4);
        b.writeInt32BE(a | 0, 0);
        argBufs.push(b);
      } else {
        tags += 'f';
        const b = Buffer.alloc(4);
        b.writeFloatBE(a, 0);
        argBufs.push(b);
      }
    } else if (typeof a === 'string') {
      tags += 's';
      argBufs.push(writeString(a));
    } else {
      tags += 'b';
      const size = Buffer.alloc(4);
      size.writeInt32BE(a.length, 0);
      const body = Buffer.alloc(align4(a.length));
      body.set(a, 0);
      argBufs.push(Buffer.concat([size, body]));
    }
  }
  parts.push(writeString(tags), ...argBufs);
  return Buffer.concat(parts);
}

export interface OscInputOptions {
  port?: number;
  /** Bind address (interface). Defaults to all interfaces. */
  iface?: string;
}

/** OSC input over UDP — parses incoming messages into events. */
export class OscInput implements EventInput {
  private socket: Socket;
  private handlers: ((e: OscEvent) => void)[] = [];

  constructor(opts: OscInputOptions = {}) {
    this.socket = createSocket('udp4');
    this.socket.on('error', () => {});
    this.socket.on('message', (msg) => {
      const e = parseOsc(msg);
      if (e) for (const h of this.handlers) h(e);
    });
    this.socket.bind(opts.port ?? OSC_DEFAULT_PORT, opts.iface);
  }

  on(handler: (e: OscEvent) => void): void {
    this.handlers.push(handler);
  }

  close(): void {
    try {
      this.socket.close();
    } catch {
      /* ignore */
    }
  }
}
