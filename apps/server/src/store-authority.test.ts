import { describe, expect, it, vi } from 'vitest';
import { defaultProject, type Project } from '@ledrums/core';
import type { PixelOutput } from '@ledrums/io';
import { createClientMessageHandler, type ClientMessageDeps, type HandlerSocket } from './handlers/client-message';
import { OutputManager } from './output-manager';
import { VoiceEngineHost } from './voice-engine-host';
import type { Autosaver } from './autosave';
import { serializeModel, type ClientMessage, type ServerMessage } from './ws-protocol';

/** A load must exercise the WIRING, not the filesystem: the "file" is a project deliberately
 * different from the live default, so a missing re-point is visible rather than plausible. */
function fileOnDisk(): Project {
  const p = defaultProject();
  p.name = 'On Disk';
  p.composition.transport = { bpm: 155, playing: false, beatsPerBar: 3 };
  return p;
}

vi.mock('./projects', () => ({
  loadProject: vi.fn(() => fileOnDisk()),
  listProjects: vi.fn(() => []),
  saveProject: vi.fn(),
}));

/**
 * INIT-01 S8/S12 — THE STORE-AUTHORITY WIRING TEST.
 *
 * main.ts is a side-effecting entry module no test can import, which is precisely how its central
 * invariant came to live in a comment instead of an assertion: "both hosts share the same project0
 * object by reference, so the voice host's in-place edits are visible through
 * `host.engine.getProject()` — which is what the autosaver persists." That sentence was TRUE at
 * construction and FALSE after the first `adoptPatch` (which rebuilds `project` by spread) and after
 * the first `loadProject`. Nothing failed when it broke.
 *
 * S8 turned it into an assertion by constructing the legacy engine over the store's OWN project
 * object and asserting `toBe` through both swap paths. S12 then deleted that engine — so there is no
 * second holder left to diverge, and what this file asserts is the property the identity existed to
 * protect: the object the reducer writes is the object every reader gets.
 *
 *  • ONE OBJECT — a paste and a load both leave the store holding the document itself, and the
 *    `state` broadcast carries that very object rather than a copy.
 *  • ONE REDUCER — `applyStructuralMessage` is the only writer; its boolean IS the
 *    broadcast-and-persist signal, so a missing arm is a silent no-op and every arm is enumerated.
 */

/** Inert pixel sink: nothing here arms output, and a real UDP socket in a unit test is a flake. */
class NoOutput implements PixelOutput {
  nextFrame(): void {}
  send(): void {}
  close(): void {}
}

/** A fake client socket capturing every server frame it is sent. */
class FakeSocket implements HandlerSocket {
  readonly OPEN = 1;
  readyState = 1;
  readonly sent: ServerMessage[] = [];
  send(data: string): void {
    this.sent.push(JSON.parse(data) as ServerMessage);
  }
  close(): void {}
}

function fakeAutosaver(): Autosaver {
  return { markDirty: vi.fn(), flush: () => Promise.resolve(), dispose: () => {} };
}

/** main.ts's wiring, reproduced. The `state` builder mirrors main's `stateMessage` exactly — every
 * field off the one store. */
function wiring() {
  const voiceHost = new VoiceEngineHost(defaultProject(), null, new OutputManager(() => new NoOutput()));
  const autosaver = fakeAutosaver();
  const broadcasts: ServerMessage[] = [];

  const stateMessage = (): ServerMessage => ({
    t: 'state',
    project: voiceHost.getProject(),
    model: serializeModel(voiceHost.getModel()),
    effects: [],
    projects: [],
    output: voiceHost.getOutputStatus(),
    showLibrary: null,
    songLibrary: null,
    tunnel: null,
    osc: { status: 'listening', port: 9000, hosts: [] },
    recovery: null,
  });

  const clients = {
    admit: () => {},
    takeover: () => {},
    canMutate: () => true,
    presenceFor: () => ({ editorId: 'c1', youAreEditor: true, clientCount: 1 }),
    remove: () => {},
    [Symbol.iterator]: function* () {},
  } as unknown as ClientMessageDeps<FakeSocket>['clients'];

  const handle = createClientMessageHandler<FakeSocket>({
    clients,
    voiceHost,
    autosaver,
    showLibraryAutosaver: fakeAutosaver(),
    songLibraryAutosaver: fakeAutosaver(),
    broadcastJson: (msg) => broadcasts.push(msg),
    broadcastPresence: () => {},
    broadcastState: () => broadcasts.push(stateMessage()),
    stateMessage,
    setShowLibrary: () => {},
    setSongLibrary: () => {},
    relayToOthers: () => {},
    tunnelControl: { start: () => {}, stop: () => {} },
    isTunnelClient: () => false,
    listNetworkAdapters: () => [],
    backups: { list: () => [], restore: () => false, snapshotPreRisk: () => true },
    controller: {
      discover: () => Promise.resolve(undefined),
      adopt: () => Promise.resolve({ ok: false }),
      setAuth: () => {},
      identify: () => Promise.resolve(),
      setTestData: () => Promise.resolve(),
      backToLive: () => Promise.resolve(),
      watch: () => {},
      dropWatcher: () => {},
    },
    monitor: () => {},
  });

  const ws = new FakeSocket();
  const send = (msg: ClientMessage): void => handle(msg, ws);
  return { voiceHost, autosaver, broadcasts, send, ws, stateMessage };
}

/** A patch derived from the live project — the payload shape a pasted `patch` ClipDoc carries. */
function patchFrom(project: Project) {
  return {
    name: 'Rig B',
    kit: project.kit,
    inputMap: project.inputMap,
    output: { ...project.output, host: '10.0.0.9', protocol: 'sacn' as const },
  };
}

describe('S8/S12 — one project object, through every swap', () => {
  it('a paste leaves the store holding the object the wire carries', () => {
    const { voiceHost, send, broadcasts } = wiring();

    send({ t: 'setProject', patch: patchFrom(voiceHost.getProject()) });

    expect(voiceHost.getProject().name).toBe('Rig B'); // the paste really landed
    expect(voiceHost.getProject().output.host).toBe('10.0.0.9');
    // adoptPatch REBUILDS the project by spread — historically the point two holders diverged.
    // `toBe`, not `toEqual`: an equal copy on the wire would mean two sources of truth again.
    const state = broadcasts.filter((m): m is Extract<ServerMessage, { t: 'state' }> => m.t === 'state').at(-1);
    expect(state!.project).toBe(voiceHost.getProject());
  });

  it('a load replaces the object and the wire follows it', () => {
    const { voiceHost, send, broadcasts } = wiring();
    const before = voiceHost.getProject();

    send({ t: 'loadProject', name: 'p' });

    expect(voiceHost.getProject()).not.toBe(before); // a load REPLACES the object
    expect(voiceHost.getProject().name).toBe('On Disk');
    const state = broadcasts.filter((m): m is Extract<ServerMessage, { t: 'state' }> => m.t === 'state').at(-1);
    expect(state!.project).toBe(voiceHost.getProject());
  });

  it('the autosaver reads the same object the reducer wrote (what identity was protecting)', () => {
    const { voiceHost, send } = wiring();

    // main's autosaver closes over `voiceHost.getProject()`; the reducer edits it in place.
    const persisted = () => voiceHost.getProject();
    const target = persisted().kit.drums.find((d) => d.id === 'kick')!.hoops![0]!.pixelCount + 13;
    send({ t: 'setHoopConfig', drumId: 'kick', hoopIndex: 1, pixelCount: target });

    expect(persisted().kit.drums.find((d) => d.id === 'kick')!.hoops![0]!.pixelCount).toBe(target);
  });
});

describe('S8 — one reducer: a structural edit lands exactly once', () => {
  it('applies through the store and reports itself as structural (state broadcast + persisted)', () => {
    const { voiceHost, autosaver, broadcasts, send } = wiring();

    send({ t: 'setTransport', bpm: 137, beatsPerBar: 7 });

    expect(voiceHost.getProject().composition.transport).toMatchObject({ bpm: 137, beatsPerBar: 7 });
    expect(broadcasts.filter((m) => m.t === 'state')).toHaveLength(1);
    expect(autosaver.markDirty).toHaveBeenCalledTimes(1);
  });

  it('a routing rewire needs no follow-up reloadOutputSettings from the caller', () => {
    const { voiceHost, broadcasts, send } = wiring();
    const reload = vi.spyOn(voiceHost, 'reloadOutputSettings');

    send({ t: 'setKitOutputs', outputs: [{ id: 'out1', channelsPerPixel: 3, segments: [{ drumId: 'kick', hoopStart: 1, hoopEnd: 4 }] }] });

    // The pre-S8 handler carried a hand-maintained list of "messages that ALSO need
    // reloadOutputSettings" next to a legacy reducer that had no setKitOutputs arm at all — the
    // known drift engine-parity.test.ts records. The reducer arm now owns the rebuild.
    expect(reload).toHaveBeenCalled();
    expect(voiceHost.getProject().kit.outputs[0]!.segments).toEqual([{ drumId: 'kick', hoopStart: 1, hoopEnd: 4 }]);
    expect(broadcasts.filter((m) => m.t === 'state')).toHaveLength(1);
  });

  it('a non-structural message broadcasts no state and persists nothing', () => {
    const { autosaver, broadcasts, send } = wiring();

    send({ t: 'listProjects' });

    expect(broadcasts.filter((m) => m.t === 'state')).toHaveLength(0);
    expect(autosaver.markDirty).not.toHaveBeenCalled();
  });

  /**
   * The reducer's coverage, pinned by enumeration. S8 made `applyStructuralMessage`'s return value
   * the broadcast-and-persist signal, so a MISSING arm is no longer a silent half-apply that the
   * other reducer covered — it is an edit that never reaches the wire or the disk. This asserts the
   * live structural set drives it, and that nothing else does.
   *
   * (The fourteen composition messages that used to fall through here are gone from the protocol
   * entirely as of S11 — rejected at DECODE, proved in packages/protocol's suite. They cannot reach
   * this handler to be inert.)
   */
  it('every live structural discriminant is covered, and only those', () => {
    const { voiceHost, send, broadcasts, autosaver } = wiring();
    const STRUCTURAL: ClientMessage[] = [
      { t: 'setKitTransform', drumId: 'kick', color: '#ff8800' },
      { t: 'setKitGlobal', hoopCount: 4 },
      { t: 'setHoopConfig', drumId: 'kick', hoopIndex: 1, pixelCount: 100 },
      { t: 'setKitOutputs', outputs: [{ id: 'out1', channelsPerPixel: 3, segments: [] }] },
      { t: 'setKitNodeLayout', nodeLayout: { 'output:1': { x: 1, y: 2 } } },
      { t: 'setOutput', fps: 30 },
      { t: 'setInputMap', inputMap: voiceHost.getProject().inputMap },
      { t: 'setTransport', bpm: 100 },
    ];
    for (const msg of STRUCTURAL) {
      broadcasts.length = 0;
      send(msg);
      expect(broadcasts.filter((m) => m.t === 'state'), `${msg.t} must broadcast state`).toHaveLength(1);
    }
    expect(autosaver.markDirty).toHaveBeenCalledTimes(STRUCTURAL.length);

    // …and a read is not structural, however close it looks.
    broadcasts.length = 0;
    send({ t: 'listBackups' });
    expect(broadcasts.filter((m) => m.t === 'state')).toHaveLength(0);
  });
});

/**
 * S12 deleted the state-message PARITY describe. It asserted that moving the `state` message's
 * `project` read from `legacyHost.engine.getProject()` to the store changed no bytes — a claim whose
 * comparator was the legacy engine. With that engine gone the claim has no other side; what replaces
 * it is the `toBe` assertion above, which is stronger: the wire carries the store's object itself.
 */
