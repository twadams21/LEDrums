import { afterEach, describe, expect, it } from 'vitest';
import { createSocket, type Socket } from 'node:dgram';
import { SacnOutput, encodeE131 } from './sacn';

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
    },
  );

  it(
    'a stale multicast interface is currently silent: no throw, no status channel, and unicast delivery still succeeds',
    { timeout: 2000 },
    async () => {
      const rx = await receiver();
      // The sACN bind takes no address, so a stale iface NEVER produces a bind error:
      // setMulticastInterface fails inside a bare catch and multicast silently uses the
      // default NIC. With an explicit unicast host, delivery still succeeds regardless.
      const out = new SacnOutput({ host: '127.0.0.1', port: rx.port, iface: TEST_NET_3 });
      cleanup.push(() => out.close());
      expect('onStatus' in out).toBe(false);
      const data = new Uint8Array(512).fill(3);
      out.nextFrame();
      expect(() => out.send(1, data)).not.toThrow();
      const timer = setInterval(() => out.send(1, data), 10);
      cleanup.push(() => clearInterval(timer));
      const got = await rx.first;
      clearInterval(timer);
      expect(got.length).toBe(638);
    },
  );
});
