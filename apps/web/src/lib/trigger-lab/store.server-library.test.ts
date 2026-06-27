import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { defaultProject } from '@ledrums/core';
import { TriggerLab } from './store.svelte';
import {
  serializeShowLibrary,
  serializeAuthored,
  SHOWS_STORAGE_KEY,
  STORAGE_KEY,
  type AuthoredState,
  type Show,
  type ShowLibrary,
} from './persistence';
import type { WSClient, WSCallbacks } from '../ws/client';
import type { ClientMessage, OutputStatus, SerializedModel, ShowLibraryBlob } from '../ws/protocol-types';

/* Server-authoritative show library (S7 cold-load adopt + write-through). The server owns the
   authored library and ships it on the `state` message; the web ADOPTS it once on a cold load
   (server wins), then pushes every authored change up via setShowLibrary. localStorage is a
   cache: it seeds the server when the server has none, but the server wins on cold load. A
   capturing harness client lets us drive onConnection/onState and inspect what the store sends.
   The pure library (de)serialize/migration contract is covered in persistence.test.ts. */

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
  sent: ClientMessage[];
}

/** A WSClient that captures the callbacks the store registers and records every send, so a test
    can drive the connect handshake (onConnection/onState) and assert what the store pushes. */
const harnessClient =
  (h: Harness): (() => WSClient) =>
  () =>
    ({
      on(cb: WSCallbacks) {
        h.cb = cb;
      },
      connect() {},
      close() {},
      send(m: ClientMessage) {
        h.sent.push(m);
      },
    }) as unknown as WSClient;

/** A no-op client for boot-only tests (start() is never called, so nothing connects). */
const noopClient = (): WSClient => ({ on() {}, connect() {}, close() {}, send() {} }) as unknown as WSClient;

const MODEL: SerializedModel = {
  count: 0,
  positions: [],
  tangents: [],
  normals: [],
  segmentLengths: [],
  drums: [],
  bounds: { center: [0, 0, 0], size: 0 },
};
const OUTPUT: OutputStatus = { state: 'disabled', protocol: 'artnet', host: '', packetsSent: 0, lastError: null };

/** Drive the real autosave: start() registers the persist $effect; a no-op RAF keeps the render
    loop from running in node; stop() flushes synchronously. */
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

function fireOpen(h: Harness): void {
  h.cb!.onConnection!('open');
}
function fireState(h: Harness, showLibrary: ShowLibraryBlob | null): void {
  h.cb!.onState!(defaultProject(), MODEL, [], [], OUTPUT, showLibrary);
}

/** Build a server-library blob (the envelope the server stores + ships). The active show carries
    a bpm so adoption is observable; extra shows carry empty authored content. */
function serverLib(
  active: { id: string; name: string; bpm: number },
  others: { id: string; name: string }[] = [],
): ShowLibraryBlob {
  const shows: Record<string, Show> = {
    [active.id]: { id: active.id, name: active.name, authored: { bpm: active.bpm } as AuthoredState },
  };
  for (const o of others) shows[o.id] = { id: o.id, name: o.name, authored: {} as AuthoredState };
  const lib: ShowLibrary = { shows, activeShowId: active.id };
  return serializeShowLibrary(lib);
}

beforeEach(() => {
  (globalThis as { localStorage?: Storage }).localStorage = new MemStorage() as unknown as Storage;
});
afterEach(() => {
  delete (globalThis as { localStorage?: Storage }).localStorage;
});

describe('cold-load adopt (server wins)', () => {
  it('adopts the server library over a fresh seed on the first state', () => {
    withRaf(() => {
      const h: Harness = { cb: null, sent: [] };
      const store = new TriggerLab(harnessClient(h));
      store.start();
      expect(store.shows).toHaveLength(1); // fresh "Untitled Show" before any state

      fireOpen(h);
      fireState(h, serverLib({ id: 'srv-1', name: 'Server Show', bpm: 145 }, [{ id: 'srv-2', name: 'Second' }]));

      expect(store.shows.map((s) => s.name).sort()).toEqual(['Second', 'Server Show']);
      expect(store.activeShowId).toBe('srv-1');
      expect(store.activeShow!.name).toBe('Server Show');
      expect(store.bpm).toBe(145); // the active show's authored content was applied
      store.stop();
    });
  });

  it('caches the adopted library to localStorage and does not echo it back to the server', () => {
    withRaf(() => {
      const h: Harness = { cb: null, sent: [] };
      const store = new TriggerLab(harnessClient(h));
      store.start();
      fireOpen(h);
      h.sent.length = 0; // ignore the connect handshake (setShow/setTransport)
      fireState(h, serverLib({ id: 'srv-1', name: 'Server Show', bpm: 145 }));
      store.stop(); // flush the autosave → localStorage cache

      // the adopted library landed in the cache (a storage clear would now reload from it / server)
      const cached = localStorage.getItem(SHOWS_STORAGE_KEY);
      expect(cached).toContain('Server Show');
      // adopt marks the library as already-synced — no setShowLibrary echo of what we just took
      expect(h.sent.some((m) => m.t === 'setShowLibrary')).toBe(false);
    });
  });
});

describe('localStorage-cache fallback + seeding the server', () => {
  it('keeps the cached library and pushes it up when the server has none', () => {
    withRaf(() => {
      localStorage.setItem(
        SHOWS_STORAGE_KEY,
        JSON.stringify(serverLib({ id: 'local-1', name: 'Local Show', bpm: 132 })),
      );
      const h: Harness = { cb: null, sent: [] };
      const store = new TriggerLab(harnessClient(h));
      store.start();
      expect(store.activeShow!.name).toBe('Local Show'); // hydrated from the cache at boot

      fireOpen(h);
      fireState(h, null); // server has no library yet

      expect(store.activeShow!.name).toBe('Local Show'); // not clobbered
      expect(store.bpm).toBe(132);
      const push = h.sent.find((m) => m.t === 'setShowLibrary');
      expect(push).toBeTruthy(); // the cache was pushed up to seed the server
      expect(JSON.stringify(push)).toContain('Local Show');
      store.stop();
    });
  });
});

describe('no clobber after the cold-load adopt', () => {
  it('ignores a later state broadcast — adopt happens once, in-session edits survive', () => {
    withRaf(() => {
      const h: Harness = { cb: null, sent: [] };
      const store = new TriggerLab(harnessClient(h));
      store.start();
      fireOpen(h);
      fireState(h, serverLib({ id: 'srv-1', name: 'Server Show', bpm: 145 })); // cold-load adopt
      expect(store.activeShow!.name).toBe('Server Show');

      store.renameShow('srv-1', 'Renamed'); // in-session edits
      store.bpm = 99;

      // a later `state` (e.g. broadcast after a project mutation) must NOT re-adopt / clobber
      fireState(h, serverLib({ id: 'srv-1', name: 'Server Show', bpm: 145 }));
      expect(store.activeShow!.name).toBe('Renamed');
      expect(store.bpm).toBe(99);
      store.stop();
    });
  });
});

describe('legacy offline migration (unchanged by server persistence)', () => {
  it('migrates a legacy single-blob authored state to one Default Show on a fresh offline boot', () => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(serializeAuthored({ bpm: 156 } as AuthoredState)));
    const store = new TriggerLab(noopClient);
    expect(store.shows).toHaveLength(1);
    expect(store.activeShow!.name).toBe('Default Show');
    expect(store.bpm).toBe(156);
  });
});
