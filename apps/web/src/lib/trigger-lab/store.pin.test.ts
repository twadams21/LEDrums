import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { defaultProject } from '@ledrums/core';
import { TriggerLab } from './store.svelte';
import type { WSClient, WSCallbacks } from '../ws/client';
import type { OutputStatus, SerializedModel, TunnelInfo } from '../ws/protocol-types';

/* Room-PIN + tunnel wiring (S3). A capturing harness client lets us drive the store's WS
   callbacks (onAuthError / onState / onConnection) and inspect the PIN it replays via
   reconnectWithPin. The transport-level PIN behaviour (URL query, 4401 pause) is covered in
   ws/client.test.ts; this pins the store's reactive surface + submitPin path. */

class MemStorage {
  private m = new Map<string, string>();
  get length(): number {
    return this.m.size;
  }
  key(i: number): string | null {
    return [...this.m.keys()][i] ?? null;
  }
  getItem(k: string): string | null {
    return this.m.has(k) ? this.m.get(k)! : null;
  }
  setItem(k: string, v: string): void {
    this.m.set(k, String(v));
  }
  removeItem(k: string): void {
    this.m.delete(k);
  }
  clear(): void {
    this.m.clear();
  }
}

interface Harness {
  cb: WSCallbacks | null;
  reconnects: string[];
}

const harnessClient =
  (h: Harness): (() => WSClient) =>
  () =>
    ({
      on(cb: WSCallbacks) {
        h.cb = cb;
      },
      connect() {},
      close() {},
      send() {},
      reconnectWithPin(pin: string) {
        h.reconnects.push(pin);
      },
    }) as unknown as WSClient;

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
  h.cb!.onState!(defaultProject(), MODEL, [], [], OUTPUT, null, null, tunnel);
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

describe('store — room PIN + tunnel (S3)', () => {
  it('onAuthError raises the gate and counts refusals', () => {
    const h: Harness = { cb: null, reconnects: [] };
    const store = new TriggerLab(harnessClient(h));
    withRaf(() => {
      store.start();
      expect(store.authRequired).toBe(false);

      h.cb!.onAuthError!();
      expect(store.authRequired).toBe(true);
      expect(store.authFailCount).toBe(1);
      expect(store.link).toBe('offline');

      h.cb!.onAuthError!();
      expect(store.authFailCount).toBe(2);

      store.stop();
    });
  });

  it('adopts the tunnel surface from the state message', () => {
    const h: Harness = { cb: null, reconnects: [] };
    const store = new TriggerLab(harnessClient(h));
    withRaf(() => {
      store.start();
      expect(store.tunnel).toBeNull();
      fireState(h, { url: 'https://foo.trycloudflare.com', pin: '123456' });
      expect(store.tunnel).toEqual({ url: 'https://foo.trycloudflare.com', pin: '123456' });
      store.stop();
    });
  });

  it('submitPin remembers the PIN and replays it through the client', () => {
    const h: Harness = { cb: null, reconnects: [] };
    const store = new TriggerLab(harnessClient(h));
    withRaf(() => {
      store.start();
      h.cb!.onAuthError!();

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
