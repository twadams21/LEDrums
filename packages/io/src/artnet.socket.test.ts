import { afterEach, describe, expect, it } from 'vitest';
import { createSocket, type Socket } from 'node:dgram';
import { ArtNetOutput, encodeArtDmx } from './artnet';

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
    },
  );

  it(
    'a bind failure is currently silent: no throw, no status channel, nothing delivered within a 1000ms budget',
    { timeout: 3000 },
    async () => {
      const rx = await receiver();
      const out = new ArtNetOutput({ host: '127.0.0.1', port: rx.port, iface: TEST_NET_3 });
      cleanup.push(() => out.close());
      out.nextFrame();
      // Today the adapter exposes no way to observe the failed bind. S4/S5 invert this.
      expect('onStatus' in out).toBe(false);
      expect(() => out.send(1, new Uint8Array(512))).not.toThrow();
      // Timing-bounded NEGATIVE assertion (not a deterministic proof): with the bind
      // failed, nothing should reach the receiver inside a generous 1000ms budget.
      const delivered = await Promise.race([
        rx.first.then(() => true),
        new Promise<boolean>((res) => setTimeout(() => res(false), 1000)),
      ]);
      expect(delivered).toBe(false);
    },
  );
});
