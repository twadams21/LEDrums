import { describe, expect, it, vi } from 'vitest';
import { defaultProject, SLOT_LABELS, voice } from '@ledrums/core';
import { EngineHost } from '../engine-host';
import { VoiceEngineHost } from '../voice-engine-host';
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
  const monitor = vi.fn();

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
    monitor,
  });

  /** Admit a fresh socket (mirrors main's connection handler) and return it. */
  const join = (): FakeSocket => {
    const s = new FakeSocket();
    clients.admit(s);
    return s;
  };

  return { clients, host, autosaver, showLibraryAutosaver, slot, handle, join, monitor };
}

function voiceHarness() {
  const base = harness();
  const project = base.host.engine.getProject();
  const voiceHost = new VoiceEngineHost(project);
  voiceHost.setMonitor(base.monitor);
  const handleInner = createClientMessageHandler<FakeSocket>({
    clients: base.clients,
    host: base.host,
    voiceHost,
    autosaver: base.autosaver,
    showLibraryAutosaver: base.showLibraryAutosaver,
    broadcastJson: (msg) => {
      for (const s of base.clients) if (s.readyState === s.OPEN) s.send(encodeServer(msg));
    },
    broadcastPresence: () => {
      for (const s of base.clients) if (s.readyState === s.OPEN) s.send(encodeServer({ t: 'presence', ...base.clients.presenceFor(s) }));
    },
    broadcastState: () => {},
    stateMessage: () => ({
      t: 'state',
      project,
      model: serializeModel(voiceHost.getModel()),
      effects: [],
      projects: [],
      output: voiceHost.getOutputStatus(),
      showLibrary: base.slot.lib,
      tunnel: null,
    }),
    setShowLibrary: (lib) => {
      base.slot.lib = lib;
    },
    relayToOthers: (sender, msg) => {
      const data = encodeServer(msg);
      for (const s of base.clients) if (s !== sender && s.readyState === s.OPEN) s.send(data);
    },
    monitor: base.monitor,
  });
  const handle = (msg: ClientMessage, ws: FakeSocket): void => {
    if (msg.t === 'midi') {
      base.monitor({
        type: 'input',
        direction: 'in',
        source: 'ws',
        destination: 'voice-engine',
        label: `MIDI ${msg.on ? 'note on' : 'note off'} ${msg.note}`,
        detail: `velocity=${msg.velocity}${msg.channel != null ? `; channel=${msg.channel}` : ''}`,
      });
    }
    handleInner(msg, ws);
  };
  return { ...base, voiceHost, handle };
}

function voiceEffect(id: string): voice.EffectDef {
  return {
    id,
    name: id,
    pattern: 'flash',
    busId: 'main',
    scope: 'kit',
    params: [{ key: 'brightness', label: 'Brightness', kind: 'number', min: 0, max: 1, default: 1 }],
    attackMs: 0,
    sustainMs: 200,
    releaseMs: 200,
  };
}

function voiceNode(kind: voice.GraphNode['kind'], id: string, over: Partial<voice.GraphNode> = {}): voice.GraphNode {
  return {
    id,
    kind,
    x: 0,
    y: 0,
    mode: 'oneshot',
    scope: 'kit',
    effectId: '',
    presetId: '',
    busId: '',
    params: {},
    env: {},
    linked: false,
    noRepeat: false,
    on: 'value',
    valueMode: 'gate',
    threshold: 0.5,
    invert: false,
    bands: [0.5],
    p: 1,
    delayMode: 'time',
    ms: 0,
    division: '1/8',
    ...over,
  };
}

function midiVoiceShow(note: number): voice.Show {
  const graph: voice.TriggerGraph = {
    nodes: [
      voiceNode('trigger', 'trigger', { source: { kind: 'midi', note } }),
      voiceNode('play', 'play', { effectId: 'fx-flash', params: { brightness: 1 } }),
    ],
    edges: [{ id: 'e1', from: 'trigger', to: 'play' }],
  };
  return {
    buses: [{ id: 'main', name: 'Main', polyphony: 'poly', crossfadeMs: 200 }],
    graphs: { 'graph:midi': graph },
    sections: [],
    effects: [voiceEffect('fx-flash')],
    presets: [],
    songs: [{ id: 'song1', name: 'Song', sections: [{ id: 'section1', name: 'Section', slots: { [voice.padKey('kick', SLOT_LABELS[0])]: [] } }] }],
  };
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
    const { handle, join, slot, showLibraryAutosaver, monitor } = harness();
    const editor = join();
    const viewer = join();

    handle({ t: 'setShowLibrary', library: LIB }, viewer); // viewer is not the editor

    expect(slot.lib).toBeNull(); // not adopted
    expect(showLibraryAutosaver.markDirty).not.toHaveBeenCalled();
    expect(monitor).not.toHaveBeenCalled();
    expect(editor.has('showLibrary')).toBe(false); // not relayed to the editor
  });

  it("accepts the editor's setShowLibrary (adopts the slot + relays to others)", () => {
    const { handle, join, slot, showLibraryAutosaver, monitor } = harness();
    const editor = join();
    const viewer = join();

    handle({ t: 'setShowLibrary', library: LIB }, editor);

    expect(slot.lib).toEqual(LIB);
    expect(showLibraryAutosaver.markDirty).toHaveBeenCalledOnce();
    expect(monitor).toHaveBeenCalledWith({
      type: 'persistence',
      direction: 'local',
      source: 'server',
      destination: 'show-library',
      label: 'Show library update accepted',
    });
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

  it('drops MIDI messages outside the app channel filter', () => {
    const { handle, join, host } = harness();
    const editor = join();
    host.engine.setInputMap({ ...host.engine.getProject().inputMap, midiChannel: 10 });

    handle({ t: 'midi', note: 38, velocity: 100, on: true, channel: 9 }, editor);
    expect(editor.sent.some((m) => m.t === 'input')).toBe(false);

    handle({ t: 'midi', note: 38, velocity: 100, on: true, channel: 10 }, editor);
    expect(editor.sent.find((m) => m.t === 'input')).toMatchObject({ t: 'input', kind: 'midi', note: 38, channel: 10 });
  });

  it('voice mode accepts viewer MIDI and emits inbound plus graph monitor events', () => {
    const { handle, join, voiceHost, monitor } = voiceHarness();
    join();
    const viewer = join();
    voiceHost.setShow(midiVoiceShow(38));

    handle({ t: 'midi', note: 38, velocity: 100, on: true }, viewer);
    for (let i = 0; i < 4; i++) voiceHost.step(1000 / 120);

    expect(monitor).toHaveBeenCalledWith(
      expect.objectContaining({
        type: 'input',
        direction: 'in',
        source: 'ws',
        destination: 'voice-engine',
      }),
    );
    expect(monitor).toHaveBeenCalledWith(
      expect.objectContaining({
        type: 'graph',
        direction: 'local',
        source: 'server/voice',
        destination: 'graph:graph:midi',
      }),
    );
  });

  it('voice mode drops out-of-channel MIDI before graph diagnostics', () => {
    const { handle, join, host, voiceHost, monitor } = voiceHarness();
    const editor = join();
    host.engine.setInputMap({ ...host.engine.getProject().inputMap, midiChannel: 10 });
    voiceHost.setInputMap(host.engine.getProject().inputMap);
    voiceHost.setShow(midiVoiceShow(38));

    handle({ t: 'midi', note: 38, velocity: 100, on: true, channel: 9 }, editor);
    for (let i = 0; i < 4; i++) voiceHost.step(1000 / 120);

    expect(monitor).toHaveBeenCalledWith(expect.objectContaining({ type: 'input', source: 'ws' }));
    expect(monitor).not.toHaveBeenCalledWith(expect.objectContaining({ type: 'graph', source: 'server/voice' }));
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
