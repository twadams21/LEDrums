/* =============================================================================
   OSC TRANSPORT — byte-fixture tests (#139b).

   Every fixture here is laid out byte-by-byte from the OSC 1.0 spec, NOT by
   round-tripping `encodeOsc`. A round-trip test only proves the encoder and the
   parser agree with each other; the senders in scope (Sunhouse Sensory Percussion,
   Ableton / Max for Live devices) emit bytes we do not control, so the parser has to
   be tested against the wire format itself.
   ============================================================================= */
import { createSocket } from 'node:dgram';
import { describe, expect, it } from 'vitest';
import { OscInput, parseOsc, parseOscPacket, type OscInputStatus } from './osc';
import type { OscEvent } from './interfaces';

// --- spec-literal fixture builders ------------------------------------------

/** An OSC-string: ASCII bytes, at least one null terminator, padded to a multiple of 4. */
function oscStr(s: string): Buffer {
  const raw = Buffer.from(s, 'ascii');
  const out = Buffer.alloc((raw.length + 4) & ~3); // zero-filled: terminator + padding
  raw.copy(out, 0);
  return out;
}

const i32 = (n: number): Buffer => {
  const b = Buffer.alloc(4);
  b.writeInt32BE(n, 0);
  return b;
};
const f32 = (n: number): Buffer => {
  const b = Buffer.alloc(4);
  b.writeFloatBE(n, 0);
  return b;
};
const f64 = (n: number): Buffer => {
  const b = Buffer.alloc(8);
  b.writeDoubleBE(n, 0);
  return b;
};
const i64 = (n: bigint): Buffer => {
  const b = Buffer.alloc(8);
  b.writeBigInt64BE(n, 0);
  return b;
};

/** An OSC message: address-string, comma-prefixed type-tag-string, then packed args. */
function msg(address: string, tags: string, ...args: Buffer[]): Buffer {
  return Buffer.concat([oscStr(address), oscStr(`,${tags}`), ...args]);
}

/** The "immediately" timetag (NTP seconds 0, fraction 1) — what live senders use. */
const IMMEDIATE = Buffer.from([0, 0, 0, 0, 0, 0, 0, 1]);

/** An OSC bundle: "#bundle\0", a 64-bit timetag, then `int32 size + element` repeated. */
function bundle(timetag: Buffer, ...elements: Buffer[]): Buffer {
  const body: Buffer[] = [];
  for (const el of elements) body.push(i32(el.length), el);
  return Buffer.concat([oscStr('#bundle'), timetag, ...body]);
}

const addresses = (events: OscEvent[]): string[] => events.map((e) => e.address);

describe('parseOscPacket — messages', () => {
  it('parses a plain message built from spec bytes', () => {
    const packet = msg('/kick', 'if', i32(7), f32(0.5));
    expect(packet.length % 4).toBe(0);

    const events = parseOscPacket(packet);
    expect(events).toHaveLength(1);
    expect(events[0].address).toBe('/kick');
    expect(events[0].args[0]).toBe(7);
    expect(events[0].args[1]).toBeCloseTo(0.5, 6);
  });

  it('parses an address-only message with no type-tag string', () => {
    // Legal OSC 1.0: some senders omit the tag string entirely for a bare address.
    const events = parseOscPacket(oscStr('/ping'));
    expect(events).toHaveLength(1);
    expect(events[0]).toEqual({ address: '/ping', args: [] });
  });
});

describe('parseOscPacket — bundles (defect 1)', () => {
  it('unpacks a bundle of two messages into two events, in order', () => {
    const packet = bundle(IMMEDIATE, msg('/snare', 'f', f32(0.25)), msg('/hat', 'i', i32(3)));

    const events = parseOscPacket(packet);
    expect(addresses(events)).toEqual(['/snare', '/hat']);
    expect(events[0].args[0]).toBeCloseTo(0.25, 6);
    expect(events[1].args[0]).toBe(3);
  });

  it('recurses into a nested bundle and flattens it in wire order', () => {
    const inner = bundle(IMMEDIATE, msg('/tom1', 'i', i32(1)), msg('/tom2', 'i', i32(2)));
    const packet = bundle(IMMEDIATE, msg('/kick', 'i', i32(0)), inner, msg('/ride', 'i', i32(3)));

    expect(addresses(parseOscPacket(packet))).toEqual(['/kick', '/tom1', '/tom2', '/ride']);
  });

  it('parses an empty bundle as zero events rather than garbage', () => {
    expect(parseOscPacket(bundle(IMMEDIATE))).toEqual([]);
  });

  it('delivers a non-immediate timetag now rather than dropping or scheduling it', () => {
    // Live performance path: a future timetag must still reach the engine. We deliberately
    // do not schedule — see the slice report.
    const future = Buffer.concat([i32(0x7fffffff), i32(0)]);
    expect(addresses(parseOscPacket(bundle(future, msg('/kick', 'i', i32(1)))))).toEqual(['/kick']);
  });

  it('keeps `parseOsc` message-only — a bundle is not a single message', () => {
    expect(parseOsc(bundle(IMMEDIATE, msg('/kick', 'i', i32(1))))).toBeNull();
  });
});

describe('parseOscPacket — type tags (defect 2)', () => {
  it('keeps usable args when a message mixes float64, int64, and nil', () => {
    const packet = msg('/mix', 'dhNf', f64(0.75), i64(42n), f32(0.125));

    const events = parseOscPacket(packet);
    expect(events).toHaveLength(1);
    // `N` (nil) carries no bytes and has no numeric meaning, so it yields no arg — but it must
    // not swallow the args around it.
    expect(events[0].args).toHaveLength(3);
    expect(events[0].args[0]).toBeCloseTo(0.75, 12);
    expect(events[0].args[1]).toBe(42);
    expect(events[0].args[2]).toBeCloseTo(0.125, 6);
  });

  it('maps char, symbol, midi, and rgba tags instead of discarding the message', () => {
    const packet = msg(
      '/wide',
      'cSmrf',
      i32(0x41), // 'A'
      oscStr('sym'),
      Buffer.from([0, 0x90, 60, 100]), // midi: port, status, data1, data2
      Buffer.from([10, 20, 30, 40]), // rgba
      f32(1),
    );

    const [event] = parseOscPacket(packet);
    expect(event.address).toBe('/wide');
    expect(event.args[0]).toBe('A');
    expect(event.args[1]).toBe('sym');
    expect(Array.from(event.args[2] as Uint8Array)).toEqual([0, 0x90, 60, 100]);
    expect(Array.from(event.args[3] as Uint8Array)).toEqual([10, 20, 30, 40]);
    expect(event.args[4]).toBeCloseTo(1, 6);
  });

  it('flattens array tags and keeps the surrounding args', () => {
    const packet = msg('/arr', '[ii]f', i32(1), i32(2), f32(0.5));

    const [event] = parseOscPacket(packet);
    expect(event.args[0]).toBe(1);
    expect(event.args[1]).toBe(2);
    expect(event.args[2]).toBeCloseTo(0.5, 6);
  });

  it('stops at an unknown tag but still yields the args parsed before it', () => {
    // An unknown tag has unknowable width, so the rest of the payload is unreadable — but the
    // args ahead of it are known-good and must survive.
    const packet = msg('/partial', 'fZf', f32(0.5), f32(0.25));

    const [event] = parseOscPacket(packet);
    expect(event.address).toBe('/partial');
    expect(event.args[0]).toBeCloseTo(0.5, 6);
  });
});

describe('parseOscPacket — malformed input', () => {
  it('returns no events for garbage instead of throwing', () => {
    expect(parseOscPacket(Buffer.from([1, 2, 3]))).toEqual([]);
    expect(parseOscPacket(Buffer.alloc(0))).toEqual([]);
  });

  it('returns no args for a message whose declared arg is truncated', () => {
    const truncated = Buffer.concat([oscStr('/x'), oscStr(',i')]); // ',i' with no int32 body
    const [event] = parseOscPacket(truncated);
    expect(event.address).toBe('/x');
    expect(event.args).toEqual([]);
  });

  it('does not hang or throw on a bundle with a bogus element size', () => {
    const packet = Buffer.concat([oscStr('#bundle'), IMMEDIATE, i32(9999), oscStr('/x')]);
    expect(parseOscPacket(packet)).toEqual([]);
  });

  it('does not hang on a bundle element declaring zero length', () => {
    const packet = Buffer.concat([oscStr('#bundle'), IMMEDIATE, i32(0), i32(-4), oscStr('/x')]);
    expect(parseOscPacket(packet)).toEqual([]);
  });

  it('stops recursing past a sane nesting depth', () => {
    let packet = msg('/deep', 'i', i32(1));
    for (let i = 0; i < 64; i++) packet = bundle(IMMEDIATE, packet);
    expect(() => parseOscPacket(packet)).not.toThrow();
  });

  it('truncated bundle headers yield nothing', () => {
    expect(parseOscPacket(Buffer.from('#bundle\0'))).toEqual([]);
    expect(parseOscPacket(Buffer.concat([oscStr('#bundle'), Buffer.from([0, 0, 0, 0])]))).toEqual([]);
  });
});

// --- live socket ------------------------------------------------------------

/** Bind an OscInput on an ephemeral port and resolve once it reports `listening`. */
function listening(): Promise<{ input: OscInput; status: OscInputStatus }> {
  return new Promise((resolve, reject) => {
    const input = new OscInput({ port: 0 });
    const timer = setTimeout(() => reject(new Error('OscInput never reported a status')), 4000);
    input.onStatus((status) => {
      clearTimeout(timer);
      if (status.state === 'error') reject(new Error(status.error));
      else resolve({ input, status });
    });
  });
}

/** Send one datagram to 127.0.0.1:port and close the sending socket. */
function sendTo(port: number, packet: Buffer): Promise<void> {
  return new Promise((resolve, reject) => {
    const tx = createSocket('udp4');
    tx.send(packet, port, '127.0.0.1', (err) => {
      tx.close();
      if (err) reject(err);
      else resolve();
    });
  });
}

/** Collect events until `count` have arrived (or time out with what we got). */
function collect(input: OscInput, count: number, ms = 1500): Promise<OscEvent[]> {
  return new Promise((resolve) => {
    const got: OscEvent[] = [];
    const timer = setTimeout(() => resolve(got), ms);
    input.on((e) => {
      got.push(e);
      if (got.length >= count) {
        clearTimeout(timer);
        resolve(got);
      }
    });
  });
}

describe('OscInput over a real UDP socket', () => {
  it('reports the port it actually bound', async () => {
    const { input, status } = await listening();
    try {
      expect(status.state).toBe('listening');
      expect(status.port).toBeGreaterThan(0);
      expect(input.port).toBe(status.port);
    } finally {
      input.close();
    }
  });

  it('emits one event per message in a bundle, in order', async () => {
    const { input, status } = await listening();
    try {
      const pending = collect(input, 3);
      await sendTo(
        status.port,
        bundle(IMMEDIATE, msg('/kick', 'f', f32(1)), msg('/snare', 'f', f32(0.5)), msg('/hat', 'f', f32(0.25))),
      );
      const events = await pending;
      expect(addresses(events)).toEqual(['/kick', '/snare', '/hat']);
      expect(events[2].args[0]).toBeCloseTo(0.25, 6);
    } finally {
      input.close();
    }
  });

  it('delivers a plain message and survives a garbage datagram in between', async () => {
    const { input, status } = await listening();
    try {
      const pending = collect(input, 2);
      await sendTo(status.port, msg('/a', 'i', i32(1)));
      await sendTo(status.port, Buffer.from([0xff, 0xfe, 0xfd]));
      await sendTo(status.port, msg('/b', 'i', i32(2)));
      expect(addresses(await pending)).toEqual(['/a', '/b']);
    } finally {
      input.close();
    }
  });

  it('surfaces a bind failure instead of dying silently (defect 3)', async () => {
    // Hold an ephemeral port with a plain socket, then point an OscInput at it.
    const holder = createSocket('udp4');
    const port = await new Promise<number>((resolve) => {
      holder.bind(0, '127.0.0.1', () => resolve(holder.address().port));
    });

    try {
      const status = await new Promise<OscInputStatus>((resolve, reject) => {
        const input = new OscInput({ port, iface: '127.0.0.1' });
        const timer = setTimeout(() => reject(new Error('no status reported')), 4000);
        input.onStatus((s) => {
          clearTimeout(timer);
          input.close();
          resolve(s);
        });
      });

      expect(status.state).toBe('error');
      expect(status.port).toBe(port);
      expect(status.code).toBe('EADDRINUSE');
      expect(status.error).toMatch(/EADDRINUSE/);
    } finally {
      holder.close();
    }
  });

  it('replays the latest status to a handler registered after the bind settled', async () => {
    const { input, status } = await listening();
    try {
      const late = await new Promise<OscInputStatus>((resolve) => input.onStatus(resolve));
      expect(late).toEqual(status);
    } finally {
      input.close();
    }
  });
});
