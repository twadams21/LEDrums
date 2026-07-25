import { createSocket, type Socket } from 'node:dgram';
import type { EventInput, OscArg, OscEvent } from './interfaces';

export const OSC_DEFAULT_PORT = 9000;

const align4 = (n: number): number => (n + 3) & ~3;

/** Read an OSC-string (ASCII, null-terminated, padded to 4). `null` when unterminated —
 *  a string that runs off the end of the packet is not a string, it is truncated garbage. */
function readString(buf: Buffer, offset: number): { value: string; next: number } | null {
  let end = offset;
  while (end < buf.length && buf[end] !== 0) end++;
  if (end >= buf.length) return null;
  return { value: buf.toString('ascii', offset, end), next: align4(end + 1) };
}

/**
 * Read one argument for `tag` at `off`.
 *
 * - `null` — the tag is unknown, or its payload runs off the end. Either way its WIDTH is
 *   unknowable, so nothing after it can be located and the caller must stop.
 * - `{ next }` with no `arg` — a legal tag that carries no value worth surfacing (`N` nil,
 *   `I` infinitum, `t` timetag, the `[` `]` array markers). Its width is skipped correctly so
 *   the args around it still parse.
 *
 * Every tag in OSC 1.0 is covered. The old parser handled six of them and returned `null` for
 * the rest, which threw away the whole message — including args that had parsed fine.
 */
function readArg(tag: string, buf: Buffer, off: number): { arg?: OscArg; next: number } | null {
  const fixed = (width: number, read?: (o: number) => OscArg): { arg?: OscArg; next: number } | null => {
    if (off + width > buf.length) return null;
    return read ? { arg: read(off), next: off + width } : { next: off + width };
  };

  switch (tag) {
    case 'i': // int32
      return fixed(4, (o) => buf.readInt32BE(o));
    case 'f': // float32
      return fixed(4, (o) => buf.readFloatBE(o));
    case 'd': // float64
      return fixed(8, (o) => buf.readDoubleBE(o));
    case 'h': // int64 — narrowed to a JS number; drum/control values never approach 2^53
      return fixed(8, (o) => Number(buf.readBigInt64BE(o)));
    case 'c': // char, sent as an int32 codepoint
      return fixed(4, (o) => String.fromCharCode(buf.readUInt32BE(o)));
    case 'm': // 4-byte MIDI message (port, status, data1, data2)
    case 'r': // 4-byte RGBA colour
      return fixed(4, (o) => new Uint8Array(buf.subarray(o, o + 4)));
    case 't': // OSC timetag as an argument — 8 bytes, no control value
      return fixed(8);
    case 'T': // true
      return { arg: 1, next: off };
    case 'F': // false
      return { arg: 0, next: off };
    case 'N': // nil — no bytes, and no number it could honestly become
    case 'I': // infinitum — no bytes
    case '[': // array open/close are structural markers; args inside stay in the flat list
    case ']':
      return { next: off };
    case 's': // string
    case 'S': {
      // symbol — same wire encoding as a string
      const s = readString(buf, off);
      return s ? { arg: s.value, next: s.next } : null;
    }
    case 'b': {
      // blob: int32 byte count, then that many bytes, padded to 4
      if (off + 4 > buf.length) return null;
      const size = buf.readInt32BE(off);
      if (size < 0 || off + 4 + size > buf.length) return null;
      return { arg: new Uint8Array(buf.subarray(off + 4, off + 4 + size)), next: align4(off + 4 + size) };
    }
    default:
      return null;
  }
}

/** Parse the body of an OSC message (address + optional type-tag string + args). */
function parseMessage(buf: Buffer): OscEvent | null {
  const addr = readString(buf, 0);
  // OSC 1.0 addresses always begin with '/'. Requiring it is what separates a real message from
  // a stray datagram, and it is why a bundle never parses as a message.
  if (!addr || addr.value.charCodeAt(0) !== 0x2f /* '/' */) return null;

  let off = addr.next;
  if (off >= buf.length || buf[off] !== 0x2c /* ',' */) return { address: addr.value, args: [] };

  const tags = readString(buf, off);
  if (!tags) return { address: addr.value, args: [] };
  off = tags.next;

  const args: OscArg[] = [];
  for (const tag of tags.value.slice(1)) {
    const read = readArg(tag, buf, off);
    // Stop, but keep what we have. The args already read are known-good; dropping them because a
    // LATER tag was unreadable is the same fail-open silence as a swallowed socket error.
    if (!read) break;
    if (read.arg !== undefined) args.push(read.arg);
    off = read.next;
  }
  return { address: addr.value, args };
}

/** Parse a single OSC 1.0 message (big-endian, 4-byte aligned). Returns null for bundles and
 *  garbage — use {@link parseOscPacket} for anything that arrives off the wire. */
export function parseOsc(buf: Buffer): OscEvent | null {
  if (buf.length < 4 || buf[0] === 0x23 /* '#' bundle */) return null;
  return parseMessage(buf);
}

/** A malicious or broken sender can nest bundles arbitrarily; recursion stops here. */
const MAX_BUNDLE_DEPTH = 32;

function collect(buf: Buffer, out: OscEvent[], depth: number): void {
  if (depth > MAX_BUNDLE_DEPTH || buf.length < 4) return;
  if (buf[0] === 0x23 /* '#' */) {
    collectBundle(buf, out, depth);
    return;
  }
  const message = parseMessage(buf);
  if (message) out.push(message);
}

function collectBundle(buf: Buffer, out: OscEvent[], depth: number): void {
  if (buf.length < 16) return; // "#bundle\0" (8) + 64-bit timetag (8)
  if (buf.toString('ascii', 0, 8) !== '#bundle\0') return;

  // The timetag is read past, not honoured. This is a live-performance input path: a drum hit
  // scheduled for "later" is a missed hit, and every sender in scope (Sensory Percussion, Max
  // for Live) bundles with an immediate timetag anyway. Delivering now is the correct trade.
  let off = 16;
  while (off + 4 <= buf.length) {
    const size = buf.readInt32BE(off);
    off += 4;
    // Element sizes are always positive multiples of 4. Anything else means the packet is
    // corrupt from here on — stop rather than guess (and never advance by <= 0, which loops).
    if (size <= 0 || size % 4 !== 0 || off + size > buf.length) return;
    collect(buf.subarray(off, off + size), out, depth + 1);
    off += size;
  }
}

/**
 * Parse an OSC 1.0 *packet* — a message OR a bundle — into the messages it carries.
 *
 * Bundles are the default framing for Max/M4L objects and much percussion hardware, so a parser
 * that only understands bare messages silently discards everything those senders emit. Nested
 * bundles are flattened in wire order; malformed input yields fewer events, never a throw.
 */
export function parseOscPacket(buf: Buffer): OscEvent[] {
  const out: OscEvent[] = [];
  collect(buf, out, 0);
  return out;
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

/** The transport's own liveness, reported once the bind settles and again on any later socket
 *  error. `packages/io` stays IO-pure — the server subscribes and does the monitor/UI wiring. */
export interface OscInputStatus {
  /** `listening` once the socket is bound; `error` on a bind failure or a later socket error. */
  state: 'listening' | 'error';
  /** The port actually bound (differs from the requested port when 0 was asked for). */
  port: number;
  /** The bound interface — `0.0.0.0` when listening on all of them. */
  address: string;
  /** Human-readable cause, present when `state` is `error`. */
  error?: string;
  /** Node's error code when it has one, e.g. `EADDRINUSE`. */
  code?: string;
}

const ALL_INTERFACES = '0.0.0.0';

/** OSC input over UDP — parses incoming packets (messages *and* bundles) into events. */
export class OscInput implements EventInput {
  private socket: Socket;
  private handlers: ((e: OscEvent) => void)[] = [];
  private statusHandlers: ((s: OscInputStatus) => void)[] = [];
  private lastStatus: OscInputStatus | null = null;
  private readonly requestedPort: number;
  private readonly iface: string;

  constructor(opts: OscInputOptions = {}) {
    this.requestedPort = opts.port ?? OSC_DEFAULT_PORT;
    this.iface = opts.iface ?? ALL_INTERFACES;
    this.socket = createSocket('udp4');

    // A swallowed error here means OSC is dead and nothing anywhere says so — the exact failure
    // mode that makes "OSC is broken" indistinguishable from "the port was already taken".
    this.socket.on('error', (err: NodeJS.ErrnoException) => {
      this.emitStatus({
        state: 'error',
        port: this.lastStatus?.port ?? this.requestedPort,
        address: this.lastStatus?.address ?? this.iface,
        error: err.message,
        ...(err.code ? { code: err.code } : {}),
      });
    });

    this.socket.on('listening', () => {
      const bound = this.socket.address();
      this.emitStatus({ state: 'listening', port: bound.port, address: bound.address });
    });

    this.socket.on('message', (packet) => {
      for (const e of parseOscPacket(packet)) {
        for (const h of this.handlers) h(e);
      }
    });

    this.socket.bind(this.requestedPort, opts.iface);
  }

  /** The port actually bound, falling back to the requested one until the bind settles. */
  get port(): number {
    return this.lastStatus?.port ?? this.requestedPort;
  }

  /** The latched transport status, or null while the bind is still in flight. Callers that
   *  must not claim liveness they haven't observed should treat null as "not yet known". */
  get status(): OscInputStatus | null {
    return this.lastStatus;
  }

  on(handler: (e: OscEvent) => void): void {
    this.handlers.push(handler);
  }

  /** Subscribe to transport liveness. The latest status is latched and replayed immediately, so
   *  a subscriber that attaches after the bind resolved still learns whether OSC is alive. */
  onStatus(handler: (s: OscInputStatus) => void): void {
    this.statusHandlers.push(handler);
    if (this.lastStatus) handler(this.lastStatus);
  }

  private emitStatus(status: OscInputStatus): void {
    this.lastStatus = status;
    for (const h of this.statusHandlers) h(status);
  }

  close(): void {
    try {
      this.socket.close();
    } catch {
      /* ignore */
    }
  }
}
