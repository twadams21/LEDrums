import { afterEach, describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { createSocket, Socket } from 'node:dgram';
import { ArtNetOutput, encodeArtDmx } from './artnet';
import type { PixelOutputStatus } from './interfaces';

/**
 * Characterization tests for the ArtNetOutput UDP socket lifecycle. Recorded at the
 * pre-status-seam baseline: they pin today's behaviour INCLUDING the silent bind
 * failure, so later steps invert these assertions and the test diff is the
 * behaviour-change record.
 */

// RFC 5737 TEST-NET-3: guaranteed never assigned to a NIC, so binding to it fails
// deterministically without touching the network.
const TEST_NET_3 = '203.0.113.9';

let cleanup: Array<() => void> = [];

function receiver(): Promise<{ socket: Socket; port: number; first: Promise<Buffer> }> {
  return new Promise((resolve) => {
    const socket = createSocket('udp4');
    const first = new Promise<Buffer>((res) => socket.once('message', (msg) => res(msg)));
    socket.bind({ address: '127.0.0.1', port: 0 }, () => {
      cleanup.push(() => socket.close());
      resolve({ socket, port: socket.address().port, first });
    });
  });
}

afterEach(() => {
  for (const fn of cleanup) {
    try {
      fn();
    } catch {
      /* already closed */
    }
  }
  cleanup = [];
});

describe('ArtNetOutput socket lifecycle (characterization)', () => {
  it(
    'happy path delivers a byte-exact ArtDmx packet over loopback',
    { timeout: 2000 },
    async () => {
      const rx = await receiver();
      const out = new ArtNetOutput({ host: '127.0.0.1', port: rx.port, iface: '127.0.0.1' });
      cleanup.push(() => out.close());
      const statuses: PixelOutputStatus[] = [];
      out.onStatus((s) => statuses.push(s));
      const data = new Uint8Array(512).fill(9);
      out.nextFrame(); // seq -> 1
      // The bind is asynchronous and send() drops frames until ready; retry the same
      // (universe, seq) send until the receiver reports delivery — event-driven, no sleep.
      const timer = setInterval(() => out.send(1, data), 10);
      cleanup.push(() => clearInterval(timer));
      out.send(1, data);
      const got = await rx.first;
      clearInterval(timer);
      // This buffer is the golden fixture S5 byte-compares against after the adapter changes.
      expect(got.toString('ascii', 0, 7)).toBe('Art-Net');
      expect(got[7]).toBe(0);
      expect(got.length).toBe(530);
      expect(got.equals(Buffer.from(encodeArtDmx(1, 1, data)))).toBe(true);
      expect(statuses).toContainEqual({ state: 'ready' });
    },
  );

  // INVERTED from the S1 recording ("a bind failure is currently silent"): the bind
  // failure is now observable through onStatus, while send() still never throws.
  it(
    'a bind failure now emits an observable error status; send still never throws',
    { timeout: 2000 },
    async () => {
      const rx = await receiver();
      const out = new ArtNetOutput({ host: '127.0.0.1', port: rx.port, iface: TEST_NET_3 });
      cleanup.push(() => out.close());
      out.nextFrame();
      const status = new Promise<PixelOutputStatus>((res) => out.onStatus((s) => res(s)));
      expect(() => out.send(1, new Uint8Array(512))).not.toThrow();
      const s = await status;
      expect(s.state).toBe('error');
      expect(s.error).toBeTruthy();
      expect(['EADDRNOTAVAIL', 'EINVAL']).toContain(s.code); // platform-dependent
    },
  );

  it(
    'a subscriber attaching after the bind resolves is replayed the latched ready status',
    { timeout: 2000 },
    async () => {
      const out = new ArtNetOutput({ host: '127.0.0.1', port: 65000, iface: '127.0.0.1' });
      cleanup.push(() => out.close());
      // Wait for the bind via a first subscriber…
      await new Promise<void>((res) => out.onStatus((s) => s.state === 'ready' && res()));
      // …then a LATE subscriber must be replayed the latched value immediately.
      const seen: PixelOutputStatus[] = [];
      out.onStatus((s) => seen.push(s));
      expect(seen).toEqual([{ state: 'ready' }]);
    },
  );

  it(
    'a throwing subscriber escapes neither the adapter nor the process',
    { timeout: 2000 },
    async () => {
      let uncaught = false;
      const sentinel = (): void => {
        uncaught = true;
      };
      process.once('uncaughtException', sentinel);
      process.once('unhandledRejection', sentinel);
      try {
        const rx = await receiver();
        const out = new ArtNetOutput({ host: '127.0.0.1', port: rx.port, iface: '127.0.0.1' });
        cleanup.push(() => out.close());
        out.onStatus(() => {
          throw new Error('bad subscriber');
        });
        await new Promise<void>((res) => out.onStatus((s) => s.state === 'ready' && res()));
        out.nextFrame();
        expect(() => out.send(1, new Uint8Array(512))).not.toThrow();
        await rx.first;
        // Give any queued microtask/callback a beat to surface before asserting.
        await new Promise((res) => setTimeout(res, 50));
        expect(uncaught).toBe(false);
      } finally {
        process.removeListener('uncaughtException', sentinel);
        process.removeListener('unhandledRejection', sentinel);
      }
    },
  );

  it('send() returns before the dgram completion callback runs, and the adapters contain no sync IO', async () => {
    // STRUCTURAL no-sync-IO lock (S10d): a wall-clock bound both false-fails under the
    // gates mutex and false-passes on a fast box; instead prove nothing awaits the socket.
    const order: string[] = [];
    const spy = vi
      .spyOn(Socket.prototype, 'send')
      .mockImplementation(function (this: Socket, ...args: unknown[]) {
        const cb = args[args.length - 1] as (err: Error | null) => void;
        queueMicrotask(() => {
          order.push('callback');
          cb(null);
        });
      } as never);
    try {
      const out = new ArtNetOutput({ host: '127.0.0.1', port: 65003, iface: '127.0.0.1' });
      cleanup.push(() => out.close());
      await new Promise<void>((res) => out.onStatus((s) => s.state === 'ready' && res()));
      out.nextFrame();
      out.send(1, new Uint8Array(512));
      order.push('returned');
      await new Promise((res) => setTimeout(res, 0));
      expect(order).toEqual(['returned', 'callback']);
    } finally {
      spy.mockRestore();
    }
    for (const file of ['./artnet.ts', './sacn.ts']) {
      const src = readFileSync(new URL(file, import.meta.url), 'utf8');
      expect(src).not.toMatch(/\bawait\b|\bexecSync\b|Atomics\.wait/);
    }
  });

  it('smoke check (not a proof): 44 successive real-socket sends stay inside a generous 250ms budget', { timeout: 2000 }, async () => {
    const rx = await receiver();
    const out = new ArtNetOutput({ host: '127.0.0.1', port: rx.port, iface: '127.0.0.1' });
    cleanup.push(() => out.close());
    await new Promise<void>((res) => out.onStatus((s) => s.state === 'ready' && res()));
    const data = new Uint8Array(512);
    const started = performance.now();
    for (let i = 0; i < 44; i++) {
      out.nextFrame();
      out.send(1, data);
    }
    expect(performance.now() - started).toBeLessThan(250);
  });

  it('a broadcast-mode instance still calls socket.setBroadcast(true)', { timeout: 2000 }, async () => {
    // Loopback cannot observe broadcast mode on the wire; a prototype spy locks the
    // option so it cannot be silently dropped by a refactor.
    const spy = vi.spyOn(Socket.prototype, 'setBroadcast').mockImplementation(() => {});
    try {
      const out = new ArtNetOutput({ host: '255.255.255.255', broadcast: true, iface: '127.0.0.1' });
      cleanup.push(() => out.close());
      await new Promise<void>((res) => out.onStatus((s) => s.state === 'ready' && res()));
      expect(spy).toHaveBeenCalledWith(true);
    } finally {
      spy.mockRestore();
    }
  });
});
