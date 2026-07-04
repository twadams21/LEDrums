// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { TriggerLab } from './store.svelte';
import { defaultProject } from '@ledrums/core';
import type { WSClient, WSCallbacks } from '../ws/client';
import type { ClientMessage, ControllerStatus, DiscoveredController } from '../ws/protocol-types';

/* S48 — the PixLite controller monitor wiring in the store: the server's `controllerStatus` /
   `controllerDiscovery` broadcasts land in reactive state, and the panel-facing send helpers
   (watch / discover / adopt / identify) push the right messages with the right editor gating.
   A capturing harness records callbacks + sends; `wireClient()` registers the callbacks without
   opening a real socket. */

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

beforeEach(() => {
  (globalThis as { localStorage?: Storage }).localStorage = new MemStorage() as unknown as Storage;
});
afterEach(() => {
  delete (globalThis as { localStorage?: Storage }).localStorage;
});

/** A store with the WS callbacks registered (no live socket) and `project` seeded so setOutput's
    optimistic write has something to write to. */
function wired(): { store: TriggerLab; h: Harness } {
  const h: Harness = { cb: null, sent: [] };
  const store = new TriggerLab(harnessClient(h));
  store.project = defaultProject();
  (store as unknown as { wireClient(): void }).wireClient();
  return { store, h };
}

const status = (o: Partial<ControllerStatus> = {}): ControllerStatus => ({
  host: '192.168.1.50',
  reachable: true,
  identity: { host: '192.168.1.50', prodName: 'PixLite A16-S Mk3', nickname: 'Roof', fwVer: '1.4.2', authReqd: false },
  universes: [{ uniNum: 1, protocol: 'sACN', receiving: true, inGood: 10, inBadSeq: 0 }],
  rates: { inFrmRate: 40, outFrmRate: 40 },
  health: { tempC: 41 },
  lastSeen: 1000,
  ...o,
});

const candidate = (host: string): DiscoveredController => ({
  host,
  prodName: 'PixLite A16-S Mk3',
  nickname: 'Roof',
  fwVer: '1.4.2',
  authReqd: false,
  score: 100,
});

describe('store — controller status/discovery broadcasts', () => {
  it('adopts controllerStatus from the server broadcast (and clears on null)', () => {
    const { store, h } = wired();
    h.cb!.onControllerStatus!(status());
    expect(store.controllerStatus?.host).toBe('192.168.1.50');
    h.cb!.onControllerStatus!(null);
    expect(store.controllerStatus).toBeNull();
  });

  it('replaces the candidate list wholesale on each discovery reply', () => {
    const { store, h } = wired();
    h.cb!.onControllerDiscovery!([candidate('192.168.1.50'), candidate('192.168.1.51')]);
    expect(store.controllerCandidates.map((c) => c.host)).toEqual(['192.168.1.50', '192.168.1.51']);
    h.cb!.onControllerDiscovery!([]); // sweep found nothing → cleared
    expect(store.controllerCandidates).toEqual([]);
  });

  it('clears controller state on a link drop (frozen truth must not linger)', () => {
    const { store, h } = wired();
    h.cb!.onControllerStatus!(status());
    h.cb!.onControllerDiscovery!([candidate('192.168.1.50')]);
    h.cb!.onConnection!('closed');
    expect(store.controllerStatus).toBeNull();
    expect(store.controllerCandidates).toEqual([]);
  });
});

describe('store — controller send helpers', () => {
  it('watchController sends the interest signal (not editor-gated — a viewer keeps status live)', () => {
    const { store, h } = wired();
    store.presence = { editorId: 'c1', youAreEditor: false, clientCount: 2 }; // viewer
    expect(store.isViewer).toBe(true);
    store.watchController(true);
    store.watchController(false);
    expect(h.sent).toEqual([
      { t: 'watchController', watching: true },
      { t: 'watchController', watching: false },
    ]);
  });

  it('discoverControllers sends for an editor and no-ops for a viewer', () => {
    const editor = wired();
    editor.store.discoverControllers();
    expect(editor.h.sent).toContainEqual({ t: 'discoverControllers' });

    const viewer = wired();
    viewer.store.presence = { editorId: 'c1', youAreEditor: false, clientCount: 2 };
    viewer.store.discoverControllers();
    expect(viewer.h.sent).toEqual([]);
  });

  it('adoptController adopts AND points the output host at it in one click (Adopt-IP)', () => {
    const { store, h } = wired();
    store.adoptController('192.168.1.77');
    expect(h.sent).toContainEqual({ t: 'adoptController', host: '192.168.1.77' });
    expect(h.sent).toContainEqual({ t: 'setOutput', host: '192.168.1.77' });
    // optimistic local write of the output target
    expect(store.project!.output.host).toBe('192.168.1.77');
  });

  it('adoptController is a no-op for a viewer (no adopt, no output rewrite)', () => {
    const { store, h } = wired();
    store.presence = { editorId: 'c1', youAreEditor: false, clientCount: 2 };
    const before = store.project!.output.host;
    store.adoptController('192.168.1.77');
    expect(h.sent).toEqual([]);
    expect(store.project!.output.host).toBe(before);
  });

  it('identifyController sends the flash duration (default 5s) and no-ops for a viewer', () => {
    const editor = wired();
    editor.store.identifyController();
    expect(editor.h.sent).toContainEqual({ t: 'identifyController', durationS: 5 });

    const viewer = wired();
    viewer.store.presence = { editorId: 'c1', youAreEditor: false, clientCount: 2 };
    viewer.store.identifyController(10);
    expect(viewer.h.sent).toEqual([]);
  });
});

describe('store — controller test patterns + takeover (S49)', () => {
  it('setControllerTestData sends the pattern for an editor and no-ops for a viewer', () => {
    const pattern = { op: 'setColor', color: [255, 0, 0, 0], colorRes: '8Bit', pixPortNum: 0, pixNum: 0 } as const;
    const editor = wired();
    editor.store.setControllerTestData(pattern);
    expect(editor.h.sent).toContainEqual({ t: 'controllerTestData', pattern });

    const viewer = wired();
    viewer.store.presence = { editorId: 'c1', youAreEditor: false, clientCount: 2 };
    viewer.store.setControllerTestData(pattern);
    expect(viewer.h.sent).toEqual([]);
  });

  it('backToLive sends the exit for an editor and no-ops for a viewer', () => {
    const editor = wired();
    editor.store.backToLive();
    expect(editor.h.sent).toContainEqual({ t: 'controllerBackToLive' });

    const viewer = wired();
    viewer.store.presence = { editorId: 'c1', youAreEditor: false, clientCount: 2 };
    viewer.store.backToLive();
    expect(viewer.h.sent).toEqual([]);
  });

  it('controllerTakeover mirrors the server-reported testPattern on the status', () => {
    const { store, h } = wired();
    expect(store.controllerTakeover).toBeNull(); // no status yet
    h.cb!.onControllerStatus!(status());
    expect(store.controllerTakeover).toBeNull(); // adopted, live mode
    const pattern = { op: 'rgbwCycle' } as const;
    h.cb!.onControllerStatus!(status({ testPattern: pattern }));
    expect(store.controllerTakeover).toEqual(pattern);
    h.cb!.onControllerStatus!(status({ testPattern: null }));
    expect(store.controllerTakeover).toBeNull(); // back to live
  });

  it('drops the takeover with the rest of the controller state on a link drop', () => {
    const { store, h } = wired();
    h.cb!.onControllerStatus!(status({ testPattern: { op: 'colorFade' } }));
    expect(store.controllerTakeover).toEqual({ op: 'colorFade' });
    h.cb!.onConnection!('closed');
    expect(store.controllerTakeover).toBeNull();
  });
});
