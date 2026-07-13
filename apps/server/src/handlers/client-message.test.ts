import { describe, expect, it, vi } from 'vitest';
import { defaultProject, SLOT_LABELS, voice } from '@ledrums/core';
import { EngineHost } from '../engine-host';
import { VoiceEngineHost } from '../voice-engine-host';
import { ClientRegistry, type CloseableSocket } from '../client-registry';
import type { Autosaver } from '../autosave';
import { encodeServer, serializeModel, type ClientMessage, type NetworkAdapter, type ServerMessage, type ShowLibraryBlob, type SongLibraryBlob } from '../ws-protocol';
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
interface TunnelHarnessOpts {
  tunnelControl?: { start(): void; stop(): void };
  isTunnelClient?(ws: FakeSocket): boolean;
  listNetworkAdapters?: () => NetworkAdapter[];
}

function harness(opts: TunnelHarnessOpts = {}) {
  const clients = new ClientRegistry<FakeSocket>();
  const host = new EngineHost(defaultProject());
  const autosaver = fakeAutosaver();
  const showLibraryAutosaver = fakeAutosaver();
  const songLibraryAutosaver = fakeAutosaver();
  const slot: { lib: ShowLibraryBlob | null; songLib: SongLibraryBlob | null } = { lib: null, songLib: null };
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
    songLibrary: slot.songLib,
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
    songLibraryAutosaver,
    broadcastJson,
    broadcastPresence,
    broadcastState,
    stateMessage,
    setShowLibrary: (lib) => {
      slot.lib = lib;
    },
    setSongLibrary: (lib) => {
      slot.songLib = lib;
    },
    relayToOthers,
    tunnelControl: opts.tunnelControl,
    isTunnelClient: opts.isTunnelClient,
    listNetworkAdapters: opts.listNetworkAdapters,
    monitor,
  });

  /** Admit a fresh socket (mirrors main's connection handler) and return it. */
  const join = (): FakeSocket => {
    const s = new FakeSocket();
    clients.admit(s);
    return s;
  };

  return { clients, host, autosaver, showLibraryAutosaver, songLibraryAutosaver, slot, handle, join, monitor };
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
    songLibraryAutosaver: base.songLibraryAutosaver,
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
      songLibrary: base.slot.songLib,
      tunnel: null,
    }),
    setShowLibrary: (lib) => {
      base.slot.lib = lib;
    },
    setSongLibrary: (lib) => {
      base.slot.songLib = lib;
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
    generatorId: 'whole-drum',
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
const SONG_LIB: SongLibraryBlob = { version: 1, data: { songs: { 'lib-1': { id: 'lib-1' } } } };

describe('requiresEditor — read-only gating policy (S2)', () => {
  it('exempts engine inputs and pure reads, gates everything authoring (deny-by-default)', () => {
    // Engine inputs (the drummer's hardware) + the role/read messages are never gated.
    for (const t of ['midi', 'osc', 'cc', 'programChange', 'key', 'recallSection', 'listProjects', 'takeover'] as const) {
      expect(requiresEditor(t)).toBe(false);
    }
    // Authoring mutations are editor-only.
    for (const t of ['setShow', 'setShowLibrary', 'setKitTransform', 'setKitOutputs', 'setOutput', 'setInputMap', 'setProject', 'setActiveSection', 'addSong', 'removeSong', 'addSection', 'removeSection', 'setBinding', 'removeBinding', 'setSectionLayerClip', 'addLayer', 'removeLayer', 'addClip', 'removeClip', 'setParam', 'setLayer', 'setTransport', 'loadProject', 'saveProject'] as const) {
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

  it("rejects a non-editor's setSongLibrary (no relay, slot untouched)", () => {
    const { handle, join, slot, songLibraryAutosaver, monitor } = harness();
    join(); // editor
    const viewer = join();

    handle({ t: 'setSongLibrary', library: SONG_LIB }, viewer);

    expect(slot.songLib).toBeNull();
    expect(songLibraryAutosaver.markDirty).not.toHaveBeenCalled();
    expect(monitor).not.toHaveBeenCalled();
  });

  it("accepts the editor's setSongLibrary (adopts the slot + relays to others)", () => {
    const { handle, join, slot, songLibraryAutosaver, monitor } = harness();
    const editor = join();
    const viewer = join();

    handle({ t: 'setSongLibrary', library: SONG_LIB }, editor);

    expect(slot.songLib).toEqual(SONG_LIB);
    expect(songLibraryAutosaver.markDirty).toHaveBeenCalledOnce();
    expect(monitor).toHaveBeenCalledWith({
      type: 'persistence',
      direction: 'local',
      source: 'server',
      destination: 'song-library',
      label: 'Song library update accepted',
    });
    // relayed to the viewer, never echoed to the sender
    expect(viewer.sent.find((m) => m.t === 'songLibrary')).toEqual({ t: 'songLibrary', library: SONG_LIB });
    expect(editor.has('songLibrary')).toBe(false);
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

describe('setProject — bulk device re-rig (S45): validate → apply-once → persist → broadcast', () => {
  /** A valid patch derived from the live project, re-labelling + re-hosting the output so the
      apply is observable. Whole-document Project slices, exactly what a `patch` ClipDoc carries. */
  function patchFrom(host: ReturnType<typeof harness>['host']) {
    const cur = host.engine.getProject();
    return { name: 'Rig B', kit: cur.kit, inputMap: cur.inputMap, output: { ...cur.output, host: '10.0.0.9', protocol: 'sacn' as const } };
  }

  it('validates, applies once, persists, and broadcasts fresh state (legacy engine)', () => {
    const { handle, join, host, autosaver, monitor } = harness();
    const editor = join();

    handle({ t: 'setProject', patch: patchFrom(host) }, editor);

    const applied = host.engine.getProject();
    expect(applied.name).toBe('Rig B');
    expect(applied.output.host).toBe('10.0.0.9');
    expect(applied.output.protocol).toBe('sacn');
    // apply-once → exactly one state broadcast; persisted via markDirty; a monitor apply event.
    expect(editor.sent.filter((m) => m.t === 'state')).toHaveLength(1);
    expect(autosaver.markDirty).toHaveBeenCalledTimes(1);
    expect(monitor).toHaveBeenCalledWith(expect.objectContaining({ type: 'system', label: 'Patch applied' }));
  });

  it('leaves authored composition/setlist untouched (re-rigs only the device)', () => {
    const { handle, join, host } = harness();
    const editor = join();
    const before = host.engine.getProject();
    const composition = before.composition;
    const setlist = before.setlist;

    handle({ t: 'setProject', patch: patchFrom(host) }, editor);

    expect(host.engine.getProject().composition).toEqual(composition);
    expect(host.engine.getProject().setlist).toEqual(setlist);
  });

  it('rejects an invalid payload with a user-visible error and zero partial apply', () => {
    const { handle, join, host, autosaver, monitor } = harness();
    const editor = join();
    const before = host.engine.getProject();

    // kit is required (a kit with no drums fails kitSchema.drums.min(1)); no state may change.
    handle({ t: 'setProject', patch: { kit: { drums: [] }, inputMap: {}, output: {} } } as unknown as ClientMessage, editor);

    const err = editor.sent.find((m): m is Extract<ServerMessage, { t: 'error' }> => m.t === 'error');
    expect(err?.message).toMatch(/Invalid patch/);
    expect(editor.sent.some((m) => m.t === 'state')).toBe(false); // no broadcast
    expect(autosaver.markDirty).not.toHaveBeenCalled(); // not persisted
    expect(host.engine.getProject()).toEqual(before); // zero apply
    expect(monitor).toHaveBeenCalledWith(expect.objectContaining({ type: 'error', label: 'Patch rejected (invalid)' }));
  });

  it('rejects a schema-valid but routing-invalid patch (hoop fan-out) with zero apply (F1)', () => {
    const { handle, join, host, autosaver, monitor } = harness();
    const editor = join();
    const before = host.engine.getProject();

    // A shape-valid ClipDoc whose kit.outputs fans kick hoop 0 across two data lines — the exact
    // corruption setKitOutputs already rejects, now gated on the bulk re-rig path too. Validated
    // against the patch's OWN kit drums (default kick = 4 hoops).
    const fanOut = [
      {
        id: 'out1',
        channelsPerPixel: 3,
        dataLines: [
          // kick hoop 1 (1-based, A1) driven by both lines → schema-valid, routing-invalid (fan-out).
          { id: 'd0', segments: [{ drumId: 'kick', hoopStart: 1, hoopEnd: 1 }] },
          { id: 'd1', segments: [{ drumId: 'kick', hoopStart: 1, hoopEnd: 1 }] },
        ],
      },
    ];
    const patch = { name: 'Rig B', kit: { ...before.kit, outputs: fanOut }, inputMap: before.inputMap, output: before.output };

    handle({ t: 'setProject', patch } as unknown as ClientMessage, editor);

    const err = editor.sent.find((m): m is Extract<ServerMessage, { t: 'error' }> => m.t === 'error');
    expect(err?.message).toMatch(/Invalid patch outputs/);
    expect(editor.sent.some((m) => m.t === 'state')).toBe(false); // no broadcast
    expect(autosaver.markDirty).not.toHaveBeenCalled(); // not persisted
    expect(host.engine.getProject()).toEqual(before); // zero apply
    expect(monitor).toHaveBeenCalledWith(expect.objectContaining({ type: 'error', label: 'Patch rejected (invalid routing)' }));
  });

  it('bulk-adopts the same slices into the voice host (single kit reload)', () => {
    const { handle, join, host, voiceHost } = voiceHarness();
    const editor = join();

    handle({ t: 'setProject', patch: patchFrom(host) }, editor);

    expect(voiceHost.getProject().name).toBe('Rig B');
    expect(voiceHost.getProject().output.host).toBe('10.0.0.9');
    expect(voiceHost.getProject().output.protocol).toBe('sacn');
  });

  it('ignores a viewer setProject (read-only gate), applies once taken over', () => {
    const { handle, join, host } = harness();
    join(); // editor (c1)
    const viewer = join(); // c2

    handle({ t: 'setProject', patch: patchFrom(host) }, viewer);
    expect(host.engine.getProject().name).not.toBe('Rig B'); // rejected

    handle({ t: 'takeover' }, viewer);
    handle({ t: 'setProject', patch: patchFrom(host) }, viewer);
    expect(host.engine.getProject().name).toBe('Rig B'); // now accepted
  });
});

describe('setKitOutputs — schema gate (S01): validate before any state, no partial apply', () => {
  /** A minimal valid output topology (one PixLite port, one data line, one hoop segment). */
  const validOutputs = [
    { id: 'out1', channelsPerPixel: 3, dataLines: [{ id: 'out1:dl0', segments: [{ drumId: 'kick', hoopStart: 1, hoopEnd: 4 }] }] }, // 1-based (A1)
  ];

  /** The incident's corruption shapes — each fails `outputSchema` on a different field. */
  const channelsPerPixelZero: unknown = [{ id: 'out1', channelsPerPixel: 0, dataLines: [{ id: 'd', segments: [{ drumId: 'kick', hoopStart: 1, hoopEnd: 4 }] }] }];
  const invalidCases: Array<[string, unknown]> = [
    ['channelsPerPixel: 0', channelsPerPixelZero],
    ['empty dataLines', [{ id: 'out1', channelsPerPixel: 3, dataLines: [] }]],
    ['negative hoop range', [{ id: 'out1', channelsPerPixel: 3, dataLines: [{ id: 'd', segments: [{ drumId: 'kick', hoopStart: -1, hoopEnd: 3 }] }] }]],
  ];

  it('applies a valid outputs payload (fresh state broadcast + persisted, no error)', () => {
    const { handle, join, autosaver } = harness();
    const editor = join();

    handle({ t: 'setKitOutputs', outputs: validOutputs }, editor);

    expect(editor.sent.some((m) => m.t === 'error')).toBe(false);
    expect(editor.sent.filter((m) => m.t === 'state')).toHaveLength(1);
    expect(autosaver.markDirty).toHaveBeenCalledTimes(1);
  });

  it.each(invalidCases)('rejects %s with a user-visible error and zero apply', (_label, outputs) => {
    const { handle, join, autosaver, monitor } = harness();
    const editor = join();

    handle({ t: 'setKitOutputs', outputs } as unknown as ClientMessage, editor);

    const err = editor.sent.find((m): m is Extract<ServerMessage, { t: 'error' }> => m.t === 'error');
    expect(err?.message).toMatch(/Invalid outputs/);
    expect(editor.sent.some((m) => m.t === 'state')).toBe(false); // no broadcast
    expect(autosaver.markDirty).not.toHaveBeenCalled(); // not persisted
    expect(monitor).toHaveBeenCalledWith(expect.objectContaining({ type: 'error', label: 'Outputs rejected (invalid)' }));
  });

  it('never touches voice-host routing on an invalid payload; applies a valid one', () => {
    const { handle, join, voiceHost } = voiceHarness();
    const editor = join();
    const spy = vi.spyOn(voiceHost, 'setKitOutputs');

    handle({ t: 'setKitOutputs', outputs: channelsPerPixelZero } as unknown as ClientMessage, editor);
    expect(spy).not.toHaveBeenCalled(); // last-known-good routing stays live

    handle({ t: 'setKitOutputs', outputs: validOutputs }, editor);
    expect(spy).toHaveBeenCalledWith(validOutputs); // valid → propagated to the host
  });

  it('ignores a viewer setKitOutputs (read-only gate) — no error, no apply', () => {
    const { handle, join, autosaver } = harness();
    join(); // editor (c1)
    const viewer = join(); // c2

    handle({ t: 'setKitOutputs', outputs: validOutputs }, viewer);

    expect(viewer.sent.some((m) => m.t === 'state')).toBe(false);
    expect(autosaver.markDirty).not.toHaveBeenCalled();
  });

  // S07: the gate now also runs core routing-integrity — these payloads PASS the schema
  // (well-formed shape) but are referentially/structurally invalid against the live kit
  // (defaultProject: kick has 4 hoops). Same reply/monitor contract, zero state.
  const integrityCases: Array<[string, unknown]> = [
    // A segment referencing a drum the kit doesn't define (hoops 1-based, A1).
    ['dangling drum ref', [{ id: 'out1', channelsPerPixel: 3, dataLines: [{ id: 'd', segments: [{ drumId: 'ghost', hoopStart: 1, hoopEnd: 1 }] }] }]],
    // hoopEnd 10 with a 4-hoop kick — schema-valid (positive ints), routing-invalid.
    ['out-of-range hoop', [{ id: 'out1', channelsPerPixel: 3, dataLines: [{ id: 'd', segments: [{ drumId: 'kick', hoopStart: 1, hoopEnd: 10 }] }] }]],
    // kick hoop 1 driven by two data lines — a fan-out buildDmxMap would silently overwrite.
    ['hoop fan-out across data lines', [{ id: 'out1', channelsPerPixel: 3, dataLines: [{ id: 'd0', segments: [{ drumId: 'kick', hoopStart: 1, hoopEnd: 1 }] }, { id: 'd1', segments: [{ drumId: 'kick', hoopStart: 1, hoopEnd: 1 }] }] }]],
  ];

  it.each(integrityCases)('rejects %s (schema-valid, routing-invalid) with a user-visible error and zero apply', (_label, outputs) => {
    const { handle, join, autosaver, monitor } = harness();
    const editor = join();

    handle({ t: 'setKitOutputs', outputs } as unknown as ClientMessage, editor);

    const err = editor.sent.find((m): m is Extract<ServerMessage, { t: 'error' }> => m.t === 'error');
    expect(err?.message).toMatch(/Invalid outputs/);
    expect(editor.sent.some((m) => m.t === 'state')).toBe(false); // no broadcast
    expect(autosaver.markDirty).not.toHaveBeenCalled(); // not persisted
    expect(monitor).toHaveBeenCalledWith(expect.objectContaining({ type: 'error', label: 'Outputs rejected (invalid)' }));
  });

  it('never touches voice-host routing on a routing-invalid (but schema-valid) payload', () => {
    const { handle, join, voiceHost } = voiceHarness();
    const editor = join();
    const spy = vi.spyOn(voiceHost, 'setKitOutputs');

    const danglingRef = [{ id: 'out1', channelsPerPixel: 3, dataLines: [{ id: 'd', segments: [{ drumId: 'ghost', hoopStart: 1, hoopEnd: 1 }] }] }];
    handle({ t: 'setKitOutputs', outputs: danglingRef } as unknown as ClientMessage, editor);
    expect(spy).not.toHaveBeenCalled(); // last-known-good routing stays live

    handle({ t: 'setKitOutputs', outputs: validOutputs }, editor);
    expect(spy).toHaveBeenCalledWith(validOutputs); // valid → propagated to the host
  });
});

describe('tunnel control message (item 4): editor-gated AND refused for tunnel-riding clients', () => {
  function tunnelHarness(viaTunnel: Set<FakeSocket> = new Set()) {
    const tunnelControl = { start: vi.fn(), stop: vi.fn() };
    const h = harness({ tunnelControl, isTunnelClient: (ws) => viaTunnel.has(ws) });
    return { ...h, tunnelControl, viaTunnel };
  }

  it("requiresEditor('tunnel') — deny-by-default covers the new message", () => {
    expect(requiresEditor('tunnel')).toBe(true);
  });

  it('the local editor can start and stop the tunnel', () => {
    const { handle, join, tunnelControl } = tunnelHarness();
    const editor = join();
    handle({ t: 'tunnel', action: 'start' }, editor);
    expect(tunnelControl.start).toHaveBeenCalledTimes(1);
    handle({ t: 'tunnel', action: 'stop' }, editor);
    expect(tunnelControl.stop).toHaveBeenCalledTimes(1);
  });

  it('a viewer cannot control the tunnel (editor gate)', () => {
    const { handle, join, tunnelControl } = tunnelHarness();
    join(); // editor
    const viewer = join();
    handle({ t: 'tunnel', action: 'stop' }, viewer);
    handle({ t: 'tunnel', action: 'start' }, viewer);
    expect(tunnelControl.start).not.toHaveBeenCalled();
    expect(tunnelControl.stop).not.toHaveBeenCalled();
  });

  it('a tunnel-riding client cannot stop the tunnel EVEN after takeover — refused with a visible error', () => {
    const viaTunnel = new Set<FakeSocket>();
    const { handle, join, tunnelControl } = tunnelHarness(viaTunnel);
    join(); // local editor
    const remote = join();
    viaTunnel.add(remote);
    handle({ t: 'takeover' }, remote); // remote grabs the editor slot
    handle({ t: 'tunnel', action: 'stop' }, remote);
    handle({ t: 'tunnel', action: 'start' }, remote);
    expect(tunnelControl.stop).not.toHaveBeenCalled();
    expect(tunnelControl.start).not.toHaveBeenCalled();
    const err = remote.sent.find((m): m is Extract<ServerMessage, { t: 'error' }> => m.t === 'error');
    expect(err?.message).toMatch(/host/);
  });

  it('is a safe no-op when the wiring provides no tunnel control', () => {
    const { handle, join } = harness();
    expect(() => handle({ t: 'tunnel', action: 'start' }, join())).not.toThrow();
  });
});

describe('listNetworkAdapters (subnet-guidance read)', () => {
  const adapters: NetworkAdapter[] = [
    { name: 'Ethernet', address: '192.168.1.10', netmask: '255.255.255.0', cidr: '192.168.1.10/24', subnet: '192.168.1.0/24', recommendedIp: '192.168.1.50' },
  ];

  it('replies to the SENDER with the enumerated adapters', () => {
    const { handle, join } = harness({ listNetworkAdapters: () => adapters });
    const s = join();
    handle({ t: 'listNetworkAdapters' }, s);
    const reply = s.sent.find((m): m is Extract<ServerMessage, { t: 'networkAdapters' }> => m.t === 'networkAdapters');
    expect(reply?.adapters).toEqual(adapters);
  });

  it('is ungated — a viewer (non-editor) still gets the adapter list', () => {
    const { handle, join } = harness({ listNetworkAdapters: () => adapters });
    join(); // editor
    const viewer = join();
    handle({ t: 'listNetworkAdapters' }, viewer);
    expect(viewer.has('networkAdapters')).toBe(true);
  });

  it('replies with an empty list when the wiring provides no enumerator', () => {
    const { handle, join } = harness();
    const s = join();
    handle({ t: 'listNetworkAdapters' }, s);
    const reply = s.sent.find((m): m is Extract<ServerMessage, { t: 'networkAdapters' }> => m.t === 'networkAdapters');
    expect(reply?.adapters).toEqual([]);
  });
});
