import { describe, expect, it } from 'vitest';
import {
  buildPixelModel,
  effectChain,
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
import { serializePixelModel, type ClientMessage, type OutputStatus, type ServerMessage } from './index';

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
const output = outputSchema.parse({ id: 'o1', segments: [{ drumId: 'kick', hoopStart: 1, hoopEnd: 2 }] }); // D1: segments on the output; 1-based hoops (A1)
const patch = projectPatchSchema.parse({ kit: minimalKit });
const project = projectSchema.parse({ name: 'P', kit: minimalKit });

const showFixture: import('@ledrums/core').voice.Show = {
  songs: [{ id: 'song-1', name: 'Song', sections: [{ id: 'sec-1', name: 'Verse', effects: [] }] }],
};

const clientSamples: ClientMessage[] = [
  { t: 'midi', note: 38, velocity: 100, on: true, channel: 1 },
  { t: 'cc', controller: 0, value: 5 },
  { t: 'programChange', value: 2 },
  { t: 'midiClock', command: 'position', position: 16383 },
  { t: 'osc', address: '/vol', value: 0.5 },
  { t: 'audioFeatures', level: 0.5, bass: 0.25, mids: 0, highs: 1 },
  { t: 'setParam', layerId: 'base', clipId: 'swirl', key: 'hue', value: 200 },
  { t: 'setLayer', layerId: 'base', blendMode: 'add', opacity: 0.5, activeClipId: null, name: 'x' },
  { t: 'addLayer', layer },
  { t: 'removeLayer', layerId: 'base' },
  { t: 'addClip', layerId: 'base', clip },
  { t: 'removeClip', layerId: 'base', clipId: 'c1' },
  { t: 'setTransport', bpm: 128, playing: false, beatsPerBar: 4, source: 'midiClock', clockInput: 'browser' },
  { t: 'releaseBus', busId: 'base' },
  { t: 'setKitTransform', drumId: 'kick', origin: { x: 1, y: 2, z: 3 }, rotation: { x: 0, y: 0, z: 0 }, localSpinDeg: 90, startAngleDeg: 0, pixelsPerHoop: 32, hoopSpacingMm: 50, diameterIn: 8, flip: true, color: '#ff8800' },
  { t: 'setKitGlobal', mirror: 'x', expanded: true, ledDensityPxPerM: 72, hoopCount: 5, defaultHoopSpacingMm: 45, maxPixelsPerOutput: 300 },
  { t: 'setHoopConfig', drumId: 'kick', hoopIndex: 1, pixelCount: 196, reverse: true },
  { t: 'setKitOutputs', outputs: [output] },
  { t: 'setKitNodeLayout', nodeLayout: { 'output:1': { x: 40, y: 120 }, 'hoop:kick:1': { x: 360, y: 120 } } },
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
  { t: 'fireEffect', effectId: 'fx-1' },
  { t: 'recallSection', songId: 's1', sectionId: 'sec1' },
  { t: 'takeover' },
  { t: 'tunnel', action: 'start' },
  { t: 'loadProject', name: 'default' },
  { t: 'saveProject', name: 'show1' },
  { t: 'listProjects' },
  { t: 'listBackups' },
  { t: 'restoreBackup', id: '1000000000000-boot' },
  { t: 'discoverControllers' },
  { t: 'adoptController', host: '192.168.1.50' },
  { t: 'setControllerAuth', password: 'pw' },
  { t: 'identifyController', durationS: 5 },
  { t: 'identifyHoop', drumId: 'kick', hoop: 1, durationS: 2 },
  { t: 'controllerTestData', pattern: { op: 'setColor', color: [255, 0, 0, 0], colorRes: '8Bit', pixPortNum: 0, pixNum: 0 } },
  { t: 'controllerBackToLive' },
  { t: 'watchController', watching: true },
  { t: 'listNetworkAdapters' },
  { t: 'webError', origin: 'window.onerror', message: 'boom', stack: 'Error: boom' },
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
    osc: { status: 'listening', port: 9000, hosts: ['192.168.1.20'] },
    showRevision: 1,
    activeSongId: 'song-1',
    activeSectionId: 'section-2',
    recallSequence: 4,
    sessionId: 'server-session-1',
  },
  { t: 'stats', stats: { timeMs: 0, beat: 0, bar: 0, activeTriggers: 0, tickCount: 1, pixelCount: 2 }, latencyMs: 5, fps: 60, output: outputStatus, voice: { voiceCount: 1, busLevels: { main: 0.5 }, voices: [{ id: 'v1', busId: 'main', effectId: 'swirl', mode: 'oneshot', level: 0.5, hue: 200, releasing: false, via: 'kick', pad: 'effect:swirl' }] } },
  { t: 'input', kind: 'midi', label: 'note', value: 100, note: 38, channel: 1 },
  { t: 'recalled', songId: 'song-1', sectionId: 'section-2', showRevision: 1, recallSequence: 4, sessionId: 'server-session-1' },
  { t: 'monitor', event: { id: 1, time: 1, type: 'input', direction: 'in', source: 'ws', label: 'MIDI' } },
  { t: 'projects', names: ['a', 'b'] },
  { t: 'backups', items: [{ id: '1000000000000-boot', createdAt: 1000000000000, reason: 'boot' }, { id: '1000000000001-pre-risk', createdAt: 1000000000001, reason: 'pre-risk' }] },
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

  it('rejects a MIDI clock message with a bad command, out-of-range position, or a channel', () => {
    for (const command of ['tick', 'start', 'continue', 'stop'] as const) {
      expect(clientMessageSchema.safeParse({ t: 'midiClock', command }).success).toBe(true);
    }
    expect(clientMessageSchema.safeParse({ t: 'midiClock', command: 'reset' }).success).toBe(false);
    expect(clientMessageSchema.safeParse({ t: 'midiClock', command: 'position', position: 16384 }).success).toBe(false);
    expect(clientMessageSchema.safeParse({ t: 'midiClock', command: 'position', position: -1 }).success).toBe(false);
    expect(clientMessageSchema.safeParse({ t: 'midiClock', command: 'position', position: 1.5 }).success).toBe(false);
    expect(clientMessageSchema.safeParse({ t: 'midiClock', command: 'tick', channel: 1 }).success).toBe(false); // system messages carry no channel
    expect(clientMessageSchema.safeParse({ t: 'midiClock', command: 'tick', atMs: 12 }).success).toBe(false); // receipt time is the host's, never the client's
    expect(clientMessageSchema.safeParse({ t: 'setTransport', source: 'link' }).success).toBe(false);
  });

  it('rejects unknown t, missing fields, wrong types, and unknown keys', () => {
    expect(clientMessageSchema.safeParse({ t: 'releaseBus' }).success).toBe(true); // busId optional = all buses
    expect(clientMessageSchema.safeParse({ t: 'bogus' }).success).toBe(false);
    // audioFeatures (GH #214): four finite 0..1 bands, nothing else.
    expect(clientMessageSchema.safeParse({ t: 'audioFeatures', level: 0.5, bass: 1, mids: 0, highs: 0.25 }).success).toBe(true);
    expect(clientMessageSchema.safeParse({ t: 'audioFeatures', level: 0.5, bass: 1, mids: 0 }).success).toBe(false); // missing band
    expect(clientMessageSchema.safeParse({ t: 'audioFeatures', level: 1.5, bass: 0, mids: 0, highs: 0 }).success).toBe(false); // out of range
    expect(clientMessageSchema.safeParse({ t: 'audioFeatures', level: -0.1, bass: 0, mids: 0, highs: 0 }).success).toBe(false); // negative
    expect(clientMessageSchema.safeParse({ t: 'audioFeatures', level: Number.NaN, bass: 0, mids: 0, highs: 0 }).success).toBe(false); // non-finite
    expect(clientMessageSchema.safeParse({ t: 'audioFeatures', level: 0, bass: Number.POSITIVE_INFINITY, mids: 0, highs: 0 }).success).toBe(false);
    expect(clientMessageSchema.safeParse({ t: 'audioFeatures', level: 0, bass: 0, mids: 0, highs: 0, timeMs: 12 }).success).toBe(false); // no client clock
    expect(clientMessageSchema.safeParse({ t: 'audioFeatures', level: '0.5', bass: 0, mids: 0, highs: 0 }).success).toBe(false); // wrong type
    expect(clientMessageSchema.safeParse({ t: 'midi', velocity: 1, on: true }).success).toBe(false); // missing note
    expect(clientMessageSchema.safeParse({ t: 'midi', note: 'x', velocity: 1, on: true }).success).toBe(false); // wrong type
    expect(clientMessageSchema.safeParse({ t: 'takeover', extra: 1 }).success).toBe(false); // strict envelope
    expect(clientMessageSchema.safeParse({ t: 'adoptController' }).success).toBe(false); // missing host
    expect(clientMessageSchema.safeParse({ t: 'setHoopConfig', drumId: 'kick', hoopIndex: 0 }).success).toBe(false); // hoopIndex must be 1-based positive
    expect(clientMessageSchema.safeParse({ t: 'setHoopConfig', hoopIndex: 1 }).success).toBe(false); // missing drumId
    expect(clientMessageSchema.safeParse({ t: 'setKitGlobal', hoopCount: 4.5 }).success).toBe(false); // hoopCount must be an integer
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

  it('accepts mixed Stage counts beside single-hoop and legacy drums without metadata', () => {
    const state = serverSamples.find((sample) => sample.t === 'state')!;
    const stagedProject = projectSchema.parse({ name: 'Stage', kit: {
      global: { mirror: 'y' },
      drums: [
        { ...minimalKit.drums[0], hoops: [{ pixelCount: 3 }, { pixelCount: 7, reverse: true }, { pixelCount: 2 }], flip: true },
        { ...minimalKit.drums[0], id: 'single', hoops: [{ pixelCount: 5 }] },
      ],
    } });
    const model = serializePixelModel(buildPixelModel(stagedProject.kit));
    expect(model.drums[0]!.stage?.hoopPixelCounts).toEqual([3, 7, 2]);
    expect(model.drums[1]).not.toHaveProperty('stage');
    const wire = JSON.parse(JSON.stringify({ ...state, project: stagedProject, model }));
    expect(serverMessageSchema.parse(wire)).toStrictEqual(wire);
    expect(serverMessageSchema.parse(state)).toStrictEqual(state); // old multi-hoop payloads need no stage
  });

  it('validates optional Stage tuples, finite positive dimensions, unit axes and hoop counts', () => {
    const state = serverSamples.find((sample) => sample.t === 'state')!;
    const model = serializePixelModel(buildPixelModel(project.kit));
    const drum = model.drums[0]!;
    expect(drum.stage).toBeDefined();
    const acceptsStage = (stage: unknown) => serverMessageSchema.safeParse({
      ...state, model: { ...model, drums: [{ ...drum, stage }] },
    }).success;
    expect(acceptsStage(drum.stage)).toBe(true);
    expect(acceptsStage(undefined)).toBe(true);
    for (const invalid of [
      null,
      {},
      { ...drum.stage, origin: [0, 0] },
      { ...drum.stage, origin: [0, Infinity, 0] },
      { ...drum.stage, xAxis: [2, 0, 0] },
      { ...drum.stage, yAxis: [0, 0, 0] },
      { ...drum.stage, zAxis: [0, 0, NaN] },
      { ...drum.stage, zAxis: [0, 0, 1, 0] },
      { ...drum.stage, radiusMm: 0 },
      { ...drum.stage, radiusMm: Infinity },
      { ...drum.stage, hoopSpacingMm: -1 },
      { ...drum.stage, hoopSpacingMm: Infinity },
      { ...drum.stage, hoopPixelCounts: [3] },
      { ...drum.stage, hoopPixelCounts: [3, 0] },
      { ...drum.stage, hoopPixelCounts: [3, 1.5] },
      { ...drum.stage, hoopPixelCounts: [3, '5'] },
    ]) expect(acceptsStage(invalid)).toBe(false);
  });

  it('rejects unknown t, missing fields, and wrong types', () => {
    expect(serverMessageSchema.safeParse({ t: 'bogus' }).success).toBe(false);
    expect(serverMessageSchema.safeParse({ t: 'error' }).success).toBe(false); // missing message
    expect(serverMessageSchema.safeParse({ t: 'presence', editorId: null, youAreEditor: 'yes', clientCount: 1 }).success).toBe(false);
    expect(serverMessageSchema.safeParse({ t: 'state', project: { name: 'no-kit' }, model: {}, effects: [], projects: [], output: outputStatus, showLibrary: null, songLibrary: null, tunnel: null }).success).toBe(false); // invalid project
  });

  it('accepts an explicit null recall target for zero-section songs and legacy sections', () => {
    expect(clientMessageSchema.safeParse({ t: 'recallSection', songId: 'empty-song', sectionId: null }).success).toBe(true);
    expect(clientMessageSchema.safeParse({ t: 'recallSection', songId: null, sectionId: 'legacy-section' }).success).toBe(true);
    expect(clientMessageSchema.safeParse({ t: 'recallSection', sectionId: 'legacy-section' }).success).toBe(false);
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

  it('validates the Show envelope but preserves unknown authored fields', () => {
    const withCustomField = { songs: [], futureField: 42, canvasScenes: [{ id: 'sc', name: 'Scene', futureField: 1 }] };
    const decoded = showSchema.parse(withCustomField) as unknown as Record<string, unknown>;
    expect(decoded).toHaveProperty('futureField', 42);
    expect(decoded).toEqual(withCustomField);
  });

  it('rejects a Show missing its songs, or a retired graph-model Show', () => {
    expect(showSchema.safeParse({}).success).toBe(false);
    expect(showSchema.safeParse({ buses: [], graphs: {}, sections: [], effects: [], presets: [] }).success).toBe(false);
  });

});

describe('fireEffect client message', () => {
  it('carries exactly a non-empty Effect id', () => {
    expect(clientMessageSchema.safeParse({ t: 'fireEffect', effectId: 'fx-1' }).success).toBe(true);
    expect(clientMessageSchema.safeParse({ t: 'fireEffect' }).success).toBe(false); // missing id
    expect(clientMessageSchema.safeParse({ t: 'fireEffect', effectId: '' }).success).toBe(false);
    expect(clientMessageSchema.safeParse({ t: 'fireEffect', effectId: 7 }).success).toBe(false);
    expect(clientMessageSchema.safeParse({ t: 'fireEffect', effectId: 'fx-1', sectionId: 's' }).success).toBe(false); // strict: the engine picks the ACTIVE section
  });
});

describe('Show effect-chain sections (songs → sections → effects / master)', () => {
  // Canonical (fully defaulted) Effects and master devices — what the core show builder emits.
  const zoneEffect = effectChain.parseEffect({
    id: 'fx-1',
    cell: { row: 'kick', column: { kind: 'zone', slot: 0 } },
    generator: { kind: 'solid', params: { color: '#ff0000' } },
  });
  const clockEffect = effectChain.parseEffect({
    id: 'fx-2',
    cell: { row: 'kit', column: { kind: 'clock' } },
    generator: { kind: 'wave' },
    modifiers: [{ uid: 'm1', modifierId: 'strobe' }],
  });
  const masterDevice = effectChain.modifierDeviceSchema.parse({ uid: 'mst-1', modifierId: 'strobe' });
  const showWith = (section: Record<string, unknown>) => ({
    songs: [{ id: 'song-1', name: 'Song', sections: [{ id: 'sec-1', name: 'Verse', effects: [], ...section }] }],
  });
  const accepts = (show: unknown) => showSchema.safeParse(show).success;
  const wire = (v: unknown) => JSON.parse(JSON.stringify(v));

  it('accepts canonical effects + master and passes the Show through unchanged', () => {
    const show = wire(showWith({ effects: [zoneEffect, clockEffect], master: [masterDevice] }));
    expect(showSchema.parse(show)).toStrictEqual(show);
    // Also on the setShow envelope.
    const msg = { t: 'setShow', show };
    expect(clientMessageSchema.parse(msg)).toStrictEqual(msg);
  });

  it('accepts an empty effect stack and an empty setlist, and requires the effects field', () => {
    expect(accepts(showWith({ effects: [], master: [] }))).toBe(true);
    expect(accepts({ songs: [] })).toBe(true);
    expect(accepts({ songs: [{ id: 'song-1', name: 'Song', sections: [{ id: 'sec-1', name: 'Verse' }] }] })).toBe(false);
  });

  it('preserves unknown authored fields on an Effect (no key stripping)', () => {
    const show = wire(showWith({ effects: [{ ...zoneEffect, futureField: 42 }] }));
    const decoded = showSchema.parse(show) as unknown as { songs: Array<{ sections: Array<{ effects: Array<Record<string, unknown>> }> }> };
    expect(decoded.songs[0]!.sections[0]!.effects[0]).toHaveProperty('futureField', 42);
  });

  it('rejects an Effect that fails the core Effect schema', () => {
    const { generator: _generator, ...noGenerator } = zoneEffect;
    expect(accepts(showWith({ effects: [noGenerator] }))).toBe(false);
    // Trigger kind must match the cell column.
    expect(accepts(showWith({ effects: [{ ...zoneEffect, trigger: { kind: 'always' } }] }))).toBe(false);
    // The Kit row has no zone columns.
    expect(accepts(showWith({ effects: [{ ...zoneEffect, cell: { row: 'kit', column: { kind: 'zone', slot: 0 } } }] }))).toBe(false);
    expect(accepts(showWith({ effects: [{ ...zoneEffect, opacity: 2 }] }))).toBe(false);
    expect(accepts(showWith({ effects: 'not-an-array' }))).toBe(false);
  });

  it('rejects a non-canonical Effect the schema would have defaulted (the gate never fills fields)', () => {
    const { trigger: _trigger, ...noTrigger } = zoneEffect;
    const { modifiers: _modifiers, ...noModifiers } = zoneEffect;
    const { amp: _amp, ...noAmp } = zoneEffect;
    expect(accepts(showWith({ effects: [noTrigger] }))).toBe(false);
    expect(accepts(showWith({ effects: [noModifiers] }))).toBe(false);
    expect(accepts(showWith({ effects: [noAmp] }))).toBe(false);
    expect(accepts(showWith({ effects: [{ ...zoneEffect, amp: { attackMs: 5 } }] }))).toBe(false); // nested defaults missing
  });

  it('rejects duplicate Effect ids within one section, but not across sections', () => {
    expect(accepts(showWith({ effects: [zoneEffect, { ...clockEffect, id: zoneEffect.id }] }))).toBe(false);
    const twoSections = {
      songs: [{ id: 'song-1', name: 'Song', sections: [
        { id: 'a', name: 'A', effects: [zoneEffect] },
        { id: 'b', name: 'B', effects: [zoneEffect] },
      ] }],
    };
    expect(accepts(twoSections)).toBe(true);
  });

  it('rejects an invalid or non-canonical master device', () => {
    expect(accepts(showWith({ master: [{ ...masterDevice, mix: 1.5 }] }))).toBe(false);
    expect(accepts(showWith({ master: [{ uid: 'mst-1', modifierId: 'strobe' }] }))).toBe(false); // params / mix / bypass not defaulted
    expect(accepts(showWith({ master: [{ ...masterDevice, uid: '' }] }))).toBe(false);
  });

  it('rejects songs / sections missing their ids or section list', () => {
    expect(accepts({ songs: [{ id: 'song-1', name: 'Song' }] })).toBe(false);
    expect(accepts({ songs: [{ id: 'song-1', sections: [{ name: 'no id', effects: [] }] }] })).toBe(false);
    expect(accepts({ songs: 'nope' })).toBe(false);
  });
});
