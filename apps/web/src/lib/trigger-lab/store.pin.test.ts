import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { defaultProject } from '@ledrums/core';
import { TriggerLab } from './store.svelte';
import type { WSClient, WSCallbacks } from '../ws/client';
import type { OscListenInfo, OutputStatus, SerializedModel, TunnelInfo } from '../ws/protocol-types';

/* Room-PIN + tunnel wiring (S3). A capturing harness client lets us drive the store's WS
   callbacks (onAuthError / onState / onConnection) and inspect the PIN it replays via
   reconnectWithPin. The transport-level PIN behaviour (URL query, 4401 pause) is covered in
   ws/client.test.ts; this pins the store's reactive surface + submitPin path. */

import { MemStorage } from '../test-support/mem-storage';

import { newHarness, harnessClient, type Harness } from '../test-support/ws-harness';

const MODEL: SerializedModel = {
  count: 0,
  positions: [],
  tangents: [],
  normals: [],
  segmentLengths: [],
  drums: [],
  bounds: { center: [0, 0, 0], size: 0 },
};
const OUTPUT: OutputStatus = { state: 'disabled', protocol: 'artnet', host: '', packetsSent: 0, lastError: null, universeCount: 0 };
const OSC_LISTEN: OscListenInfo = { status: 'listening', port: 9000, hosts: ['192.168.1.20'] };

/** Stub rAF so start()'s render loop never runs in node; stop() restores. */
function withRaf(fn: () => void): void {
  const raf = globalThis.requestAnimationFrame;
  const caf = globalThis.cancelAnimationFrame;
  globalThis.requestAnimationFrame = (() => 1) as typeof requestAnimationFrame;
  globalThis.cancelAnimationFrame = (() => {}) as typeof cancelAnimationFrame;
  try {
    fn();
  } finally {
    globalThis.requestAnimationFrame = raf;
    globalThis.cancelAnimationFrame = caf;
  }
}

function fireState(h: Harness, tunnel: TunnelInfo | null): void {
  h.cb!.onState!(defaultProject(), MODEL, [], [], OUTPUT, null, null, tunnel, OSC_LISTEN);
}

let sessionStore: MemStorage;

beforeEach(() => {
  globalThis.localStorage = new MemStorage() as unknown as Storage;
  sessionStore = new MemStorage();
  globalThis.sessionStorage = sessionStore as unknown as Storage;
});

afterEach(() => {
  delete (globalThis as { localStorage?: unknown }).localStorage;
  delete (globalThis as { sessionStorage?: unknown }).sessionStorage;
});

/** The two admission refusals the client reports (INIT-05): a wrong PIN, and a cooldown in
    which the server never compared the PIN at all. */
const WRONG_PIN = { throttled: false, retryAfterSeconds: null };
const THROTTLED = (retryAfterSeconds: number | null) => ({ throttled: true, retryAfterSeconds });

describe('store — room PIN + tunnel (S3)', () => {
  it('onAuthError raises the gate and counts refusals', () => {
    const h = newHarness();
    const store = new TriggerLab(harnessClient(h));
    withRaf(() => {
      store.start();
      expect(store.authRequired).toBe(false);

      h.cb!.onAuthError!(WRONG_PIN);
      expect(store.authRequired).toBe(true);
      expect(store.authFailCount).toBe(1);
      expect(store.link).toBe('offline');

      h.cb!.onAuthError!(WRONG_PIN);
      expect(store.authFailCount).toBe(2);
      expect(store.authThrottledSeconds).toBeNull(); // a wrong PIN is not a cooldown

      store.stop();
    });
  });

  it('a THROTTLED refusal records the wait and still counts, so the gate resolves (INIT-05)', () => {
    const h = newHarness();
    const store = new TriggerLab(harnessClient(h));
    withRaf(() => {
      store.start();

      h.cb!.onAuthError!(THROTTLED(30));
      expect(store.authRequired).toBe(true);
      // It MUST count: the gate reads this to tell "still waiting on the server" from
      // "refused again", and a throttled retry that did not move it would hang on "Joining…".
      expect(store.authFailCount).toBe(1);
      expect(store.authThrottledSeconds).toBe(30);

      // A cooldown with no number on the wire is still a cooldown, not a wrong PIN.
      h.cb!.onAuthError!(THROTTLED(null));
      expect(store.authThrottledSeconds).toBe(0);

      // A later wrong-PIN refusal clears the cooldown flag — the copy must follow the LAST one.
      h.cb!.onAuthError!(WRONG_PIN);
      expect(store.authThrottledSeconds).toBeNull();

      store.stop();
    });
  });

  it('a successful connect clears both the gate and the cooldown', () => {
    const h = newHarness();
    const store = new TriggerLab(harnessClient(h));
    withRaf(() => {
      store.start();
      h.cb!.onAuthError!(THROTTLED(5));
      h.cb!.onConnection!('open');
      expect(store.authRequired).toBe(false);
      expect(store.authThrottledSeconds).toBeNull();
      store.stop();
    });
  });

  it('adopts the tunnel surface from the state message', () => {
    const h = newHarness();
    const store = new TriggerLab(harnessClient(h));
    withRaf(() => {
      store.start();
      expect(store.tunnel).toBeNull();
      fireState(h, { status: 'live', url: 'https://foo.trycloudflare.com', pin: '123456' });
      expect(store.tunnel).toEqual({ status: 'live', url: 'https://foo.trycloudflare.com', pin: '123456' });
      store.stop();
    });
  });

  it('setSharing sends the tunnel start/stop control message (item 4)', () => {
    const h = newHarness();
    const sent: unknown[] = [];
    const client = (): WSClient =>
      ({
        on(cb: WSCallbacks) {
          h.cb = cb;
        },
        connect() {},
        close() {},
        send(msg: unknown) {
          sent.push(msg);
        },
        reconnectWithPin() {},
      }) as unknown as WSClient;
    const store = new TriggerLab(client);
    withRaf(() => {
      store.start();
      store.setSharing(true);
      store.setSharing(false);
      expect(sent).toEqual([
        { t: 'tunnel', action: 'start' },
        { t: 'tunnel', action: 'stop' },
      ]);
      store.stop();
    });
  });

  it('submitPin remembers the PIN and replays it through the client', () => {
    const h = newHarness();
    const store = new TriggerLab(harnessClient(h));
    withRaf(() => {
      store.start();
      h.cb!.onAuthError!(WRONG_PIN);

      store.submitPin('  4242  '); // trimmed
      expect(h.reconnects).toEqual(['4242']);
      expect(sessionStore.getItem('ledrums:pin')).toBe('4242');

      // An empty/blank PIN is ignored (no extra reconnect).
      store.submitPin('   ');
      expect(h.reconnects).toEqual(['4242']);

      // A successful handshake clears the gate.
      h.cb!.onConnection!('open');
      expect(store.authRequired).toBe(false);
      store.stop();
    });
  });
});
