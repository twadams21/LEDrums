import { afterEach, describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { createSocket, Socket } from 'node:dgram';
import { SacnOutput, encodeE131 } from './sacn';
import type { PixelOutputStatus } from './interfaces';

/**
 * Characterization tests for the SacnOutput UDP socket lifecycle. Recorded at the
 * pre-status-seam baseline: they pin today's behaviour INCLUDING the silently
 * swallowed multicast-interface failure, so later steps invert these assertions.
 * Unicast to 127.0.0.1 throughout — CI has no multicast fabric.
 */

// RFC 5737 TEST-NET-3: guaranteed never assigned to a NIC.
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

describe('SacnOutput socket lifecycle (characterization)', () => {
  it(
    'happy path delivers a byte-exact E1.31 packet over loopback unicast',
    { timeout: 2000 },
    async () => {
      const rx = await receiver();
      const out = new SacnOutput({ host: '127.0.0.1', port: rx.port, iface: '127.0.0.1' });
      cleanup.push(() => out.close());
      const statuses: PixelOutputStatus[] = [];
      out.onStatus((s) => statuses.push(s));
      const data = new Uint8Array(512).fill(5);
      out.nextFrame(); // seq -> 1
      const timer = setInterval(() => out.send(1, data), 10);
      cleanup.push(() => clearInterval(timer));
      out.send(1, data);
      const got = await rx.first;
      clearInterval(timer);
      // This buffer is the golden fixture S6 byte-compares against after the adapter changes.
      expect(got.length).toBe(638);
      expect(got.readUInt16BE(0)).toBe(0x0010); // preamble size
      // The CID is private per-instance state; lift it from the received Root layer
      // (bytes 22..38) and re-encode — every other byte must then match exactly.
      const cid = Uint8Array.from(got.subarray(22, 38));
      expect(got.equals(Buffer.from(encodeE131(1, 1, data, cid)))).toBe(true);
      expect(statuses).toContainEqual({ state: 'ready' });
    },
  );

  // INVERTED from the S1 recording ("a stale multicast interface is currently silent"):
  // the failure now emits EMCASTIFACE — while unicast delivery still succeeds, proving
  // observability was added without changing transmit behaviour.
  it(
    'a stale multicast interface emits EMCASTIFACE and unicast delivery still succeeds',
    { timeout: 2000 },
    async () => {
      const rx = await receiver();
      const out = new SacnOutput({ host: '127.0.0.1', port: rx.port, iface: TEST_NET_3 });
      cleanup.push(() => out.close());
      const status = new Promise<PixelOutputStatus>((res) => out.onStatus((s) => res(s)));
      const data = new Uint8Array(512).fill(3);
      out.nextFrame();
      expect(() => out.send(1, data)).not.toThrow();
      const timer = setInterval(() => out.send(1, data), 10);
      cleanup.push(() => clearInterval(timer));
      const got = await rx.first;
      clearInterval(timer);
      expect(got.length).toBe(638);
      const s = await status;
      expect(s.state).toBe('error');
      expect(s.code).toBe('EMCASTIFACE');
      expect(s.error).toContain(TEST_NET_3);
    },
  );

  it(
    'a subscriber attaching after the bind resolves is replayed the latched status',
    { timeout: 2000 },
    async () => {
      const out = new SacnOutput({ host: '127.0.0.1', port: 65001, iface: '127.0.0.1' });
      cleanup.push(() => out.close());
      await new Promise<void>((res) => out.onStatus((s) => s.state === 'ready' && res()));
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
        const out = new SacnOutput({ host: '127.0.0.1', port: rx.port, iface: '127.0.0.1' });
        cleanup.push(() => out.close());
        out.onStatus(() => {
          throw new Error('bad subscriber');
        });
        await new Promise<void>((res) => out.onStatus((s) => s.state === 'ready' && res()));
        out.nextFrame();
        expect(() => out.send(1, new Uint8Array(512))).not.toThrow();
        await rx.first;
        await new Promise((res) => setTimeout(res, 50));
        expect(uncaught).toBe(false);
      } finally {
        process.removeListener('uncaughtException', sentinel);
        process.removeListener('unhandledRejection', sentinel);
      }
    },
  );

  it('still configures reuseAddr and calls setMulticastTTL(16)', { timeout: 2000 }, async () => {
    // Loopback unicast cannot observe either option; these locks stop a refactor from
    // silently dropping them. TTL via a prototype spy; reuseAddr via a source-text lock
    // (createSocket is module-bound, so its options object is not spyable per-instance).
    const spy = vi.spyOn(Socket.prototype, 'setMulticastTTL').mockImplementation(() => 16);
    try {
      const out = new SacnOutput({ host: '127.0.0.1', port: 65002, iface: '127.0.0.1' });
      cleanup.push(() => out.close());
      await new Promise<void>((res) => out.onStatus((s) => s.state === 'ready' && res()));
      expect(spy).toHaveBeenCalledWith(16);
    } finally {
      spy.mockRestore();
    }
    const src = readFileSync(new URL('./sacn.ts', import.meta.url), 'utf8');
    expect(src).toContain("createSocket({ type: 'udp4', reuseAddr: true })");
  });
});
