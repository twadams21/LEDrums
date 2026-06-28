import { describe, expect, it, vi } from 'vitest';
import { defaultProject } from '@ledrums/core';
import { EngineHost } from '../engine-host';
import { ClientRegistry, type CloseableSocket } from '../client-registry';
import type { Autosaver } from '../autosave';
import { encodeServer, serializeModel, type ClientMessage, type ServerMessage, type ShowLibraryBlob } from '../ws-protocol';
import { createClientMessageHandler, requiresEditor, type HandlerSocket } from './client-message';

/* S2 server handler integration (multi-socket capturing harness, same style as the S1 registry
   tests): `takeover` flips the editor role + re-broadcasts `presence` to every client; the
   read-only gate rejects a non-editor's authoring mutations (silent no-op) while engine inputs
   from anyone always drive the engine. A fake socket captures every server frame it receives. */

/** A fake client socket: closeable + JSON-send, capturing every decoded frame it is sent. */
class FakeSocket implements HandlerSocket, CloseableSocket {
  readonly OPEN = 1;
  readyState = 1;
  readonly sent: ServerMessage[] = [];
  send(data: string): void {
    this.sent.push(JSON.parse(data) as ServerMessage);
  }
  close(): void {}
  /** The most recent `presence` frame this socket received (the role indicator under test). */
  lastPresence(): Extract<ServerMessage, { t: 'presence' }> | undefined {
    return [...this.sent].reverse().find((m): m is Extract<ServerMessage, { t: 'presence' }> => m.t === 'presence');
  }
  has(t: ServerMessage['t']): boolean {
    return this.sent.some((m) => m.t === t);
  }
}

/** A no-op autosaver — the handler only calls markDirty (we assert it separately where relevant). */
function fakeAutosaver(): Autosaver {
  return { markDirty: vi.fn(), flush: () => Promise.resolve(), dispose: () => {} };
}

/** Build the handler + its wiring over a real registry/engine, mirroring main.ts. Returns the
    registry, the live show-library slot ref, and per-socket admit so tests drive a real scenario. */
function harness() {
  const clients = new ClientRegistry<FakeSocket>();
  const host = new EngineHost(defaultProject());
  const autosaver = fakeAutosaver();
  const showLibraryAutosaver = fakeAutosaver();
  const slot: { lib: ShowLibraryBlob | null } = { lib: null };

  const broadcastJson = (msg: ServerMessage): void => {
    for (const s of clients) if (s.readyState === s.OPEN) s.send(encodeServer(msg));
  };
  const broadcastPresence = (): void => {
    for (const s of clients) if (s.readyState === s.OPEN) s.send(encodeServer({ t: 'presence', ...clients.presenceFor(s) }));
  };
  const stateMessage = (): ServerMessage => ({
    t: 'state',
    project: host.engine.getProject(),
    model: serializeModel(host.engine.getModel()),
    effects: [],
    projects: [],
    output: host.getOutputStatus(),
    showLibrary: slot.lib,
    tunnel: null,
  });
  const broadcastState = (): void => broadcastJson(stateMessage());
  const relayToOthers = (sender: FakeSocket, msg: ServerMessage): void => {
    const data = encodeServer(msg);
    for (const s of clients) if (s !== sender && s.readyState === s.OPEN) s.send(data);
  };

  const handle = createClientMessageHandler<FakeSocket>({
    clients,
    host,
    voiceHost: null,
    autosaver,
    showLibraryAutosaver,
    broadcastJson,
    broadcastPresence,
    broadcastState,
    stateMessage,
    setShowLibrary: (lib) => {
      slot.lib = lib;
    },
    relayToOthers,
  });

  /** Admit a fresh socket (mirrors main's connection handler) and return it. */
  const join = (): FakeSocket => {
    const s = new FakeSocket();
    clients.admit(s);
    return s;
  };

  return { clients, host, autosaver, showLibraryAutosaver, slot, handle, join };
}

const LIB: ShowLibraryBlob = { version: 1, data: { hello: 'world' } };

describe('requiresEditor — read-only gating policy (S2)', () => {
  it('exempts engine inputs and pure reads, gates everything authoring (deny-by-default)', () => {
    // Engine inputs (the drummer's hardware) + the role/read messages are never gated.
    for (const t of ['midi', 'osc', 'cc', 'programChange', 'key', 'recallSection', 'listProjects', 'takeover'] as const) {
      expect(requiresEditor(t)).toBe(false);
    }
    // Authoring mutations are editor-only.
    for (const t of ['setShow', 'setShowLibrary', 'setKitTransform', 'setKitOutputs', 'setOutput', 'setInputMap', 'setActiveSection', 'addSong', 'removeSong', 'addSection', 'removeSection', 'setBinding', 'removeBinding', 'setSectionLayerClip', 'addLayer', 'removeLayer', 'addClip', 'removeClip', 'setParam', 'setLayer', 'setTransport', 'loadProject', 'saveProject'] as const) {
      expect(requiresEditor(t)).toBe(true);
    }
  });
});

describe('takeover flips roles + re-broadcasts presence to all (S2)', () => {
  it('hands the editor slot to the claimant; every client converges on the new editor', () => {
    const { handle, join } = harness();
    const a = join(); // first in → auto-editor
    const b = join(); // viewer

    handle({ t: 'takeover' }, b); // b claims the editor role

    // Every client got a fresh presence reflecting the new editor (each its own youAreEditor).
    expect(a.lastPresence()).toMatchObject({ editorId: 'c2', youAreEditor: false, clientCount: 2 });
    expect(b.lastPresence()).toMatchObject({ editorId: 'c2', youAreEditor: true, clientCount: 2 });
  });

  it('resolves near-simultaneous takeovers last-press-wins', () => {
    const { handle, join } = harness();
    const a = join();
    const b = join();
    const c = join();

    handle({ t: 'takeover' }, b);
    handle({ t: 'takeover' }, c); // last press wins

    for (const s of [a, b, c]) expect(s.lastPresence()!.editorId).toBe('c3');
    expect(c.lastPresence()!.youAreEditor).toBe(true);
    expect(a.lastPresence()!.youAreEditor).toBe(false);
    expect(b.lastPresence()!.youAreEditor).toBe(false);
  });
});

describe('read-only gating: authoring is editor-only, engine inputs are not (S2)', () => {
  it("rejects a non-editor's setShowLibrary (no relay, slot untouched)", () => {
    const { handle, join, slot, showLibraryAutosaver } = harness();
    const editor = join();
    const viewer = join();

    handle({ t: 'setShowLibrary', library: LIB }, viewer); // viewer is not the editor

    expect(slot.lib).toBeNull(); // not adopted
    expect(showLibraryAutosaver.markDirty).not.toHaveBeenCalled();
    expect(editor.has('showLibrary')).toBe(false); // not relayed to the editor
  });

  it("accepts the editor's setShowLibrary (adopts the slot + relays to others)", () => {
    const { handle, join, slot, showLibraryAutosaver } = harness();
    const editor = join();
    const viewer = join();

    handle({ t: 'setShowLibrary', library: LIB }, editor);

    expect(slot.lib).toEqual(LIB);
    expect(showLibraryAutosaver.markDirty).toHaveBeenCalledOnce();
    // relayed to the OTHER client (the viewer) but never echoed back to the sender.
    const relayed = viewer.sent.find((m) => m.t === 'showLibrary');
    expect(relayed).toEqual({ t: 'showLibrary', library: LIB });
    expect(editor.has('showLibrary')).toBe(false);
  });

  it('accepts engine inputs (midi) from a viewer regardless of role', () => {
    const { handle, join } = harness();
    join(); // editor
    const viewer = join();

    handle({ t: 'midi', note: 38, velocity: 100, on: true }, viewer);

    // A midi input echoes an `input` monitor frame — proof the gate let it reach the engine.
    const monitor = viewer.sent.find((m) => m.t === 'input');
    expect(monitor).toMatchObject({ t: 'input', kind: 'midi' });
  });

  it('rejects a viewer mutation but applies it once the viewer takes over', () => {
    const { handle, join, slot } = harness();
    join(); // editor (c1)
    const viewer = join(); // c2

    handle({ t: 'setShowLibrary', library: LIB }, viewer);
    expect(slot.lib).toBeNull(); // still a viewer → rejected

    handle({ t: 'takeover' }, viewer); // c2 becomes the editor (live role switch)
    handle({ t: 'setShowLibrary', library: LIB }, viewer);
    expect(slot.lib).toEqual(LIB); // now accepted
  });
});
