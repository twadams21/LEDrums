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
const OUTPUT: OutputStatus = { state: 'disabled', protocol: 'artnet', host: '', packetsSent: 0, lastError: null, universeCount: 0 };

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
  h.cb!.onState!(defaultProject(), MODEL, [], [], OUTPUT, showLibrary, null);
}
/** Drive a `presence` message (S1 multi-client) — `youAreEditor` decides editor vs viewer role. */
function firePresence(h: Harness, youAreEditor: boolean, clientCount = 2, editorId: string | null = 'c1'): void {
  h.cb!.onPresence!(editorId, youAreEditor, clientCount);
}
/** Drive a live `showLibrary` broadcast (the editor's authored push relayed by the server). */
function fireShowLibrary(h: Harness, library: ShowLibraryBlob): void {
  h.cb!.onShowLibrary!(library);
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

describe('cold-load keeps fresh local over a stale server (refresh preserves edits)', () => {
  it('does not adopt the server library when we booted from a local one — keeps local + pushes up', () => {
    withRaf(() => {
      // localStorage holds the user's latest work (their edits, e.g. a moved node → bpm 132 here).
      localStorage.setItem(
        SHOWS_STORAGE_KEY,
        JSON.stringify(serverLib({ id: 'local-1', name: 'Local Show', bpm: 132 })),
      );
      const h: Harness = { cb: null, sent: [] };
      const store = new TriggerLab(harnessClient(h));
      store.start();
      expect(store.bpm).toBe(132); // hydrated from the local cache at boot

      fireOpen(h);
      h.sent.length = 0; // ignore the connect handshake
      // The server still holds an OLDER copy (local saves on every edit; the server push is gated,
      // so the server can lag). It must NOT clobber the fresher local state on cold-load adopt.
      fireState(h, serverLib({ id: 'local-1', name: 'Local Show', bpm: 100 }));

      expect(store.bpm).toBe(132); // local kept — NOT reset to the stale server value (the bug)
      const push = h.sent.find((m) => m.t === 'setShowLibrary');
      expect(push).toBeTruthy(); // local is pushed up to bring the server current
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

/* ── S1 multi-client: presence-derived role + live-follow ─────────────────────────────────────
   The server now holds many clients with one editor. A VIEWER (a non-editor client) live-follows
   the editor's authored broadcast: it adopts every `showLibrary` push and every `state`, with no
   local-wins. The EDITOR/STANDALONE keeps the single-writer local-wins cold-load (above). Role is
   derived purely from the `presence` message. */

describe('role derives from presence (S1)', () => {
  it('maps presence → standalone / editor / viewer', () => {
    const store = new TriggerLab(noopClient);
    expect(store.role).toBe('standalone'); // no presence yet (offline / single user)

    store.presence = { editorId: 'c1', youAreEditor: true, clientCount: 1 };
    expect(store.role).toBe('standalone'); // sole client that edits == standalone

    store.presence = { editorId: 'c1', youAreEditor: true, clientCount: 2 };
    expect(store.role).toBe('editor'); // we edit, others are watching
    expect(store.isViewer).toBe(false);

    store.presence = { editorId: 'c1', youAreEditor: false, clientCount: 2 };
    expect(store.role).toBe('viewer'); // someone else edits → we follow
    expect(store.isViewer).toBe(true);
  });
});

describe('viewer live-follows the editor broadcast (S1)', () => {
  it('adopts a showLibrary broadcast with no refresh', () => {
    withRaf(() => {
      const h: Harness = { cb: null, sent: [] };
      const store = new TriggerLab(harnessClient(h));
      store.start();
      fireOpen(h);
      firePresence(h, /* youAreEditor */ false); // we are a viewer
      // initial cold-load follow via state
      fireState(h, serverLib({ id: 'srv-1', name: 'Server Show', bpm: 100 }));
      expect(store.activeShow!.name).toBe('Server Show');
      expect(store.bpm).toBe(100);

      // the editor edits → the server relays a live showLibrary broadcast → the viewer follows it
      h.sent.length = 0;
      fireShowLibrary(h, serverLib({ id: 'srv-1', name: 'Server Show', bpm: 150 }));
      expect(store.bpm).toBe(150); // live-updated, no state rebuild

      // a viewer never authors upstream — it doesn't echo the adopted library back
      expect(h.sent.some((m) => m.t === 'setShowLibrary')).toBe(false);
      store.stop();
    });
  });

  it('follows the server on state even when it has local content (no local-wins for a viewer)', () => {
    withRaf(() => {
      // the viewer's browser has its own cached library — a single writer would KEEP this, but a
      // viewer must follow the editor's server copy instead.
      localStorage.setItem(
        SHOWS_STORAGE_KEY,
        JSON.stringify(serverLib({ id: 'local-1', name: 'Local Show', bpm: 132 })),
      );
      const h: Harness = { cb: null, sent: [] };
      const store = new TriggerLab(harnessClient(h));
      store.start();
      expect(store.activeShow!.name).toBe('Local Show'); // hydrated from cache at boot

      fireOpen(h);
      firePresence(h, /* youAreEditor */ false); // viewer (presence precedes state on a real connect)
      fireState(h, serverLib({ id: 'srv-1', name: 'Editor Show', bpm: 90 }));

      expect(store.activeShow!.name).toBe('Editor Show'); // adopted the editor's, NOT kept local
      expect(store.bpm).toBe(90);
      expect(h.sent.some((m) => m.t === 'setShowLibrary')).toBe(false); // no seed-push from a viewer
      store.stop();
    });
  });
});

describe('editor ignores a showLibrary broadcast (its own echo) (S1)', () => {
  it('does not adopt a broadcast while it holds the editor role', () => {
    withRaf(() => {
      const h: Harness = { cb: null, sent: [] };
      const store = new TriggerLab(harnessClient(h));
      store.start();
      const ownName = store.activeShow!.name; // the editor's own fresh "Untitled Show"
      fireOpen(h);
      firePresence(h, /* youAreEditor */ true); // we are the editor (clientCount 2)
      expect(store.role).toBe('editor');

      // a relayed broadcast must not clobber the editor's authoritative local content
      fireShowLibrary(h, serverLib({ id: 'evil', name: 'Not Mine', bpm: 999 }));
      expect(store.activeShow!.name).toBe(ownName);
      expect(store.bpm).not.toBe(999);
      store.stop();
    });
  });
});

/* ── S2 takeover, roles & read-only ───────────────────────────────────────────────────────────
   A viewer claims the editor role with takeover() (→ a `takeover` client message); presence then
   re-derives `role`/`canEdit`. A viewer's authoring mutators are genuine no-ops, while the
   indicator-driving state (`canEdit`/`canTakeover`/`editorLabel`) is correct per role. */

describe('takeover sends the role-claim + role flips live on the next presence (S2)', () => {
  it('takeover() emits a `takeover` message; a follow-up presence makes us the editor', () => {
    withRaf(() => {
      const h: Harness = { cb: null, sent: [] };
      const store = new TriggerLab(harnessClient(h));
      store.start();
      fireOpen(h);
      firePresence(h, /* youAreEditor */ false); // we start as a viewer
      expect(store.role).toBe('viewer');
      expect(store.canEdit).toBe(false);
      expect(store.canTakeover).toBe(true);

      h.sent.length = 0;
      store.takeover();
      expect(h.sent).toContainEqual({ t: 'takeover' });

      // the server hands us the slot and re-broadcasts presence → role flips with no refresh
      firePresence(h, /* youAreEditor */ true);
      expect(store.role).toBe('editor');
      expect(store.canEdit).toBe(true);
      expect(store.canTakeover).toBe(false);
      store.stop();
    });
  });
});

describe('indicator-driving state is correct per role (S2)', () => {
  it('maps role → canEdit / canTakeover / editorLabel', () => {
    const store = new TriggerLab(noopClient);
    // standalone (no presence): edits freely, no takeover affordance, plain label
    expect(store.canEdit).toBe(true);
    expect(store.canTakeover).toBe(false);
    expect(store.editorLabel).toBe('Editing');

    store.presence = { editorId: 'c1', youAreEditor: true, clientCount: 2 }; // editor
    expect(store.canEdit).toBe(true);
    expect(store.canTakeover).toBe(false);
    expect(store.editorLabel).toBe("You're editing");

    store.presence = { editorId: 'c1', youAreEditor: false, clientCount: 2 }; // viewer
    expect(store.canEdit).toBe(false);
    expect(store.canTakeover).toBe(true);
    expect(store.editorLabel).toBe('Another client is editing');
  });
});

describe("a viewer's authoring mutators are no-ops (S2)", () => {
  it('blocks structural authoring (shows / songs / sections / graphs) while a viewer', () => {
    const store = new TriggerLab(noopClient);
    store.presence = { editorId: 'c1', youAreEditor: false, clientCount: 2 }; // viewer
    expect(store.isViewer).toBe(true);

    const songCount = store.songs.length;
    const showCount = store.shows.length;
    const graphCount = Object.keys(store.graphs).length;
    const firstSong = store.activeSong!;
    const sectionCount = firstSong.sections.length;

    store.createSong('Nope');
    store.createGraph('Nope');
    store.newShow('Nope');
    store.addSongSection('Nope');
    store.renameShow(store.activeShowId, 'Renamed');
    store.renameSong(firstSong.id, 'Renamed');

    expect(store.songs).toHaveLength(songCount);
    expect(store.shows).toHaveLength(showCount);
    expect(Object.keys(store.graphs)).toHaveLength(graphCount);
    expect(store.activeSong!.sections).toHaveLength(sectionCount);
    expect(store.activeShow!.name).not.toBe('Renamed');
    expect(store.activeSong!.name).not.toBe('Renamed');
  });

  it('blocks fine-grained node setters (setParam / setScope) while a viewer', () => {
    const store = new TriggerLab(noopClient);
    // As standalone (an editor), mint a graph + a play node we can try to mutate later.
    const key = store.createGraph('Test graph');
    const node = store.addNode('play', 0, 0);
    expect(node).not.toBeNull();
    const paramKey = Object.keys(node!.params)[0];
    const paramBefore = paramKey ? node!.params[paramKey] : undefined;
    const scopeBefore = node!.scope;

    store.presence = { editorId: 'c1', youAreEditor: false, clientCount: 2 }; // now a viewer

    if (paramKey) store.setParam(node!, paramKey, 0.123456);
    store.setScope(node!, scopeBefore === 'kit' ? 'drum' : 'kit');

    if (paramKey) expect(node!.params[paramKey]).toBe(paramBefore); // param edit suppressed
    expect(node!.scope).toBe(scopeBefore); // scope edit suppressed
    expect(key).toBeTruthy();
  });

  it('blocks authoritative project mutators (setOutput) while a viewer', () => {
    withRaf(() => {
      const h: Harness = { cb: null, sent: [] };
      const store = new TriggerLab(harnessClient(h));
      store.start();
      fireOpen(h);
      firePresence(h, /* youAreEditor */ false); // viewer
      fireState(h, null); // adopt the authoritative Project
      const before = store.project!.output.host;

      h.sent.length = 0;
      store.setOutput({ host: '10.9.9.9' });

      expect(store.project!.output.host).toBe(before); // local optimistic write suppressed
      expect(h.sent.some((m) => m.t === 'setOutput')).toBe(false); // nothing sent upstream
      store.stop();
    });
  });

  it('resumes authoring once the viewer takes over (presence flips to editor)', () => {
    const store = new TriggerLab(noopClient);
    store.presence = { editorId: 'c1', youAreEditor: false, clientCount: 2 }; // viewer
    const songCount = store.songs.length;
    store.createSong('Nope');
    expect(store.songs).toHaveLength(songCount); // blocked

    store.presence = { editorId: 'c2', youAreEditor: true, clientCount: 2 }; // we took over
    store.createSong('Now allowed');
    expect(store.songs).toHaveLength(songCount + 1); // authoring restored
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
