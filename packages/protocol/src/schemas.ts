// Runtime zod schemas for the WebSocket wire contract — the SINGLE SOURCE for both the
// TypeScript message types (`ClientMessage`/`ServerMessage` are `z.infer`red below) and the
// runtime validation the two decoders (`ws-protocol.ts`, `lib/ws/protocol-types.ts`) perform.
//
// Where a message carries a shape `@ledrums/core` already schemas (a full Layer/Clip/Song/
// Section/TriggerBinding/InputMap, an OutputConfig[], a ProjectPatch, the whole Project), we
// REUSE the core schema value rather than writing a second definition — the protocol package
// already depends on core, so importing its schema VALUES is the same dependency edge as its
// types. Deliberately-opaque payloads (the versioned show/song library blobs) and the authored
// voice Show pass through structurally validated but never deep-inspected or key-stripped.
import { z } from 'zod';
import {
  BLEND_MODES,
  clipSchema,
  inputMapSchema,
  kitGlobalSchema,
  layerSchema,
  outputSchema,
  outputSettingsSchema,
  outputStateSchema,
  paramValueSchema,
  projectPatchSchema,
  projectSchema,
  rgbOrderSchema,
  sectionSchema,
  songSchema,
  triggerBindingSchema,
  vec3Schema,
} from '@ledrums/core';
import type { EngineStats, voice } from '@ledrums/core';
import type {
  ControllerStatus,
  ControllerTestPattern,
  ControllerUniverseRx,
  DiscoveredController,
  EffectSpec,
  MonitorEvent,
  NetworkAdapter,
  OutputStatus,
  SerializedModel,
  ShowLibraryBlob,
  SongLibraryBlob,
  TunnelInfo,
  VoiceStats,
} from './index';

// ---------------------------------------------------------------------------
// Opaque / authored passthrough payloads
// ---------------------------------------------------------------------------
// The library blobs are stored + rebroadcast by the server WITHOUT interpretation (their real
// schema is web-owned). We validate only the version gate and pass `data` through verbatim —
// a `z.object({ data: z.unknown() })` would infer `data?` (optional) AND strip unknown sibling
// keys, so `z.custom` is used to keep the envelope byte-identical and the type exact.
const versionedBlob = (v: unknown): boolean =>
  typeof v === 'object' && v !== null && typeof (v as { version?: unknown }).version === 'number';
export const showLibraryBlobSchema = z.custom<ShowLibraryBlob>(versionedBlob);
export const songLibraryBlobSchema = z.custom<SongLibraryBlob>(versionedBlob);

// The authored voice Show is interpreted server-side (the engine runs it) but is NOT ours to
// deep-validate at the envelope boundary — core's graph-integrity checks own that, and stripping
// unknown authored node/edge fields would corrupt content. We assert the top-level Show shape and
// the graph container structure, then pass the object through unchanged (via z.custom).
const showBusesShape = z.object({
  buses: z.array(z.object({ id: z.string() }).passthrough()),
  graphs: z.record(
    z.object({ nodes: z.array(z.unknown()), edges: z.array(z.unknown()) }).passthrough(),
  ),
  sections: z.array(z.object({ id: z.string() }).passthrough()),
  effects: z.array(z.object({ id: z.string() }).passthrough()),
  presets: z.array(z.object({ id: z.string() }).passthrough()),
});
export const showSchema = z.custom<voice.Show>((v) => showBusesShape.safeParse(v).success);

// ---------------------------------------------------------------------------
// Reused core enums (single-source with the domain model)
// ---------------------------------------------------------------------------
const blendModeSchema = z.enum(BLEND_MODES);
const outputProtocolSchema = outputSettingsSchema.shape.protocol;
const mirrorSchema = kitGlobalSchema.shape.mirror;

// ---------------------------------------------------------------------------
// Client → Server
// ---------------------------------------------------------------------------

export const clientMessageSchema = z.discriminatedUnion('t', [
  z.object({ t: z.literal('midi'), note: z.number(), velocity: z.number(), on: z.boolean(), channel: z.number().optional() }).strict(),
  z.object({ t: z.literal('cc'), controller: z.number(), value: z.number(), channel: z.number().optional() }).strict(),
  z.object({ t: z.literal('programChange'), value: z.number(), channel: z.number().optional() }).strict(),
  z.object({ t: z.literal('osc'), address: z.string(), value: z.number() }).strict(),
  z.object({ t: z.literal('setParam'), layerId: z.string(), clipId: z.string(), key: z.string(), value: paramValueSchema }).strict(),
  z.object({
    t: z.literal('setLayer'),
    layerId: z.string(),
    blendMode: blendModeSchema.optional(),
    opacity: z.number().optional(),
    activeClipId: z.string().nullable().optional(),
    name: z.string().optional(),
  }).strict(),
  z.object({ t: z.literal('addLayer'), layer: layerSchema }).strict(),
  z.object({ t: z.literal('removeLayer'), layerId: z.string() }).strict(),
  z.object({ t: z.literal('addClip'), layerId: z.string(), clip: clipSchema }).strict(),
  z.object({ t: z.literal('removeClip'), layerId: z.string(), clipId: z.string() }).strict(),
  z.object({ t: z.literal('setTransport'), bpm: z.number().optional(), playing: z.boolean().optional(), beatsPerBar: z.number().optional() }).strict(),
  z.object({
    t: z.literal('setKitTransform'),
    drumId: z.string(),
    origin: vec3Schema.optional(),
    rotation: vec3Schema.optional(),
    localSpinDeg: z.number().optional(),
    startAngleDeg: z.number().optional(),
    pixelsPerHoop: z.number().optional(),
    hoopSpacingMm: z.number().optional(),
    diameterIn: z.number().optional(),
    flip: z.boolean().optional(),
  }).strict(),
  z.object({ t: z.literal('setKitGlobal'), mirror: mirrorSchema.optional() }).strict(),
  z.object({ t: z.literal('setKitOutputs'), outputs: z.array(outputSchema) }).strict(),
  z.object({
    t: z.literal('setOutput'),
    state: outputStateSchema.optional(),
    protocol: outputProtocolSchema.optional(),
    host: z.string().optional(),
    rgbOrder: rgbOrderSchema.optional(),
    fps: z.number().optional(),
    broadcast: z.boolean().optional(),
    priority: z.number().optional(),
    port: z.number().optional(),
    iface: z.string().optional(),
  }).strict(),
  z.object({ t: z.literal('setActiveSection'), songId: z.string(), sectionId: z.string() }).strict(),
  z.object({ t: z.literal('setBinding'), sectionId: z.string(), binding: triggerBindingSchema }).strict(),
  z.object({ t: z.literal('removeBinding'), sectionId: z.string(), drumId: z.string(), slot: z.number() }).strict(),
  z.object({ t: z.literal('addSong'), song: songSchema }).strict(),
  z.object({ t: z.literal('removeSong'), songId: z.string() }).strict(),
  z.object({ t: z.literal('addSection'), songId: z.string(), section: sectionSchema }).strict(),
  z.object({ t: z.literal('removeSection'), songId: z.string(), sectionId: z.string() }).strict(),
  z.object({ t: z.literal('setSectionLayerClip'), sectionId: z.string(), layerId: z.string(), clipId: z.string().nullable() }).strict(),
  z.object({ t: z.literal('setInputMap'), inputMap: inputMapSchema }).strict(),
  z.object({ t: z.literal('setProject'), patch: projectPatchSchema }).strict(),
  z.object({ t: z.literal('setShow'), show: showSchema }).strict(),
  z.object({ t: z.literal('setShowLibrary'), library: showLibraryBlobSchema }).strict(),
  z.object({ t: z.literal('setSongLibrary'), library: songLibraryBlobSchema }).strict(),
  z.object({ t: z.literal('key'), drumId: z.string(), zone: z.string().optional(), velocity: z.number().optional() }).strict(),
  z.object({ t: z.literal('fireGraph'), graphKey: z.string(), velocity: z.number() }).strict(),
  z.object({ t: z.literal('recallSection'), songId: z.string(), sectionId: z.string() }).strict(),
  z.object({ t: z.literal('takeover') }).strict(),
  z.object({ t: z.literal('tunnel'), action: z.enum(['start', 'stop']) }).strict(),
  z.object({ t: z.literal('loadProject'), name: z.string() }).strict(),
  z.object({ t: z.literal('saveProject'), name: z.string() }).strict(),
  z.object({ t: z.literal('listProjects') }).strict(),
  z.object({ t: z.literal('discoverControllers') }).strict(),
  z.object({ t: z.literal('adoptController'), host: z.string() }).strict(),
  z.object({ t: z.literal('setControllerAuth'), password: z.string() }).strict(),
  z.object({ t: z.literal('identifyController'), durationS: z.number() }).strict(),
  z.object({ t: z.literal('controllerTestData'), pattern: controllerTestPatternSchema() }).strict(),
  z.object({ t: z.literal('controllerBackToLive') }).strict(),
  z.object({ t: z.literal('watchController'), watching: z.boolean() }).strict(),
  z.object({ t: z.literal('listNetworkAdapters') }).strict(),
]);

export type ClientMessage = z.infer<typeof clientMessageSchema>;

// ---------------------------------------------------------------------------
// Server → Client payload schemas
// ---------------------------------------------------------------------------
// `controllerTestPatternSchema` is a factory so it can be shared by the client `controllerTestData`
// message (above) and the server `ControllerStatus.testPattern` echo (below) without a hoist issue.
function controllerTestPatternSchema() {
  return z.object({
    op: z.enum(['setColor', 'rgbwCycle', 'colorFade']),
    color: z.tuple([z.number(), z.number(), z.number(), z.number()]).optional(),
    colorRes: z.enum(['8Bit', '16Bit']).optional(),
    pixPortNum: z.number().optional(),
    pixNum: z.number().optional(),
  });
}

const serializedDrumSchema = z.object({
  id: z.string(),
  label: z.string(),
  color: z.string(),
  pixelStart: z.number(),
  pixelCount: z.number(),
});

const serializedModelSchema = z.object({
  count: z.number(),
  positions: z.array(z.number()),
  tangents: z.array(z.number()),
  normals: z.array(z.number()),
  segmentLengths: z.array(z.number()),
  drums: z.array(serializedDrumSchema),
  bounds: z.object({
    center: z.tuple([z.number(), z.number(), z.number()]),
    size: z.number(),
  }),
});

const paramSpecSchema = z.object({
  key: z.string(),
  label: z.string(),
  type: z.enum(['number', 'color', 'enum', 'bool']),
  default: z.union([z.number(), z.string(), z.boolean()]),
  min: z.number().optional(),
  max: z.number().optional(),
  step: z.number().optional(),
  options: z.array(z.string()).optional(),
  unit: z.string().optional(),
});

const effectSpecSchema = z.object({
  id: z.string(),
  name: z.string(),
  category: z.string(),
  paramSpec: z.array(paramSpecSchema),
});

const outputStatusSchema = z.object({
  state: outputStateSchema,
  protocol: outputProtocolSchema,
  host: z.string(),
  packetsSent: z.number(),
  lastError: z.string().nullable(),
  universeCount: z.number(),
});

const engineStatsSchema = z.object({
  timeMs: z.number(),
  beat: z.number(),
  bar: z.number(),
  activeTriggers: z.number(),
  tickCount: z.number(),
  pixelCount: z.number(),
});

const voiceStatSchema = z.object({
  id: z.string(),
  busId: z.string(),
  effectId: z.string(),
  mode: z.enum(['oneshot', 'loop', 'hold']),
  level: z.number(),
  hue: z.number(),
  releasing: z.boolean(),
  via: z.string(),
});

const voiceStatsSchema = z.object({
  voiceCount: z.number(),
  busLevels: z.record(z.number()),
  voices: z.array(voiceStatSchema),
});

const monitorEventSchema = z.object({
  id: z.number(),
  time: z.number(),
  type: z.enum(['input', 'output', 'effect', 'graph', 'system', 'persistence', 'error']),
  direction: z.enum(['in', 'out', 'local']),
  source: z.string(),
  destination: z.string().optional(),
  label: z.string(),
  detail: z.string().optional(),
});

const tunnelInfoSchema = z.object({
  status: z.enum(['off', 'starting', 'live', 'error']),
  url: z.string().nullable(),
  pin: z.string().nullable(),
  error: z.string().optional(),
});

const controllerUniverseRxSchema = z.object({
  uniNum: z.number(),
  protocol: z.enum(['sACN', 'artNet']),
  receiving: z.boolean(),
  inGood: z.number(),
  inBadSeq: z.number(),
  inLowPri: z.number().optional(),
  priority: z.number().optional(),
  sourceName: z.string().optional(),
});

const discoveredControllerSchema = z.object({
  host: z.string(),
  prodName: z.string(),
  nickname: z.string(),
  fwVer: z.string(),
  authReqd: z.boolean(),
  score: z.number(),
});

const networkAdapterSchema = z.object({
  name: z.string(),
  address: z.string(),
  netmask: z.string(),
  cidr: z.string(),
  subnet: z.string(),
  recommendedIp: z.string(),
});

const controllerStatusSchema = z.object({
  host: z.string(),
  reachable: z.boolean(),
  identity: z
    .object({ host: z.string(), prodName: z.string(), nickname: z.string(), fwVer: z.string(), authReqd: z.boolean() })
    .nullable(),
  universes: z.array(controllerUniverseRxSchema),
  rates: z.object({ inFrmRate: z.number().optional(), outFrmRate: z.number().optional() }),
  health: z.object({
    tempC: z.number().optional(),
    bankVoltsMv: z.array(z.number()).optional(),
    portStatus: z.array(z.string()).optional(),
    ethLinkUp: z.array(z.boolean()).optional(),
  }),
  lastSeen: z.number().nullable(),
  testPattern: controllerTestPatternSchema().nullable().optional(),
});

// ---------------------------------------------------------------------------
// Server → Client union
// ---------------------------------------------------------------------------

export const serverMessageSchema = z.discriminatedUnion('t', [
  z.object({
    t: z.literal('state'),
    project: projectSchema,
    model: serializedModelSchema,
    effects: z.array(effectSpecSchema),
    projects: z.array(z.string()),
    output: outputStatusSchema,
    showLibrary: showLibraryBlobSchema.nullable(),
    songLibrary: songLibraryBlobSchema.nullable(),
    tunnel: tunnelInfoSchema.nullable(),
  }).strict(),
  z.object({
    t: z.literal('stats'),
    stats: engineStatsSchema,
    latencyMs: z.number(),
    fps: z.number(),
    output: outputStatusSchema,
    voice: voiceStatsSchema.optional(),
  }).strict(),
  z.object({
    t: z.literal('input'),
    kind: z.enum(['midi', 'osc']),
    label: z.string(),
    value: z.number(),
    note: z.number().optional(),
    channel: z.number().optional(),
  }).strict(),
  z.object({ t: z.literal('monitor'), event: monitorEventSchema }).strict(),
  z.object({ t: z.literal('projects'), names: z.array(z.string()) }).strict(),
  z.object({ t: z.literal('presence'), editorId: z.string().nullable(), youAreEditor: z.boolean(), clientCount: z.number() }).strict(),
  z.object({ t: z.literal('showLibrary'), library: showLibraryBlobSchema }).strict(),
  z.object({ t: z.literal('songLibrary'), library: songLibraryBlobSchema }).strict(),
  z.object({ t: z.literal('controllerDiscovery'), candidates: z.array(discoveredControllerSchema) }).strict(),
  z.object({ t: z.literal('controllerStatus'), status: controllerStatusSchema.nullable() }).strict(),
  z.object({ t: z.literal('networkAdapters'), adapters: z.array(networkAdapterSchema) }).strict(),
  z.object({ t: z.literal('error'), message: z.string() }).strict(),
]);

export type ServerMessage = z.infer<typeof serverMessageSchema>;

// The set of known client message discriminants, DERIVED from the schema (not hand-maintained) —
// the server's `decodeClient` uses it only to preserve its "Unknown client message type" error for
// an unrecognised `t`, keeping the schema the one source the set can never drift from.
export const clientMessageTypes: ReadonlySet<string> = new Set(
  clientMessageSchema.options.map((opt) => opt.shape.t.value),
);

// Runtime-schema ↔ hand-written-interface lock helpers: these unused assignments make the full
// typecheck sweep fail if a server payload schema drifts from the exported wire interface it
// mirrors, so the two can never disagree.
// `Equals` is an exact, bidirectional type-equality check (the classic function-parameter-variance
// trick): unlike a pair of `extends` conditionals, it distinguishes optionality and never collapses
// to `never`, so `Assert<Equals<…>>` errors at compile time the moment a schema drifts from its
// interface in EITHER direction. Each `_Lock*` below fails the package typecheck on any mismatch.
type Equals<X, Y> = (<T>() => T extends X ? 1 : 2) extends (<T>() => T extends Y ? 1 : 2)
  ? true
  : false;
type Assert<T extends true> = T;

/* eslint-disable @typescript-eslint/no-unused-vars */
type _LockSerializedModel = Assert<Equals<z.infer<typeof serializedModelSchema>, SerializedModel>>;
type _LockEffectSpec = Assert<Equals<z.infer<typeof effectSpecSchema>, EffectSpec>>;
type _LockOutputStatus = Assert<Equals<z.infer<typeof outputStatusSchema>, OutputStatus>>;
type _LockEngineStats = Assert<Equals<z.infer<typeof engineStatsSchema>, EngineStats>>;
type _LockMonitorEvent = Assert<Equals<z.infer<typeof monitorEventSchema>, MonitorEvent>>;
type _LockTunnelInfo = Assert<Equals<z.infer<typeof tunnelInfoSchema>, TunnelInfo>>;
type _LockControllerStatus = Assert<Equals<z.infer<typeof controllerStatusSchema>, ControllerStatus>>;
type _LockControllerUniverseRx = Assert<
  Equals<z.infer<typeof controllerUniverseRxSchema>, ControllerUniverseRx>
>;
type _LockDiscoveredController = Assert<
  Equals<z.infer<typeof discoveredControllerSchema>, DiscoveredController>
>;
type _LockNetworkAdapter = Assert<Equals<z.infer<typeof networkAdapterSchema>, NetworkAdapter>>;
type _LockControllerTestPattern = Assert<
  Equals<z.infer<ReturnType<typeof controllerTestPatternSchema>>, ControllerTestPattern>
>;
type _LockVoiceStats = Assert<Equals<z.infer<typeof voiceStatsSchema>, VoiceStats>>;
/* eslint-enable @typescript-eslint/no-unused-vars */
