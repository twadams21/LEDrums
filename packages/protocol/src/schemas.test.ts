import { describe, expect, it } from 'vitest';
import {
  clipSchema,
  inputMapSchema,
  layerSchema,
  outputSchema,
  projectPatchSchema,
  projectSchema,
  sectionSchema,
  songSchema,
  triggerBindingSchema,
} from '@ledrums/core';
import {
  clientMessageSchema,
  clientMessageTypes,
  serverMessageSchema,
  showLibraryBlobSchema,
  showSchema,
} from './schemas';
import type { ClientMessage, OutputStatus, ServerMessage } from './index';

// Canonical (default-complete) core payloads so an encode→decode round-trip is byte-stable: the
// reused core schemas apply defaults, so we seed from them and assert decode is idempotent.
const minimalKit = {
  global: {},
  drums: [{ id: 'kick', diameterIn: 8, hoopSpacingMm: 50, origin: { x: 0, y: 0, z: 0 }, rotation: { x: 0, y: 0, z: 0 } }],
};
const layer = layerSchema.parse({ id: 'l1' });
const clip = clipSchema.parse({ id: 'c1', effectId: 'swirl' });
const song = songSchema.parse({ id: 's1' });
const section = sectionSchema.parse({ id: 'sec1' });
const binding = triggerBindingSchema.parse({ drumId: 'kick', slot: 0, layerId: 'l1', clipId: 'c1' });
const inputMap = inputMapSchema.parse({});
const output = outputSchema.parse({ id: 'o1', dataLines: [{ id: 'dl1', segments: [{ drumId: 'kick', hoopStart: 1, hoopEnd: 2 }] }] }); // 1-based hoops (A1)
const patch = projectPatchSchema.parse({ kit: minimalKit });
const project = projectSchema.parse({ name: 'P', kit: minimalKit });

const showFixture = {
  buses: [{ id: 'main', name: 'Main', polyphony: 'poly', crossfadeMs: 0 }],
  graphs: { 'kick:': { version: 3, nodes: [{ id: 'n1', kind: 'trigger' }], edges: [] } },
  sections: [],
  effects: [],
  presets: [],
} as unknown as import('@ledrums/core').voice.Show;

const clientSamples: ClientMessage[] = [
  { t: 'midi', note: 38, velocity: 100, on: true, channel: 1 },
  { t: 'cc', controller: 0, value: 5 },
  { t: 'programChange', value: 2 },
  { t: 'osc', address: '/vol', value: 0.5 },
  { t: 'setParam', layerId: 'base', clipId: 'swirl', key: 'hue', value: 200 },
  { t: 'setLayer', layerId: 'base', blendMode: 'add', opacity: 0.5, activeClipId: null, name: 'x' },
  { t: 'addLayer', layer },
  { t: 'removeLayer', layerId: 'base' },
  { t: 'addClip', layerId: 'base', clip },
  { t: 'removeClip', layerId: 'base', clipId: 'c1' },
  { t: 'setTransport', bpm: 128, playing: false, beatsPerBar: 4 },
  { t: 'setKitTransform', drumId: 'kick', origin: { x: 1, y: 2, z: 3 }, rotation: { x: 0, y: 0, z: 0 }, localSpinDeg: 90, startAngleDeg: 0, pixelsPerHoop: 32, hoopSpacingMm: 50, diameterIn: 8, flip: true },
  { t: 'setKitGlobal', mirror: 'x' },
  { t: 'setKitOutputs', outputs: [output] },
  { t: 'setOutput', state: 'armed', protocol: 'sacn', host: '10.0.0.5', rgbOrder: 'GRB', fps: 44, broadcast: true, priority: 100, port: 6454, iface: 'en0' },
  { t: 'setActiveSection', songId: 's1', sectionId: 'sec1' },
  { t: 'setBinding', sectionId: 'sec1', binding },
  { t: 'removeBinding', sectionId: 'sec1', drumId: 'kick', slot: 0 },
  { t: 'addSong', song },
  { t: 'removeSong', songId: 's1' },
  { t: 'addSection', songId: 's1', section },
  { t: 'removeSection', songId: 's1', sectionId: 'sec1' },
  { t: 'setSectionLayerClip', sectionId: 'sec1', layerId: 'l1', clipId: null },
  { t: 'setInputMap', inputMap },
  { t: 'setProject', patch },
  { t: 'setShow', show: showFixture },
  { t: 'setShowLibrary', library: { version: 1, data: { any: 'blob' } } },
  { t: 'setSongLibrary', library: { version: 2, data: [1, 2, 3] } },
  { t: 'key', drumId: 'kick', zone: 'center', velocity: 0.8 },
  { t: 'fireGraph', graphKey: 'kick:', velocity: 1 },
  { t: 'recallSection', songId: 's1', sectionId: 'sec1' },
  { t: 'takeover' },
  { t: 'tunnel', action: 'start' },
  { t: 'loadProject', name: 'default' },
  { t: 'saveProject', name: 'show1' },
  { t: 'listProjects' },
  { t: 'discoverControllers' },
  { t: 'adoptController', host: '192.168.1.50' },
  { t: 'setControllerAuth', password: 'pw' },
  { t: 'identifyController', durationS: 5 },
  { t: 'identifyHoop', drumId: 'kick', hoop: 1, durationS: 2 },
  { t: 'controllerTestData', pattern: { op: 'setColor', color: [255, 0, 0, 0], colorRes: '8Bit', pixPortNum: 0, pixNum: 0 } },
  { t: 'controllerBackToLive' },
  { t: 'watchController', watching: true },
  { t: 'listNetworkAdapters' },
];

const outputStatus: OutputStatus = { state: 'disabled', protocol: 'artnet', host: '1.2.3.4', packetsSent: 0, lastError: null, universeCount: 4 };

const serverSamples: ServerMessage[] = [
  {
    t: 'state',
    project,
    model: { count: 2, positions: [0, 0, 0, 1, 1, 1], tangents: [0, 0, 0, 0, 0, 0], normals: [0, 0, 0, 0, 0, 0], segmentLengths: [1, 1], drums: [{ id: 'kick', label: 'Kick', color: '#fff', pixelStart: 0, pixelCount: 2 }], bounds: { center: [0, 0, 0], size: 1 } },
    effects: [{ id: 'swirl', name: 'Swirl', category: 'motion', paramSpec: [{ key: 'hue', label: 'Hue', type: 'number', default: 0, min: 0, max: 360 }] }],
    projects: ['default'],
    output: outputStatus,
    showLibrary: { version: 1, data: { s: 1 } },
    songLibrary: null,
    tunnel: { status: 'off', url: null, pin: null },
  },
  { t: 'stats', stats: { timeMs: 0, beat: 0, bar: 0, activeTriggers: 0, tickCount: 1, pixelCount: 2 }, latencyMs: 5, fps: 60, output: outputStatus, voice: { voiceCount: 1, busLevels: { main: 0.5 }, voices: [{ id: 'v1', busId: 'main', effectId: 'swirl', mode: 'oneshot', level: 0.5, hue: 200, releasing: false, via: 'kick' }] } },
  { t: 'input', kind: 'midi', label: 'note', value: 100, note: 38, channel: 1 },
  { t: 'monitor', event: { id: 1, time: 1, type: 'input', direction: 'in', source: 'ws', label: 'MIDI' } },
  { t: 'projects', names: ['a', 'b'] },
  { t: 'presence', editorId: null, youAreEditor: true, clientCount: 2 },
  { t: 'showLibrary', library: { version: 1, data: {} } },
  { t: 'songLibrary', library: { version: 1, data: {} } },
  { t: 'controllerDiscovery', candidates: [{ host: '1.2.3.4', prodName: 'PixLite', nickname: 'Roof', fwVer: '1.0', authReqd: false, score: 10 }] },
  { t: 'controllerStatus', status: { host: '1.2.3.4', reachable: true, identity: null, universes: [{ uniNum: 1, protocol: 'sACN', receiving: true, inGood: 10, inBadSeq: 0 }], rates: {}, health: {}, lastSeen: null, testPattern: null } },
  { t: 'networkAdapters', adapters: [{ name: 'en0', address: '192.168.1.10', netmask: '255.255.255.0', cidr: '192.168.1.10/24', subnet: '192.168.1.0/24', recommendedIp: '192.168.1.50' }] },
  { t: 'error', message: 'boom' },
];

describe('clientMessageSchema', () => {
  it('exposes every client discriminant, derived from the schema', () => {
    expect(clientMessageTypes.size).toBe(clientSamples.length);
    for (const s of clientSamples) expect(clientMessageTypes.has(s.t)).toBe(true);
  });

  it('round-trips every client message variant through encode→decode', () => {
    const seen = new Set<string>();
    for (const sample of clientSamples) {
      seen.add(sample.t);
      const decoded = clientMessageSchema.parse(JSON.parse(JSON.stringify(sample)));
      expect(decoded).toEqual(sample);
    }
    // Coverage guard: one sample per variant.
    expect(seen.size).toBe(clientSamples.length);
  });

  it('rejects unknown t, missing fields, wrong types, and unknown keys', () => {
    expect(clientMessageSchema.safeParse({ t: 'bogus' }).success).toBe(false);
    expect(clientMessageSchema.safeParse({ t: 'midi', velocity: 1, on: true }).success).toBe(false); // missing note
    expect(clientMessageSchema.safeParse({ t: 'midi', note: 'x', velocity: 1, on: true }).success).toBe(false); // wrong type
    expect(clientMessageSchema.safeParse({ t: 'takeover', extra: 1 }).success).toBe(false); // strict envelope
    expect(clientMessageSchema.safeParse({ t: 'adoptController' }).success).toBe(false); // missing host
    expect(clientMessageSchema.safeParse('not an object').success).toBe(false);
  });
});

describe('serverMessageSchema', () => {
  it('round-trips every server message variant through encode→decode', () => {
    const seen = new Set<string>();
    for (const sample of serverSamples) {
      seen.add(sample.t);
      const decoded = serverMessageSchema.parse(JSON.parse(JSON.stringify(sample)));
      expect(decoded).toEqual(sample);
    }
    expect(seen.size).toBe(serverSamples.length);
  });

  it('rejects unknown t, missing fields, and wrong types', () => {
    expect(serverMessageSchema.safeParse({ t: 'bogus' }).success).toBe(false);
    expect(serverMessageSchema.safeParse({ t: 'error' }).success).toBe(false); // missing message
    expect(serverMessageSchema.safeParse({ t: 'presence', editorId: null, youAreEditor: 'yes', clientCount: 1 }).success).toBe(false);
    expect(serverMessageSchema.safeParse({ t: 'state', project: { name: 'no-kit' }, model: {}, effects: [], projects: [], output: outputStatus, showLibrary: null, songLibrary: null, tunnel: null }).success).toBe(false); // invalid project
  });
});

describe('opaque + authored passthrough', () => {
  it('preserves library blob data verbatim (no deep validation, no key stripping)', () => {
    const deep = { version: 7, data: { nested: { a: [1, 2, { b: true }] }, extra: 'kept' } };
    const decoded = showLibraryBlobSchema.parse(deep);
    expect(decoded).toEqual(deep);
  });

  it('rejects a blob missing its version gate', () => {
    expect(showLibraryBlobSchema.safeParse({ data: {} }).success).toBe(false);
    expect(showLibraryBlobSchema.safeParse({ version: 'x', data: {} }).success).toBe(false);
  });

  it('validates the Show envelope but preserves unknown authored node fields', () => {
    const withCustomNodeField = {
      buses: [],
      graphs: { 'kick:': { nodes: [{ id: 'n1', kind: 'effect', futureField: 42 }], edges: [] } },
      sections: [],
      effects: [],
      presets: [],
    };
    const decoded = showSchema.parse(withCustomNodeField) as unknown as {
      graphs: Record<string, { nodes: Array<Record<string, unknown>> }>;
    };
    expect(decoded.graphs['kick:']!.nodes[0]).toHaveProperty('futureField', 42);
  });

  it('rejects a Show missing its required containers', () => {
    expect(showSchema.safeParse({ buses: [] }).success).toBe(false);
  });
});
