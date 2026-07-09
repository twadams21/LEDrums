/* Reactive bridge over the throwaway Sim. Owns editable config + the effect/preset
   registries as runes, drives the sim from a rAF loop, and snapshots transient
   voice/log state each frame. Throwaway — see ./NOTES.md.

   THIN WRAPPER (S3.2): the domain logic lives in pure reducer slices under `store/`
   (ids · seed · hydrate · graphs · graph-wiring · value-switch · objects ·
   trigger-routing · shows · show-library-sync · transport) + the existing pure modules
   (persistence · save-status · setlist · show-builder). This class holds the runes +
   sim/client lifecycle and delegates each domain to its slice — mirroring
   setlist.ts / shell-nav.ts. The public TriggerLab API is unchanged. */

import {
  Sim,
  defaultParams,
  defaultEnvelope,
  defaultAdsr,
  adsrToPoints,
  type AdsrShape,
  type Bus,
  type EffectDef,
  type GraphEdge,
  type Envelope,
  type EnvKind,
  type EnvPoint,
  type LogEntry,
  type ParamValue,
  type PlayMode,
  type Polyphony,
  type Preset,
  type Scope,
  type Section,
  type SwitchOn,
  type ValueMode,
  type Voice,
  type GraphNode,
  type NodeKind,
  type TriggerGraph,
  type TriggerSource,
  makeNode,
  resolveGraphsForFire,
  sourceMatchesPad,
  triggerSourceOf,
} from './sim';
import { BUSES, DRUMS, EFFECTS, PADS, PRESETS, SECTIONS, type Pad } from './fixtures';
import { buildLabModel } from './kit';
import * as clipdoc from './clipdoc';
import { renderFrame as compositeFrame } from './render';
import { WSClient, type ConnectionState } from '../ws/client';
import { type MidiDeviceInfo, type MidiEvent } from '../midi/webmidi';
import type { ClientMessage, ControllerStatus, ControllerTestPattern, DiscoveredController, MonitorEvent, OutputStatus, SerializedModel, TunnelInfo, VoiceStat } from '../ws/protocol-types';
import { selectDockVoices, type DockVoice } from './dock-voices';
import { smoothBusLevels, smoothDockVoices, smoothingAlpha } from './dock-smoothing';
import { packetsPerSecond, type PacketSample } from '../app/docks/inspectors/output-status';
import type { BlendMode, InputMap, OutputConfig, Project, CanvasScene, PlayType } from '@ledrums/core';
import { BUILTIN_CANVAS_SCENES } from '@ledrums/core';
import { voice, listModifiers, canvasEffectId } from '@ledrums/core';
import * as canvasScenesLib from './store/canvas-scenes';
import { buildShow, type ShowSource } from './show-builder';
import * as setlist from '../app/setlist';
import type { SetlistSection, Song } from '../app/setlist';
import {
  serializeShowLibrary,
  serializeSongLibrary,
  type AuthoredState,
  type Show,
  type ShowLibrary,
  type SongLibrary,
} from './persistence';
import { SaveStatusController, type SaveStatus } from './save-status';
import { ControllerMonitor } from './controller-monitor.svelte';
import { ControllerTest } from './controller-test.svelte';
import { MidiController, type MidiLearnTarget } from './midi-controller.svelte';
import {
  ShowsController,
  writeStoredLibrary,
  writeStoredSongLibrary,
  type ShowsControllerHost,
} from './shows-controller.svelte';
import { SvelteMap } from 'svelte/reactivity';
import {
  acceptsChannel,
  activityKey,
  deriveInputBadge,
  type InputActivity,
  type InputBadgeView,
  type InputBinding,
} from './input-activity';

// --- pure domain slices (S3.2) --------------------------------------------------
import { nid, freshId, reserveIds } from './store/ids';
import { findFreePosition } from '../app/views/node-placement';
import { padKey, seedGraphs, seedAuthored } from './store/seed';
import { normalizeGraphs as hydrateGraphs, unionEffects, unionPresets } from './store/hydrate';
import { announceSystemActions } from './store/system-toasts';
import { idsFromLibrarySong } from './store/reserve-library-ids';
import * as graphsLib from './store/graphs';
import {
  canSplice,
  classifyConnection,
  classifyReconnect,
  normalizeFromPort,
  normalizeToPort,
  type ToPort,
  type WireRejection,
} from './store/graph-wiring';
import * as vsw from './store/value-switch';
import * as objects from './store/objects';
import * as routing from './store/trigger-routing';
import * as songRefsLib from './store/song-library-refs';
import { extractSongClosure, type ClosureSources } from './store/song-library';
import {
  buildGraphClipDoc,
  buildSectionClipDoc,
  buildSongClipDoc,
  serialize,
  parse,
  isClipParseError,
  remapClipDoc,
  type ClipDoc,
  type ClipDocMeta,
  type ClipParseReason,
  type RemapContext,
  type RemapMint,
  type RemapResult,
} from './clipdoc';
import { readClipboardText, writeClipboardText } from './clipboard-io';
import { pushToast } from '../ui/toast.svelte';
import { EngineLinkSync } from './store/transport';
import {
  DEFAULT_MONITOR_FILTERS,
  appendMonitorEvent,
  filterMonitorEvents,
  type MonitorFilterType,
} from '../app/monitor';

/** How long after the last authored change we wait before writing to storage. */
const SAVE_DEBOUNCE_MS = 300;

export type EnvelopeCreationPreset = 'pluck' | 'stab' | 'swell' | 'gate' | 'custom';
export type LfoCreationPreset = voice.LfoWaveform;
export type AddNodeOptions = {
  envelopePreset?: string;
  lfoWaveform?: string;
};

/** Re-exported from the extracted MIDI controller (R21) so `MidiLearnTarget` stays importable from
    the store — the inspectors that arm a learn keep their import path unchanged. */
export type { MidiLearnTarget };

/** Nodes that carry authored `params` + per-param `env`: play nodes and modifier nodes.
    The param/envelope mutators + inspector share one editing surface across both. */
function nodeHasParams(node: GraphNode): boolean {
  return node.kind === 'play' || node.kind === 'effect' || node.kind === 'modifier';
}

function isAnchorNode(node: GraphNode): boolean {
  return node.kind === 'trigger' || node.kind === 'output';
}

function isEffectNode(node: GraphNode): boolean {
  return node.kind === 'play' || node.kind === 'effect';
}

function envelopePresetAdsr(preset: string | undefined): AdsrShape {
  const base = defaultAdsr();
  switch (preset) {
    case 'pluck':
      return { ...base, attack: 0.03, decay: 0.16, sustain: 0, release: 0.18 };
    case 'stab':
      return { ...base, attack: 0.02, decay: 0.08, sustain: 0.78, release: 0.22 };
    case 'swell':
      return { ...base, attack: 0.62, decay: 0.08, sustain: 0.92, release: 0.3 };
    case 'gate':
      return { ...base, attack: 0.01, decay: 0.02, sustain: 1, release: 0.04 };
    case 'custom':
    default:
      return base;
  }
}

function lfoPresetWaveform(waveform: string | undefined): voice.LfoWaveform {
  return voice.LFO_WAVEFORMS.includes(waveform as voice.LfoWaveform) ? (waveform as voice.LfoWaveform) : 'sine';
}

function envelopeNodeDefaults(preset: string | undefined = 'pluck'): Pick<GraphNode, 'env'> {
  const adsr = envelopePresetAdsr(preset);
  return {
    env: {
      [voice.ENVELOPE_NODE_KEY]: {
        kind: 'custom',
        amount: 1,
        points: adsrToPoints(adsr),
        adsr,
      },
    },
  };
}

function pruneEdgesForModSource(graph: TriggerGraph, nodeId: string): void {
  graph.edges = graph.edges.filter((edge) => {
    // Modulate/source nodes take no incoming wires.
    if (edge.to === nodeId) return false;

    // They may only output to parameter-input rows.
    if (edge.from === nodeId) return voice.paramKeyOf(edge.toPort) !== null;

    return true;
  });
}

/** sessionStorage key for the room PIN (S3) — per-tab so it does not leak across browser
    sessions, but survives a reconnect/refresh within a session. */
const PIN_STORAGE_KEY = 'ledrums:pin';

/** The room PIN remembered for this tab, or null. Guards SSR / private-mode. */
function readStoredPin(): string | null {
  if (typeof sessionStorage === 'undefined') return null;
  try {
    return sessionStorage.getItem(PIN_STORAGE_KEY);
  } catch {
    return null;
  }
}

/** Remember the room PIN for this tab so a reconnect/refresh need not re-prompt. Best-effort. */
function writeStoredPin(pin: string): void {
  if (typeof sessionStorage === 'undefined') return;
  try {
    sessionStorage.setItem(PIN_STORAGE_KEY, pin);
  } catch {
    /* ignore */
  }
}

/** sessionStorage key for the host-session token (S4 desktop) — same per-tab lifetime as the PIN. */
const HOST_TOKEN_STORAGE_KEY = 'ledrums:hostToken';

/**
 * The host-session token (S4 desktop), or null. The packaged app opens its window at
 * `http://127.0.0.1:<port>#hostToken=<token>`; we read it from the URL hash, persist it to
 * sessionStorage (so a reconnect/refresh that drops the hash still has it), then strip the hash from
 * the address bar so the token does not linger in history. Plain browsers have no hash → null.
 */
function readHostToken(): string | null {
  if (typeof location !== 'undefined' && location.hash) {
    const m = /[#&]hostToken=([^&]+)/.exec(location.hash);
    if (m?.[1]) {
      const token = decodeURIComponent(m[1]);
      writeStoredHostToken(token);
      try {
        history.replaceState(null, '', location.pathname + location.search);
      } catch {
        /* ignore */
      }
      return token;
    }
  }
  if (typeof sessionStorage === 'undefined') return null;
  try {
    return sessionStorage.getItem(HOST_TOKEN_STORAGE_KEY);
  } catch {
    return null;
  }
}

/** Persist the host token for this tab so a reconnect/refresh need not re-read the hash. Best-effort. */
function writeStoredHostToken(token: string): void {
  if (typeof sessionStorage === 'undefined') return;
  try {
    sessionStorage.setItem(HOST_TOKEN_STORAGE_KEY, token);
  } catch {
    /* ignore */
  }
}

/** The authored clipboard kinds a paste can target, one per UI context (S44). */
export type PasteContext = 'graph' | 'section' | 'song';
/** Where a pasted song lands: the active show's setlist, or the shared Song Library pool. */
export type SongPasteDest = 'show' | 'library';

/** The typed outcome of {@link TriggerLab.materializePaste} — the caller toasts `message`. */
export type PasteResult =
  | { ok: true; kind: PasteContext; message: string }
  | { ok: false; message: string };

/** Turn a defensive-parse reason into a friendly, user-facing paste message. */
function friendlyParseMessage(reason: ClipParseReason): string {
  switch (reason) {
    case 'foreign':
      return 'That clipboard content isn’t from LEDrums.';
    case 'unsupported-version':
      return 'That was copied from a newer version of LEDrums.';
    case 'unknown-kind':
      return 'That clipboard content can’t be pasted here.';
    default:
      return 'The clipboard didn’t contain anything pasteable.';
  }
}

/** Every generated id a materialized paste introduces that must be reserved against the global id
    counter BEFORE it enters the show. The critical ones are the graphs' NODE + EDGE ids: remap
    carries them verbatim (so wiring/modulation ports survive), so a cross-machine paste can bring a
    high `n-<n>` the local counter is below — a later `nid('n')` would then re-mint it, duplicating a
    node id in one graph. The remapped graph/section/song/preset ids come off the counter already,
    but yielding them too is harmless and future-proof. */
function* remapResultIds(res: RemapResult): Iterable<string> {
  for (const [key, graph] of Object.entries(res.graphs)) {
    yield key;
    for (const node of graph.nodes) yield node.id;
    for (const edge of graph.edges) yield edge.id;
  }
  if (res.graphKey) yield res.graphKey;
  for (const effect of res.effects) yield effect.id;
  for (const preset of res.presets) yield preset.id;
  for (const scene of res.canvasScenes) yield scene.id;
  if (res.section) yield res.section.id;
  if (res.song) {
    yield res.song.id;
    for (const section of res.song.sections) yield section.id;
  }
}

/** The success message for a materialized authored paste. */
function pasteSuccessMessage(res: RemapResult): string {
  switch (res.kind) {
    case 'graph':
      return 'Pasted graph.';
    case 'section':
      return 'Pasted section.';
    case 'song':
      return 'Pasted song.';
  }
}

export class TriggerLab {
  // editable config (shared by reference with the sim)
  buses = $state<Bus[]>(BUSES.map((b) => ({ ...b })));
  pads = $state<Pad[]>(structuredClone(PADS));
  /** Every trigger graph, keyed by graph key — the editable model. No authored/pad
      distinction: pad graphs (keyed `drumId:zone`) and graphs minted via createGraph()
      / duplicateGraph() (keyed `graph-<n>`) are all first-class, generic graphs that
      rename / duplicate / delete uniformly. */
  graphs = $state<Record<string, voice.TriggerGraph>>(seedGraphs());
  /** display labels for EVERY graph key — pad keys included (seeded by pad-label hydration,
      e.g. "Kick · center"), authored keys named at create/duplicate time. */
  graphNames = $state<Record<string, string>>({});
  /** mutable preset library — snapshots you Apply onto / Save from play nodes (S39). */
  presets = $state<Preset[]>(structuredClone(PRESETS));
  /** User-authored canvas scene documents (U5). Each projects a virtual `canvas:<id>`
      effect + default preset (see `canvasEffects`/`allPresets`), persisted in the show doc. */
  canvasScenes = $state<CanvasScene[]>([]);

  bpm = $state(120);
  velocity = $state(0.85);
  /** transport — playing gates the sim clock; beatsPerBar drives the readout. */
  playing = $state(true);
  beatsPerBar = $state(4);

  selectedPadKey = $state<string | null>(padKey(PADS[2]!));

  // popups (targets are play nodes from the active graph)
  galleryBlock = $state<voice.GraphNode | null>(null); // effect swap
  settingsBlock = $state<voice.GraphNode | null>(null); // preset + params + envelopes
  liveNodePositions = $state.raw<Record<string, { x: number; y: number }>>({});
  envTarget = $state<{ block: GraphNode; key: string } | null>(null); // envelope editor

  // --- setlist (songs → sections → flat ordered graph lists) ---------------
  // `songs` / `songRefs` / `activeSongId` are owned by {@link showsCtl} (R23) — see the
  // delegators alongside its field. R24 still owns the section-arrangement runes below.
  /** The ONE active section (U4 merged the old `activeSectionId` look-recall +
      `arrangeSectionId` arrange focus): the section you're playing IS the one you're
      editing. Drives hit-resolution (its graphs fire), the look-morph recall, and the
      Sections / Trigger views' highlight. Defaults to the first fixture section. */
  activeSectionId = $state<string | null>(SECTIONS[0]?.id ?? null);
  /** Section copy/paste scratch — a deep copy of the last-copied section (id+name+graph
      list), or null when nothing is on the clipboard. Transient (NOT persisted): a fresh
      session starts with an empty clipboard. `pasteSection` clones this under a new id. */
  sectionClipboard = $state<SetlistSection | null>(null);

  // --- clipboard paste dialogs (S44) ---------------------------------------------
  /** Open when the Songs paste flow is active — the dialog picks a destination (this show vs the
      Song Library) and offers a manual-paste textarea when the browser blocks clipboard reads. */
  songPasteOpen = $state(false);
  /** Non-null when a graph/section paste hit a blocked clipboard read: drives the manual paste-text
      fallback dialog, remembering which context the pasted text should materialize into. */
  pasteFallback = $state<{ context: 'graph' | 'section' } | null>(null);

  /** persisted shell pane sizes in px, keyed by a stable pane id (set by the
      resizable docks — step 3). Empty until the user drags a splitter. */
  paneSizes = $state<Record<string, number>>({});

  /** Patch-graph per-node display-label overrides, keyed by flow-node id (the Inspector's
      rename field). UI-only — the device topology node ids aren't part of the server
      Project — so it persists via the authored-state autosave, not over WS. Empty until a
      node is renamed. */
  patchLabels = $state<Record<string, string>>({});

  // Shows / setlist / song-library state (showLibrary, activeShowId, songs, songRefs, activeSongId,
  // songLibrary) + its deriveds/CRUD/sync/persistence are owned by {@link showsCtl} (R23, store split
  // 4/5). The store delegates its public surface via the accessors below.

  // transient snapshot
  voices = $state<Voice[]>([]);
  log = $state<LogEntry[]>([]);
  timeMs = $state(0);
  beat = $state(0);
  busLevels = $state<Record<string, number>>({});
  /** Per-voice detail streamed from the server engine's stats (S17) — the authoritative voice list
      while the engine link is open (the sim stops firing when connected, so its `voices` are stale).
      Empty offline / before the first stats. {@link dockVoices} source-selects between this and the
      sim. */
  serverVoices = $state<VoiceStat[]>([]);
  monitorEvents = $state<MonitorEvent[]>([]);
  monitorTypeFilter = $state<MonitorFilterType>(DEFAULT_MONITOR_FILTERS.type);
  monitorTextFilter = $state(DEFAULT_MONITOR_FILTERS.text);
  monitorSourceFilter = $state(DEFAULT_MONITOR_FILTERS.source);
  monitorDestinationFilter = $state(DEFAULT_MONITOR_FILTERS.destination);
  private monitorSeq = 1;
  /** measured output frame rate — local rAF rate when offline, the server's real
      LED output rate when the WS link is open (the server's number wins). */
  fps = $state(0);
  /** engine link state for the status bar — 'offline' when no server, else the
      live WS handshake state ('connecting' while dialing, 'open' once handshook). */
  link = $state<'offline' | 'connecting' | 'open'>('offline');
  /** engine round-trip latency (ms) — 0 until the WS link reports it. */
  latencyMs = $state(0);
  /** Latest server OutputStatus (arming state, packetsSent, lastError, universeCount) —
      from the `state` message on connect and every `stats` tick. null until the first
      arrives (offline / pre-handshake). The OutputPill derives its truth from this plus
      {@link link}, not link state alone (link can be open while Art-Net is failing). S03's
      output status panel reads the same field. */
  output = $state<OutputStatus | null>(null);
  /** Instantaneous send rate (packets/s) derived from the change in `output.packetsSent` between
      successive `stats` ticks (see {@link packetsPerSecond}). null until two ticks have arrived, or
      after a counter reset — shown as "—". A steady 0 means armed-but-nothing-flowing. */
  outputPacketsPerSec = $state<number | null>(null);
  /** Previous packet counter sample, kept to derive {@link outputPacketsPerSec}. Plain field —
      must NOT be reactive (it is bookkeeping for the derivation, not rendered). */
  private prevPacketSample: PacketSample | null = null;
  /** PixLite controller monitor (S48/S49/R29) — reactive status/candidates/scanning + the panel send
      helpers, extracted into {@link ControllerMonitor} (R20). The store delegates its public surface
      to this via the accessors + forwarders below, so callers/tests are unchanged. */
  private readonly monitor = new ControllerMonitor({
    send: (msg) => this.client.send(msg),
    isViewer: () => this.isViewer,
    setOutput: (patch) => this.setOutput(patch),
  });
  /** PixLite controller test-pattern (S49) — the LOUD test-data takeover (drive / exit) + its
      reactive view, extracted into {@link ControllerTest} (R22, store split 3/5). Sibling of
      {@link monitor}; the active pattern is server-reported on the monitor's status, so this reads
      it through `currentTestPattern`. The store delegates its public surface below, unchanged. */
  private readonly controllerTest = new ControllerTest({
    send: (msg) => this.client.send(msg),
    isViewer: () => this.isViewer,
    currentTestPattern: () => this.monitor.status?.testPattern ?? null,
  });
  /** Live status of the ADOPTED PixLite controller (S47/S48). See {@link ControllerMonitor.status}.
      Settable so the ui-shot seam can inject a synthetic status. */
  get controllerStatus(): ControllerStatus | null {
    return this.monitor.status;
  }
  set controllerStatus(status: ControllerStatus | null) {
    this.monitor.status = status;
  }
  /** Ranked discovery candidates (best-first). See {@link ControllerMonitor.candidates}. */
  get controllerCandidates(): DiscoveredController[] {
    return this.monitor.candidates;
  }
  /** The active controller test pattern (S49), or null in LIVE mode. Drives the panel banner AND
      {@link deriveOutputPill}'s third argument. See {@link ControllerTest.takeover}. */
  get controllerTakeover(): ControllerTestPattern | null {
    return this.controllerTest.takeover;
  }

  /** Shows / setlist / song-library (R23, store split 4/5) — the multi-show document library, the
      setlist songs, the canonical song pool, their resolved runtime view, and the server-library
      cold-load/write-through sync, extracted into {@link ShowsController}. The store delegates its
      public surface to this via the accessors + forwarders below, and supplies the authored-state
      swap machinery, the graph model, the section-arrangement boundary (R24), and the WS link
      through the injected host. */
  private readonly showsCtl = new ShowsController({
    graphs: () => this.graphs,
    graphNames: () => this.graphNames,
    effects: () => this.effects,
    presets: () => this.presets,
    mergeGraphModel: (patch) => {
      if (patch.graphs) this.graphs = { ...this.graphs, ...patch.graphs };
      if (patch.graphNames) this.graphNames = { ...this.graphNames, ...patch.graphNames };
      if (patch.effects) this.effects = [...this.effects, ...patch.effects];
      if (patch.presets) this.presets = [...this.presets, ...patch.presets];
    },
    toAuthored: () => this.toAuthored(),
    applyShow: (show) => this.applyShow(show),
    resetAuthoredToSeed: () => this.resetAuthoredToSeed(),
    normalizeGraphs: () => this.normalizeGraphs(),
    setActiveSectionId: (id) => (this.activeSectionId = id),
    isViewer: () => this.isViewer,
    linkOpen: () => this.link === 'open',
    send: (msg) => this.client.send(msg),
  } satisfies ShowsControllerHost);

  // --- shows / setlist / song-library state delegators (R23) — owned by showsCtl ---------------
  /** Which show is live — its `authored` is what the authored runes mirror. */
  get activeShowId(): string {
    return this.showsCtl.activeShowId;
  }
  set activeShowId(id: string) {
    this.showsCtl.activeShowId = id;
  }
  /** authored arrangement: songs, each with sections that hold a FLAT ordered list of graph KEYS. */
  get songs(): Song[] {
    return this.showsCtl.songs;
  }
  set songs(v: Song[]) {
    this.showsCtl.songs = v;
  }
  /** Library-song references (S41): ids into {@link songLibrary} the active show resolves in. */
  get songRefs(): string[] {
    return this.showsCtl.songRefs;
  }
  set songRefs(v: string[]) {
    this.showsCtl.songRefs = v;
  }
  /** which song the Sections view + Songs rail show. */
  get activeSongId(): string {
    return this.showsCtl.activeSongId;
  }
  set activeSongId(id: string) {
    this.showsCtl.activeSongId = id;
  }
  /** The canonical song pool shows reference (S40) — a second server-authoritative library. */
  get songLibrary(): SongLibrary {
    return this.showsCtl.songLibrary;
  }
  set songLibrary(v: SongLibrary) {
    this.showsCtl.songLibrary = v;
  }
  /** The show list for the browser UI — `{ id, name }` in insertion order. */
  get shows(): { id: string; name: string }[] {
    return this.showsCtl.shows;
  }
  /** The active show (id + name + its cached authored). null only before construction completes. */
  get activeShow(): Show | null {
    return this.showsCtl.activeShow;
  }
  /** The active song over the RESOLVED song list (local + referenced) — falls back to the first. */
  get activeSong(): Song | null {
    return this.showsCtl.activeSong;
  }
  /** The active show with its library references materialized in (S42). */
  get resolvedView() {
    return this.showsCtl.resolvedView;
  }
  /** The materialized song list (local + referenced) — the setlist the Songs rail + engine read. */
  get resolvedSongs(): Song[] {
    return this.showsCtl.resolvedSongs;
  }
  /** The song pool as id+name+usedBy for the library UI (delete-guard surface). */
  get songLibraryList(): { id: string; name: string; usedBy: { id: string; name: string }[] }[] {
    return this.showsCtl.songLibraryList;
  }

  // --- shows / setlist / song-library forwarders (R23) — thin, API-preserving ------------------
  newShow(name?: string): string {
    return this.showsCtl.newShow(name);
  }
  openShow(id: string): void {
    this.showsCtl.openShow(id);
  }
  saveShow(): void {
    this.showsCtl.saveShow();
  }
  saveShowAs(name: string): string {
    return this.showsCtl.saveShowAs(name);
  }
  renameShow(id: string, name: string): void {
    this.showsCtl.renameShow(id, name);
  }
  deleteShow(id: string): void {
    this.showsCtl.deleteShow(id);
  }
  closeShow(): void {
    this.showsCtl.closeShow();
  }
  exportSongToLibrary(songId: string): string | null {
    return this.showsCtl.exportSongToLibrary(songId);
  }
  importSongReference(librarySongId: string): void {
    this.showsCtl.importSongReference(librarySongId);
  }
  removeSongReference(librarySongId: string): void {
    this.showsCtl.removeSongReference(librarySongId);
  }
  detachSongReference(librarySongId: string): string | null {
    return this.showsCtl.detachSongReference(librarySongId);
  }
  renameLibrarySong(librarySongId: string, name: string): void {
    this.showsCtl.renameLibrarySong(librarySongId, name);
  }
  deleteLibrarySong(librarySongId: string): { id: string; name: string }[] {
    return this.showsCtl.deleteLibrarySong(librarySongId);
  }
  showsUsingSong(librarySongId: string): { id: string; name: string }[] {
    return this.showsCtl.showsUsingSong(librarySongId);
  }
  setActiveSong(songId: string): void {
    this.showsCtl.setActiveSong(songId);
  }
  createSong(name?: string): string {
    return this.showsCtl.createSong(name);
  }
  renameSong(id: string, name: string): void {
    this.showsCtl.renameSong(id, name);
  }
  duplicateSong(id: string): string | null {
    return this.showsCtl.duplicateSong(id);
  }
  removeSong(id: string): void {
    this.showsCtl.removeSong(id);
  }
  /** Multi-client presence (S1) from the server's `presence` message: who is the single editor,
      whether WE are it, and the live headcount. null until the first presence arrives (offline /
      pre-handshake) — treated as standalone (local-wins authoring) so the single-user path is
      unchanged. */
  presence = $state<{ editorId: string | null; youAreEditor: boolean; clientCount: number } | null>(null);
  /** latest binary RGB frame from the server engine (null until one arrives) —
      the kit preview shows this instead of the local composite when connected. */
  serverFrame = $state<Uint8Array | null>(null);
  /** the server engine's real kit model (from the WS `state` message). The engine
      runs its OWN kit (density/geometry/pixel count), so its frames only map onto
      ITS model — previewing them on the local lab model misaligns every pixel. We
      adopt this for the preview while connected. null until the first state msg. */
  serverModel = $state<SerializedModel | null>(null);
  /** The authoritative server `Project` (routing / geometry / input / transport),
      adopted from the WS `state` message — the source of truth the Patch graph and
      the per-node Inspector editors read + mutate. null until the first state msg
      (offline / not yet connected). The thin mutators below optimistic-write here and
      forward the edit over WS; the server round-trips the next `state` to confirm. */
  project = $state<Project | null>(null);

  /** Remote-access surface (S3) from the server's `state` message: the public share URL of the
      Cloudflare tunnel + the room PIN, for the host to share. null when neither is configured
      (plain local dev). */
  tunnel = $state<TunnelInfo | null>(null);
  /** The server refused our connection for a wrong/absent room PIN (close 4401) — drives the
      PIN-entry gate. Cleared once a supplied PIN is accepted (the link opens). */
  authRequired = $state(false);
  /** Count of PIN refusals — increments on every 4401. The gate watches it to show an
      "incorrect PIN" hint after a failed retry (authRequired alone can't signal a re-failure
      since it stays true across the retry). */
  authFailCount = $state(0);
  /** The last server `error` message (e.g. a rejected patch paste — S45), or null once cleared.
      Surfaced as a dismissible notice so an invalid `setProject` is user-visible with no silent
      failure; cleared on the next successful patch send or when the user dismisses it. */
  serverError = $state<string | null>(null);

  /** mutable effect registry — the effect creator appends here (synced to the sim). */
  effects = $state<EffectDef[]>([...EFFECTS]);
  drums = DRUMS;

  labModel = buildLabModel();
  frameBuf = new Uint8Array(this.labModel.model.count * 3);
  localPreviewActive = $state(false);
  private localPreviewTimer: ReturnType<typeof setTimeout> | null = null;
  /** Safe to preview server geometry only once the link is up AND we have BOTH the
      server's model and a frame — model.count and frame length must agree, so they
      switch together (never a server frame on the lab model, or vice versa). */
  useServer = $derived(this.link === 'open' && !!this.serverModel && !!this.serverFrame);
  /** Preview model: the engine's real kit when connected, else the local lab kit. */
  model = $derived<SerializedModel>(this.useServer ? this.serverModel! : this.labModel.model);
  /** Preview frame: the engine's composited output when connected, else local sim. */
  previewFrame = $derived<Uint8Array>(this.useServer ? this.serverFrame! : this.frameBuf);
  /** Voice list for the Layers/Buses dock (S17): the server's streamed voices while the engine link
      is open (its render is authoritative — the sim no longer fires when connected), the local sim's
      voices offline. Pure source-selection lives in {@link selectDockVoices}. Gated on `link` (the
      firing/authority gate), not `useServer` (the stricter visualiser-frame gate): the dock owns no
      pixels, so it can adopt server voices the instant the link opens without waiting for a frame. */
  dockVoices = $derived<DockVoice[]>(
    selectDockVoices({
      connected: this.link === 'open',
      simVoices: this.voices,
      serverVoices: this.serverVoices,
    }),
  );

  /** DISPLAY-smoothed dock state (item H): the server streams stats at ~2 Hz, and adopting
      them raw made meters/chips step visibly. These mirror {@link busLevels}/{@link dockVoices}
      but exponentially approach the authoritative values, advanced every rAF frame by
      {@link start}'s loop. Display-only — the server (or offline sim) stays the truth; nothing
      writes back. The dock renders these. */
  busLevelsDisplay = $state<Record<string, number>>({});
  dockVoicesDisplay = $state.raw<DockVoice[]>([]);
  /** Per-voice display levels backing {@link dockVoicesDisplay} (pruned as voices die). */
  private voiceLevelDisplay = new Map<string, number>();

  /** Advance the display-smoothed dock values one frame toward the authoritative ones. */
  private tickDockDisplay(dtMs: number): void {
    const alpha = smoothingAlpha(dtMs);
    this.busLevelsDisplay = smoothBusLevels(this.busLevelsDisplay, this.busLevels, alpha);
    this.dockVoicesDisplay = smoothDockVoices(this.voiceLevelDisplay, this.dockVoices, alpha);
  }

  /** This client's authoring role, derived from {@link presence} (S1 multi-client):
      - 'standalone' — no presence yet (offline / single user): local-wins authoring, as before;
      - 'editor' — we hold the editor slot with other clients connected;
      - 'viewer' — another client edits (or the editor left): we live-follow the server, no authoring.
      Only 'viewer' changes behaviour (follow the server); 'editor' and 'standalone' both author with
      the local-wins cold-load (06cb92e). */
  role = $derived<'editor' | 'viewer' | 'standalone'>(
    this.presence === null
      ? 'standalone'
      : this.presence.youAreEditor
        ? this.presence.clientCount > 1
          ? 'editor'
          : 'standalone'
        : 'viewer',
  );
  /** Whether we live-follow the editor's broadcast instead of authoring (role === 'viewer'). */
  isViewer = $derived(this.role === 'viewer');
  /** Whether this client may AUTHOR (S2): the editor + the standalone single-user can edit;
      only a viewer is read-only. Authoring mutators no-op when false, and views bind their edit
      affordances' `disabled` to `!canEdit` so a viewer's UI is genuinely read-only (not just
      ignored). View-only interactions (selecting/panning/switching, playing pads) stay enabled. */
  canEdit = $derived(!this.isViewer);
  /** Whether the editor slot is held by ANOTHER client (multi-client, we're a viewer) — the
      TopBar shows a Takeover affordance only then (standalone/editor don't need it). */
  canTakeover = $derived(this.role === 'viewer');
  /** Editing-status text for the TopBar indicator (S2): the editor sees "You're editing", a
      viewer sees that another client holds the slot, standalone shows the plain editing state. */
  editorLabel = $derived<string>(
    this.role === 'viewer' ? 'Another client is editing' : this.role === 'editor' ? "You're editing" : 'Editing',
  );

  sim: Sim;
  private raf = 0;
  private last = 0;
  private fpsLast = 0;
  private fpsFrames = 0;

  // --- engine link (real output runs on the server, mirrored here) ----------
  /** WS link to the server voice engine. Injectable so tests can pass a fake;
      defaults to the real auto-reconnecting client. Created in start(), closed
      in stop(). */
  private readonly client: WSClient;
  /** MIDI input + MIDI-learn (R6/S37) — the WebMIDI device layer + learn-arm machinery, extracted
      into {@link MidiController} (R21). The store keeps `forwardMidi`/`receiveInputEcho` (entangled
      with the offline sim + S04 badges) and delegates the rest via the accessors + forwarders below,
      so callers/tests are unchanged. */
  private readonly midi = new MidiController({
    isViewer: () => this.isViewer,
    getInputMap: () => this.project?.inputMap ?? null,
    setInputMap: (inputMap) => this.setInputMap(inputMap),
    setTriggerSource: (graphKey, source) => this.setTriggerSource(graphKey, source),
    selectedGraphNodes: () => this.selectedGraph?.nodes,
  });
  /** The armed MIDI-learn target, or null when nothing is waiting to bind. See
      {@link MidiController.learnTarget}. */
  get midiLearnTarget(): MidiLearnTarget | null {
    return this.midi.learnTarget;
  }
  /** The global MIDI channel filter (null = omni), from the patch input map. */
  midiChannel = $derived(this.project?.inputMap.midiChannel ?? null);
  /** Live WebMIDI input devices for the settings list. See {@link MidiController.devices}. */
  get midiDevices(): MidiDeviceInfo[] {
    return this.midi.devices;
  }
  /** Whether WebMIDI access succeeded — drives the settings empty-state copy. See
      {@link MidiController.available}. */
  get midiAvailable(): boolean {
    return this.midi.available;
  }
  /** Why WebMIDI is unavailable, when it is. See {@link MidiController.unavailableReason}. */
  get midiUnavailableReason(): string | undefined {
    return this.midi.unavailableReason;
  }

  // --- input activity ("last heard") ---------------------------------------
  /** Last-heard event per input identity (note / OSC address), for the S04 activity
      badges. Keyed via {@link activityKey} so a binding's badge is a single lookup and
      traffic for OTHER notes/addresses never churns it. A SvelteMap for fine-grained
      per-key reactivity. Fed from BOTH input paths (local WebMIDI forward + server echo). */
  private readonly inputActivity = new SvelteMap<string, InputActivity>();
  /** Coarse age clock (ms epoch) advanced ~2×/s from the RAF loop — what makes a badge
      "age out visually" between hits. Separate from the event map so a new event and the
      passage of time are independent reactive triggers. */
  private nowTick = $state(Date.now());

  /** disposes the autosave $effect.root (null while persistence is not running). */
  private persistDispose: (() => void) | null = null;
  /** pending debounced-save timer (plain field — must NOT be reactive). */
  private saveTimer: ReturnType<typeof setTimeout> | null = null;
  /** beforeunload handler that synchronously flushes a pending debounced save, so a hard
      browser refresh inside the debounce window doesn't drop the last edit (e.g. a node
      drag). Registered in startAutosave, removed in stopAutosave. */
  private flushOnUnload: (() => void) | null = null;
  /** Reactive save status for the TopBar indicator ('idle' | 'saving' | 'saved'),
      driven by the autosave path through {@link saveStatusCtl}. */
  saveStatus = $state<SaveStatus>('idle');
  /** Timing controller behind {@link saveStatus} — enforces the min-visible 'saving'
      window + 'saved' hold so the indicator reads even when a flush is instant. */
  private saveStatusCtl = new SaveStatusController((s) => (this.saveStatus = s));
  /** Skips the indicator for the autosave $effect's initial (mount) run, so the app
      doesn't flash "Saving…/Saved" on load; armed by the first scheduleSave. */
  private autosaveArmed = false;

  /** Engine-link change-detection (per-frame transport push + authored-Show resend). */
  private readonly engineSync = new EngineLinkSync();
  private readonly undoLimit = 10000;
  private undoStack: AuthoredState[] = [];
  private restoringUndo = false;
  /** When true, {@link pushUndoSnapshot} is a no-op so a follow-on mutation folds into the
      caller's already-open checkpoint instead of opening its own — the R04 add+auto-wire is one
      undoable action. Set only via {@link batchIntoCurrentUndo}. */
  private suppressUndoSnapshot = false;
  /** Whether a controller discovery sweep is in flight. See {@link ControllerMonitor.scanning}. */
  get controllerScanning(): boolean {
    return this.monitor.scanning;
  }

  constructor(
    makeClient: () => WSClient = () =>
      new WSClient({ pin: readStoredPin(), hostToken: readHostToken() }),
  ) {
    // Load the show library from storage BEFORE the sim is built and the engine link opens,
    // so the sim's registries and the first setShow/recallSection reflect the ACTIVE show's
    // restored content. loadShowLibrary never throws: a valid library wins; else a legacy
    // single blob is migrated to one "Default Show"; else a fresh "Untitled Show" is seeded.
    // Hydrate the show + song libraries from storage into the controller (reserving their ids) and
    // mirror the ACTIVE show's authored over the seed defaults — a migrated/fresh slice is partial,
    // so applyAuthored fills any absent field. loadShowLibrary never throws: a valid library wins;
    // else a legacy single blob migrates to one "Default Show"; else a fresh "Untitled Show" seeds.
    this.applyAuthored(this.showsCtl.hydrateFromStorage());
    // Make every pad-bound graph's trigger source EXPLICIT (a `drum` source from its padKey) and
    // fold any legacy `on:'velocity'` switch into the canonical `value`+`bands` form — seed or
    // restored, idempotent, authored graphs left unset.
    this.normalizeGraphs();
    // Build the sim from the (possibly restored) arrays — it snapshots `buses` by reference and
    // indexes `effects`/`presets` into maps at construction, so it must see the hydrated arrays.
    this.sim = new Sim(this.buses, this.effects, this.presets);
    this.client = makeClient();
  }

  selectedPad = $derived(this.pads.find((p) => padKey(p) === this.selectedPadKey) ?? null);

  // The resolved runtime view (`resolvedView`/`resolvedSongs`) + the `songLibraryList` are owned by
  // {@link showsCtl} (R23) — the store exposes them via the getters alongside its field. Consumers
  // (selectedGraph, graphLabel, showSource, the paste/clipboard region) read through those getters.

  // Read through the RESOLVED graphs (S42): selecting a referenced library graph opens the
  // library's rune-backed proxy, so editing its nodes writes through to the canonical copy
  // (propagation) — while a local graph resolves to the same proxy it always did.
  selectedGraph: voice.TriggerGraph | null = $derived(this.selectedPadKey ? this.resolvedView.graphs[this.selectedPadKey] ?? null : null);
  beatPhase = $derived((this.beat % 4) / 4);

  // `shows`/`activeShow` (show derived) and `activeSong` (over the RESOLVED song list) are owned by
  // {@link showsCtl} (R23) — exposed via the getters alongside its field. The section-arrangement
  // deriveds below (R24) read the active song through that getter.
  /** The active section (SetlistSection) in the active song — the section you play + edit.
      Its flat `graphs` list drives hit-resolution + the Sections/Trigger views. */
  activeSection = $derived(this.activeSong?.sections.find((s) => s.id === this.activeSectionId) ?? null);
  /** The look-morph section list (`{ id, name, looks }`) the engine spawns on recall, the
      offline sim recalls, and the Perform view lists — DERIVED from the active song's authored
      sections so authored looks (S16) are the single source of truth (no separate fixture look
      array to drift). `buildShow` reads this for `Show.sections`; the offline `setActiveSection`
      recall resolves the look here. Empty when there is no active song. */
  sections = $derived<Section[]>(
    (this.activeSong?.sections ?? []).map((s) => ({ id: s.id, name: s.name, looks: s.looks })),
  );
  /** The reusable graph library: every EXISTING graph key with its display label — pad graphs
      and authored graphs alike, no distinction — in graph insertion order (pads first, then
      created/duplicated graphs). Drives the section picker + slot labels. A deleted graph drops
      out (it's no longer in `graphs`). */
  graphLibrary = $derived(Object.keys(this.graphs).map((key) => ({ key, label: this.graphLabel(key) })));

  /** The last graph fired through {@link fireSectionGraph} (the hotkey / graph-card path) —
      display-only, so the Graphs dock can flash the fired card. `seq` distinguishes repeat
      fires of the same key. */
  lastSectionFire = $state<{ key: string; seq: number } | null>(null);
  private fireSeq = 0;

  /** Per-graph last-fire wall-clock (`performance.now()` ms), keyed by graph key — display-only
      state that drives live-on-trigger node previews (TouchDesigner-style: a trigger-driven node
      face is STATIC until its graph fires, then plays live from that instant). This is a UI
      timestamp, NOT engine/render state, so core purity + determinism are untouched. */
  graphFireAt = $state<Record<string, number>>({});
  private markGraphFire(key: string): void {
    const now = typeof performance !== 'undefined' ? performance.now() : Date.now();
    this.graphFireAt = { ...this.graphFireAt, [key]: now };
  }
  /** The fire epoch of the graph open in the editor (or null if it hasn't fired this session) —
      threaded into that graph's node previews so they animate on the graph's own fire. */
  get selectedGraphFireAt(): number | null {
    return this.selectedPadKey ? (this.graphFireAt[this.selectedPadKey] ?? null) : null;
  }

  /** Human label for a graph key (for the section lists + picker): the stored display name
      (`graphNames`, populated for every graph incl. pad keys at hydrate), else a kit-derived pad
      label, else the raw key. */
  graphLabel(key: string): string {
    // Resolved names (S42): a referenced library graph's display name lives in the resolved
    // view, not the local `graphNames`; local names are a subset, so labels still resolve.
    return graphsLib.graphLabelOf(this.resolvedView.graphNames, key, this.pads);
  }

  // --- lifecycle -----------------------------------------------------------

  start(): void {
    if (this.raf) return;
    this.startAutosave();
    this.wireClient();
    this.client.connect();
    // Request hardware MIDI and forward it to the server (notes + transport recall).
    // Fire-and-forget: degrades to a no-op when the browser has no WebMIDI / in tests.
    void this.midi.openInput((ev) => this.forwardMidi(ev));
    this.last = performance.now();
    this.fpsLast = this.last;
    this.fpsFrames = 0;
    const loop = (now: number): void => {
      const dt = Math.min(64, now - this.last);
      this.last = now;
      this.sim.bpm = this.bpm;
      if (this.playing) this.sim.tick(dt);
      // Skip the sim composite while the visualiser is adopting SERVER frames — the local
      // buffer would be rendered and thrown away every frame (wave-1 finding: wasted work,
      // and a second render truth ticking in the background). The sim still ticks above so
      // the offline preview resumes instantly when the link drops.
      if (!this.useServer) this.renderFrame();
      this.snapshot();
      this.tickDockDisplay(dt);
      // measure local output rate — but only publish it when offline; when the
      // link is open the server reports the real LED output rate via onStats.
      this.fpsFrames++;
      const elapsed = now - this.fpsLast;
      if (elapsed >= 500) {
        if (this.link !== 'open') this.fps = Math.round((this.fpsFrames * 1000) / elapsed);
        this.fpsFrames = 0;
        this.fpsLast = now;
        // Advance the input-activity age clock (~2×/s) so badges age out visually.
        this.nowTick = Date.now();
      }
      // push transport to the server only when it actually changed (never per-frame)
      this.syncTransport();
      this.raf = requestAnimationFrame(loop);
    };
    this.raf = requestAnimationFrame(loop);
  }

  stop(): void {
    if (this.raf) cancelAnimationFrame(this.raf);
    this.raf = 0;
    this.midi.release();
    this.client.close();
    this.engineSync.reset();
    if (this.localPreviewTimer) clearTimeout(this.localPreviewTimer);
    this.localPreviewTimer = null;
    this.localPreviewActive = false;
    this.stopAutosave();
  }

  /** Claim the single editor role (S2): ask the server to hand US the editor slot. The prior
      editor drops to viewer; the server re-broadcasts `presence`, so `role`/`canEdit` flip on the
      next message (no refresh). A no-op when offline (`send` drops while closed) or already the
      editor — pressing it as the editor just re-confirms the slot. */
  takeover(): void {
    this.client.send({ t: 'takeover' });
  }

  /** Ask the server to start or stop the share tunnel (S3 in-app control). Server-authoritative:
      progress lands back as `TunnelInfo.status` on the next `state` broadcasts (off → starting →
      live/error). The server refuses viewers (editor gate) and any client that arrived VIA the
      tunnel; a no-op when offline. */
  setSharing(on: boolean): void {
    this.client.send({ t: 'tunnel', action: on ? 'start' : 'stop' });
  }

  /** Submit a room PIN from the entry gate (S3): remember it for this tab and retry the
      connection. A correct PIN opens the link (clearing {@link authRequired}); a wrong one
      refuses again and re-shows the gate. */
  submitPin(pin: string): void {
    const trimmed = pin.trim();
    if (!trimmed) return;
    writeStoredPin(trimmed);
    this.client.reconnectWithPin(trimmed);
  }

  /** Forward a parsed MIDI event over the engine link: notes as `midi`, Control Change as
      `cc`, Program Change as `programChange` (the latter two drive global transport recall —
      the server maps them to song/section recall before the per-trigger zone-map). */
  private forwardMidi(ev: MidiEvent): void {
    switch (ev.kind) {
      case 'note':
        this.sim.setNote(ev.note, ev.velocity, ev.channel, ev.on && ev.velocity > 0);
        if (ev.on && ev.velocity > 0) {
          // Local WebMIDI never round-trips back as a server `input` echo, so record the
          // badge activity here (channel-filtered inside recordInputActivity).
          this.recordInputActivity({ kind: 'midi', note: ev.note, channel: ev.channel, value: ev.velocity, time: Date.now() });
          if (this.acceptsMidiChannel(ev.channel)) {
            this.midi.applyNoteLearn(ev.note);
            // Preview the fire on the local sim ONLY when offline. When connected the server is the
            // sole resolver/renderer and streams its frames/levels back — firing here as well would
            // double the hit (the echo loop). Authority principle, doc 03.
            if (this.link !== 'open') this.fireRawMidiLocal(ev.note, ev.velocity);
          }
        }
        this.client.send({ t: 'midi', note: ev.note, velocity: ev.velocity, on: ev.on, channel: ev.channel });
        return;
      case 'cc':
        // S37: a CC source node can MIDI-learn the next incoming controller; the live value
        // feeds the offline sim's CC table so the graph preview (+ S38 readout) tracks it.
        // Controller 0 is reserved for section recall and never learns/binds here.
        if (this.acceptsMidiChannel(ev.channel)) this.midi.applyCcLearn(ev.controller);
        this.sim.setCc(ev.controller, ev.value, ev.channel);
        this.client.send({ t: 'cc', controller: ev.controller, value: ev.value, channel: ev.channel });
        return;
      case 'programChange':
        this.client.send({ t: 'programChange', value: ev.value, channel: ev.channel });
        return;
    }
  }

  // --- live persistence (show library ⇄ localStorage) ----------------------

  /** Make every pad-bound graph's trigger source explicit, fold legacy velocity switches, and
      hydrate a friendly display name onto every pad-keyed graph — the graph back-compat the
      constructor and every show load run (idempotent). Delegates to the pure hydrate slice. */
  private normalizeGraphs(): void {
    const { graphs, graphNames, actions } = hydrateGraphs(
      this.graphs,
      this.graphNames,
      this.pads,
      (effectId) => this.effects.find((e) => e.id === effectId)?.params ?? [],
      (presetId) => this.presetById(presetId)?.params,
    );
    this.graphs = graphs;
    this.graphNames = graphNames;
    // Announce anything the hydrate did on the user's behalf (R02) — the single choke point every
    // load/adopt/show-switch funnels through, so a migration/auto-wire announces once and batched.
    // A no-op hydrate (already Gen3) yields an empty summary, so this stays silent.
    announceSystemActions(actions);
  }

  /** Reset every authored rune to the blank-document seed (via {@link seedAuthored}) — the
      clean baseline a show SWITCH starts from, so no field of the outgoing show survives. */
  private resetAuthoredToSeed(): void {
    this.applyAuthored(seedAuthored());
  }

  /** Load a show's authored content into the live runes: reset to the blank seed, apply the
      show's (partial-tolerant, detached) authored over it, then re-run the graph normalizers.
      A FULL swap — no field of the previously-active show bleeds through. Clears the sim's
      pending-fire queue so stale delay fires from the outgoing show cannot materialise
      (mirrors core `engine.ts` `setShow()` clearing `pendingFires`). */
  private applyShow(show: Show): void {
    this.resetAuthoredToSeed();
    this.applyAuthored($state.snapshot(show.authored));
    this.normalizeGraphs();
    this.sim.clearPendingFires();
  }

  /** Read the authored runes into a plain, JSON-safe slice (proxies stripped). */
  private toAuthored(): AuthoredState {
    return $state.snapshot({
      graphs: this.graphs,
      graphNames: this.graphNames,
      songs: this.songs,
      songRefs: this.songRefs,
      buses: this.buses,
      presets: this.presets,
      effects: this.effects,
      canvasScenes: this.canvasScenes,
      selectedPadKey: this.selectedPadKey,
      activeSongId: this.activeSongId,
      activeSectionId: this.activeSectionId,
      bpm: this.bpm,
      velocity: this.velocity,
      beatsPerBar: this.beatsPerBar,
      paneSizes: this.paneSizes,
      patchLabels: this.patchLabels,
    }) as AuthoredState;
  }

  /** Merge a (partial) restored slice into the runes — only present fields, so a
      missing/forward field keeps its seed default. */
  private applyAuthored(a: Partial<AuthoredState>): void {
    if (a.graphs) this.graphs = a.graphs;
    if (a.graphNames) this.graphNames = a.graphNames;
    if (a.songs) this.songs = a.songs;
    // Always assigned (even when absent) so a show that references nothing CLEARS the outgoing
    // show's refs on a swap — no cross-show bleed of references (seed/applyShow reset to []).
    this.songRefs = a.songRefs ?? [];
    if (a.buses) this.buses = a.buses;
    // Union, never replace (mirrors effects below): a stale localStorage slice must
    // not drop the built-in generator `:default` presets, or play nodes that point at
    // a generator effect can't resolve their preset (blank sub + frozen live preview).
    if (a.presets) this.presets = unionPresets(a.presets);
    // Union, never replace: keep every current built-in (so new generator effects
    // always appear) and re-add only the user's own created effects.
    if (a.effects) this.effects = unionEffects(a.effects);
    // Always assigned (even when absent) so switching from a scene-heavy show to a
    // scene-less show clears prior scenes — no cross-show bleed.
    this.canvasScenes = a.canvasScenes ?? [];
    if (a.selectedPadKey !== undefined) this.selectedPadKey = a.selectedPadKey;
    if (a.activeSongId !== undefined) this.activeSongId = a.activeSongId;
    if (a.activeSectionId !== undefined) this.activeSectionId = a.activeSectionId;
    if (typeof a.bpm === 'number') this.bpm = a.bpm;
    if (typeof a.velocity === 'number') this.velocity = a.velocity;
    if (typeof a.beatsPerBar === 'number') this.beatsPerBar = a.beatsPerBar;
    if (a.paneSizes) this.paneSizes = a.paneSizes;
    if (a.patchLabels) this.patchLabels = a.patchLabels;
  }

  private pushUndoSnapshot(): void {
    if (this.restoringUndo || this.isViewer || this.suppressUndoSnapshot) return;
    this.undoStack.push(structuredClone(this.toAuthored()));
    if (this.undoStack.length > this.undoLimit) {
      this.undoStack.splice(0, this.undoStack.length - this.undoLimit);
    }
  }

  runUndoable<T>(edit: () => T): T {
    this.pushUndoSnapshot();
    return edit();
  }

  /** Run `edit` WITHOUT opening a new undo checkpoint — any {@link pushUndoSnapshot} inside it is
      suppressed, so its mutations fold into the caller's existing snapshot and a single undo
      reverts the whole batch (R04: an added Effect and its auto-wire undo together). */
  private batchIntoCurrentUndo<T>(edit: () => T): T {
    const prev = this.suppressUndoSnapshot;
    this.suppressUndoSnapshot = true;
    try {
      return edit();
    } finally {
      this.suppressUndoSnapshot = prev;
    }
  }

  undo(): boolean {
    if (this.isViewer) return false;
    const prev = this.undoStack.pop();
    if (!prev) return false;
    this.restoringUndo = true;
    this.resetAuthoredToSeed();
    this.applyAuthored(prev);
    this.normalizeGraphs();
    this.sim = new Sim(this.buses, this.effects, this.presets);
    this.sim.clearPendingFires();
    this.snapshot();
    this.restoringUndo = false;
    return true;
  }

  /** Begin reactively autosaving the show library (debounced). Idempotent; a no-op without
      localStorage (SSR / node tests). The $effect deep-reads the active show's authored runes
      AND the showLibrary + activeShowId (via currentLibrary), so any authored edit, show
      add/rename/delete, or switch re-schedules a save. */
  private startAutosave(): void {
    if (this.persistDispose || typeof localStorage === 'undefined') return;
    this.persistDispose = $effect.root(() => {
      $effect(() => {
        const lib = this.showsCtl.currentLibrary();
        // Deep-read the song library too, so a song-library edit (export / rename / delete)
        // re-schedules a save on the SAME debounce as any authored edit.
        const songLib = this.showsCtl.currentSongLibrary();
        this.scheduleSave(lib, songLib);
      });
      // Keep the offline sim's effect/preset registries in step with the RESOLVED view (S42), so a
      // referenced section fires its own effects/presets in the in-browser preview — not just over
      // the engine link. register* are idempotent upserts; re-runs on any ref/library change.
      $effect(() => {
        for (const e of this.resolvedView.effects) this.sim.registerEffect(e);
        for (const p of this.resolvedView.presets) this.sim.registerPreset(p);
      });
    });
    if (typeof window !== 'undefined') {
      this.flushOnUnload = () => {
        if (!this.saveTimer) return;
        clearTimeout(this.saveTimer);
        this.saveTimer = null;
        writeStoredLibrary(serializeShowLibrary(this.showsCtl.currentLibrary()));
        writeStoredSongLibrary(serializeSongLibrary(this.showsCtl.currentSongLibrary()));
      };
      window.addEventListener('beforeunload', this.flushOnUnload);
    }
  }

  /** Flush any pending write and tear down the autosave effect (on stop/unmount),
      so edits in the last debounce window are not lost. */
  private stopAutosave(): void {
    if (!this.persistDispose) return;
    if (this.saveTimer) {
      clearTimeout(this.saveTimer);
      this.saveTimer = null;
    }
    writeStoredLibrary(serializeShowLibrary(this.showsCtl.currentLibrary()));
    writeStoredSongLibrary(serializeSongLibrary(this.showsCtl.currentSongLibrary()));
    this.persistDispose();
    this.persistDispose = null;
    if (this.flushOnUnload && typeof window !== 'undefined') {
      window.removeEventListener('beforeunload', this.flushOnUnload);
      this.flushOnUnload = null;
    }
    // Cancel any pending indicator transition and re-arm the mount guard for a future start().
    this.saveStatusCtl.dispose();
    this.autosaveArmed = false;
  }

  private scheduleSave(lib: ShowLibrary, songLib: SongLibrary): void {
    // Show "Saving…" the moment an edit schedules a write — but skip the autosave $effect's
    // first (mount) run, which fires with no user edit and shouldn't blip the indicator.
    if (this.autosaveArmed) this.saveStatusCtl.saving();
    else this.autosaveArmed = true;
    if (this.saveTimer) clearTimeout(this.saveTimer);
    this.saveTimer = setTimeout(() => {
      this.saveTimer = null;
      writeStoredLibrary(serializeShowLibrary(lib)); // localStorage cache (write-through)
      writeStoredSongLibrary(serializeSongLibrary(songLib)); // the song pool's own cache
      // Same debounced tick re-syncs the active show's authored Show to the engine (guarded so
      // it only sends on a real change) — so live edits AND show switches reach the server.
      this.syncShowToServer();
      // …and pushes the authored show library to the server (the source of truth), so a
      // browser-storage clear no longer loses shows. Sig-guarded; no-op until the first state.
      this.showsCtl.syncLibraryToServer();
      // …and the canonical song library (the sibling pool), same gated write-through.
      this.showsCtl.syncSongLibraryToServer();
      // The write (local cache + server push) has flushed → settle to "Saved" (held at
      // "Saving…" for the min-visible window first). A no-op for the skipped mount save.
      this.saveStatusCtl.saved();
    }, SAVE_DEBOUNCE_MS);
  }

  // Show CRUD (new/open/save/save-as/rename/delete/close) + song-library refs (export/import/
  // detach/rename/delete/usedBy) live on {@link showsCtl} (R23); the store exposes them as thin
  // forwarders alongside its field. The authored-state swap they drive (resetAuthoredToSeed /
  // applyShow / normalizeGraphs / toAuthored) stays here and is reached through the injected host.

  // --- engine link plumbing ------------------------------------------------

  /** Attach the WS callbacks (idempotent — start() may be called after a stop). */
  private wireClient(): void {
    this.client.on({
      onState: (project, model, _effects, _projects, output, showLibrary, songLibrary, tunnel) => {
        // adopt the authoritative Project (routing/geometry/IO) AND the engine's real
        // kit model so its frames map 1:1 in the preview (the server runs its own kit
        // geometry/pixel count, not the lab kit).
        this.project = project;
        this.serverModel = model;
        // adopt the server's output truth (arming/packets/error) so the OutputPill AND the S03
        // output status panel are honest from the first handshake, before the first stats tick lands.
        this.output = output;
        // remote-access surface (share URL + PIN) for the host UI
        this.tunnel = tunnel;
        // Cold-load reconcile of BOTH server-authoritative libraries (show library + canonical song
        // pool): adopt server on first state / seed it from our cache / viewer live-follows. Role-
        // aware (S1) — presence arrives before this state on a (re)connect, so `isViewer` is settled.
        // Owned by {@link ShowsController} (R23).
        this.showsCtl.reconcileOnState(showLibrary, songLibrary);
      },
      onPresence: (editorId, youAreEditor, clientCount) => {
        // Adopt the server's view of who edits + the headcount. Drives `role`/`isViewer`, which
        // gate the cold-load reconcile (above) and the outbound authoring syncs (below).
        this.presence = { editorId, youAreEditor, clientCount };
      },
      onShowLibrary: (library) => {
        // Live authored-library push from the editor, relayed by the server. Only a viewer follows it
        // (the editor is the source and is never sent its own echo). Owned by {@link ShowsController}.
        this.showsCtl.followShowLibrary(library);
      },
      onSongLibrary: (library) => {
        // Live SONG-library push from the editor, relayed by the server — the sibling of
        // onShowLibrary. Only a viewer follows it. Owned by {@link ShowsController}.
        this.showsCtl.followSongLibrary(library);
      },
      onControllerStatus: (status) => {
        // Live truth of the adopted controller (S47/S48). null = nothing adopted (panel shows the
        // Discover affordance). This is the confidence chain's last link — rendered directly.
        this.monitor.ingestStatus(status);
      },
      onControllerDiscovery: (candidates) => {
        // A discovery sweep finished — replace the candidate list wholesale (best-first).
        this.monitor.ingestDiscovery(candidates);
      },
      onAuthError: () => {
        // Server refused our room PIN (close 4401). Surface the PIN-entry gate; the reconnect
        // loop is paused in the client until submitPin() supplies one.
        this.authRequired = true;
        this.authFailCount += 1;
        this.link = 'offline';
      },
      onConnection: (state: ConnectionState) => {
        // map the client's 'closed' to the lab's 'offline'; others pass through
        this.link = state === 'closed' ? 'offline' : state;
        if (state === 'open') {
          // A successful handshake means any PIN we sent was accepted — clear the gate.
          this.authRequired = false;
          // hand the server the authored content (with library refs resolved in), then transport
          const show = buildShow(this.showSource);
          this.client.send({ t: 'setShow', show });
          this.engineSync.baselineShow(show); // baseline so the first sync tick is a no-op
          const cur = { bpm: this.bpm, playing: this.playing, beatsPerBar: this.beatsPerBar };
          this.engineSync.baselineTransport(cur);
          this.client.send({ t: 'setTransport', ...cur });
          // align the engine's active section with the store's current active section
          if (this.activeSectionId) {
            this.client.send({ t: 'recallSection', songId: this.activeSongId, sectionId: this.activeSectionId });
          }
        } else {
          // a drop means our next open must re-send the transport + Show
          this.engineSync.reset();
          // Clear the output truth (S03) — a dropped link can't confirm packets are leaving the
          // box, so the panel must not keep showing a frozen "armed"/rate. Resets to the offline
          // empty state; the next `state`/`stats` after reconnect repopulates it.
          this.output = null;
          this.outputPacketsPerSec = null;
          this.prevPacketSample = null;
          // Same for the adopted controller (S48): a dropped link can't confirm the box's rx truth,
          // so the panel must not keep a frozen "receiving". The next `controllerStatus` after a
          // reconnect (once the panel re-subscribes via watchController) repopulates it.
          this.monitor.clearOnLinkDrop();
          // Forget presence on a drop → revert to standalone (local-wins) authoring until the next
          // handshake re-establishes our role, so an offline editor keeps full local control.
          this.presence = null;
          // Drop the server voice list — offline the dock reads the sim again, and stale server
          // voices must not linger into the next connect.
          this.serverVoices = [];
        }
      },
      onStats: (_stats, latencyMs, fps, output, voice) => {
        this.latencyMs = latencyMs;
        this.fps = fps; // the server's measured LED output rate wins while connected
        // Output transport truth: adopt the status (for the OutputPill, S02) and derive packets/s
        // (S03) from the change in the cumulative counter since the last tick. The derivation is
        // pure + tested; the store just owns the "previous sample" bookkeeping across discrete ticks.
        this.output = output;
        const sample: PacketSample = { packetsSent: output.packetsSent, atMs: performance.now() };
        this.outputPacketsPerSec = packetsPerSecond(this.prevPacketSample, sample);
        this.prevPacketSample = sample;
        // In voice mode, the server owns the live bus levels AND the per-voice list; the local sim
        // is only an offline preview once the socket is connected (the sim no longer fires — S12).
        if (voice?.busLevels) this.busLevels = voice.busLevels;
        this.serverVoices = voice?.voices ?? [];
      },
      onFrame: (frame) => {
        this.serverFrame = frame;
      },
      onInput: (kind, label, value, note, channel) => this.receiveInputEcho(kind, label, value, note, channel),
      // Server-side rejection (e.g. an invalid patch paste — S45): surface it as a dismissible
      // notice so the failure is user-visible rather than silent.
      onError: (message) => {
        this.serverError = message;
      },
      onMonitor: (event) => this.addMonitor(event),
      onSend: (msg) => this.addMonitor(this.monitorForClientMessage(msg)),
    });
  }

  /** Handle a server `input` broadcast — native MIDI/OSC, a transport recall, or the echo of our
      own forwarded hit. Applies MIDI-learn from ANY input source (so learning works from hardware
      arriving at the server or another client) and records last-heard badge activity for the
      MIDI and OSC paths (S04 — hardware arriving at the server must still light the badges), but
      NEVER fires the sim: when connected the server is the sole resolver/renderer, so firing here
      re-fired every hit — the echo loop this slice kills (doc 03). Monitor display of the input
      rides the separate onMonitor / server-diagnostics path, so dropping the local fire leaves
      the timeline intact. */
  private receiveInputEcho(
    kind: 'midi' | 'osc',
    label: string,
    value: number,
    note: number | undefined,
    channel: number | undefined,
  ): void {
    const time = Date.now();
    if (kind === 'midi' && note !== undefined) {
      const velocity = Math.round(Math.max(0, Math.min(1, value)) * 127);
      this.recordInputActivity({ kind: 'midi', note, channel, value: velocity, time });
      if (value > 0 && this.acceptsMidiChannel(channel)) {
        this.midi.applyNoteLearn(note);
      }
    } else if (kind === 'osc') {
      // For OSC the wire `label` carries the address (see server broadcastJson).
      this.recordInputActivity({ kind: 'osc', address: label, value, time });
      // Feed the sim's OSC table so an OSC-bound modulation source previews live (the OSC
      // analogue of forwardMidi's `sim.setCc`; OSC arrives only via the server broadcast).
      this.sim.setOsc(label, value);
    }
  }

  private monitorForClientMessage(msg: ClientMessage): Omit<MonitorEvent, 'id' | 'time'> {
    switch (msg.t) {
      case 'midi':
        return {
          type: 'input',
          direction: 'out',
          source: 'web',
          destination: 'server',
          label: `MIDI ${msg.on ? 'note on' : 'note off'} ${msg.note}`,
          detail: `velocity=${msg.velocity}${msg.channel != null ? `; channel=${msg.channel}` : ''}`,
        };
      case 'cc':
        return { type: 'input', direction: 'out', source: 'web', destination: 'server', label: `MIDI CC ${msg.controller}`, detail: `value=${msg.value}` };
      case 'programChange':
        return { type: 'input', direction: 'out', source: 'web', destination: 'server', label: `MIDI program ${msg.value}` };
      case 'osc':
        return { type: 'input', direction: 'out', source: 'web', destination: 'server', label: `OSC ${msg.address}`, detail: `value=${msg.value}` };
      case 'key':
        return { type: 'input', direction: 'out', source: 'web', destination: 'server', label: `Key ${msg.drumId}:${msg.zone ?? ''}`, detail: `velocity=${msg.velocity ?? 1}` };
      case 'setShow':
        return { type: 'graph', direction: 'out', source: 'web', destination: 'server', label: 'Set show', detail: `${Object.keys(msg.show.graphs).length} graphs` };
      default:
        return { type: 'system', direction: 'out', source: 'web', destination: 'server', label: msg.t };
    }
  }

  /** Re-send the authored Show to the engine when it actually changed, so edits
      (swap effect, tweak params/preset, rewire a graph, edit slots/buses) take
      effect live — without this the server runs whatever Show it got at connect
      time and keeps firing the original effects. Driven off the debounced autosave
      tick. The {@link EngineLinkSync} signature guard skips no-op fires AND pure
      node-position (x/y) drags, so dragging the graph doesn't needlessly reset engine
      voices; transport lives on a separate message so tempo edits never resend the
      Show. NOTE: setShow reseeds the engine (voices clear) — acceptable for authoring;
      a finer-grained live-update message is a future refinement. */
  /** The engine's Show source with library references RESOLVED IN (S42): the sent Show carries the
      referenced songs' graphs/effects/presets/sections (namespaced, collision-free) so the engine can
      recallSection + fire a referenced section. Persistence (`toAuthored`) is untouched — it still
      stores refs, not copies — so canonical propagation survives a reload. `sections` already resolves
      via {@link activeSong}. */
  private get showSource(): ShowSource {
    const rv = this.resolvedView;
    return {
      buses: this.buses,
      graphs: rv.graphs,
      sections: this.sections,
      // Send virtual canvas effects + their default presets alongside the real registry so
      // the engine's VoicePool can host `canvas:<id>` voices; scene docs register the generators.
      effects: [...rv.effects, ...this.canvasEffects],
      presets: [...rv.presets, ...this.allPresets.filter((p) => p.effectId.startsWith('canvas:'))],
      canvasScenes: this.canvasScenes,
      drums: this.drums,
      songs: this.resolvedSongs,
    };
  }

  private syncShowToServer(): void {
    if (this.link !== 'open' || this.isViewer) return; // a viewer follows the editor — never authors up
    const show = buildShow(this.showSource);
    if (!this.engineSync.planShowPush(show)) return;
    this.client.send({ t: 'setShow', show });
    // setShow reseeds the active section to the first song/section — restore focus.
    if (this.activeSectionId) {
      this.client.send({ t: 'recallSection', songId: this.activeSongId, sectionId: this.activeSectionId });
    }
  }

  // The server-authoritative library adopt + write-through (cold-load reconcile / viewer follow /
  // sig-guarded push, for BOTH the show library and the canonical song pool) lives on
  // {@link showsCtl} (R23) — driven from the `state`/`showLibrary`/`songLibrary` handlers above and
  // the autosave tick. Only the engine SHOW push ({@link syncShowToServer}, resolved-in refs) stays.

  /** Send setTransport to the server iff bpm/playing/beatsPerBar changed. */
  private syncTransport(): void {
    if (this.link !== 'open' || this.isViewer) return; // a viewer follows the editor — never authors up
    const cur = { bpm: this.bpm, playing: this.playing, beatsPerBar: this.beatsPerBar };
    if (!this.engineSync.planTransportPush(cur)) return;
    this.client.send({ t: 'setTransport', ...cur });
  }

  private snapshot(): void {
    this.voices = this.sim.voices.slice();
    this.log = this.sim.log.slice(0, 40);
    this.timeMs = this.sim.timeMs;
    this.beat = this.sim.beat;
    // Bus meters follow the same authority rule as the voice list: the server owns them when
    // connected (streamed via onStats). Writing the sim's levels here every rAF frame would clobber
    // that ~2 Hz server value ~30× a second, so only publish sim levels while offline.
    if (this.link !== 'open') {
      const levels: Record<string, number> = {};
      for (const b of this.buses) levels[b.id] = this.sim.busLevel(b.id);
      this.busLevels = levels;
    }
  }

  private addMonitor(event: Omit<MonitorEvent, 'id' | 'time'> | MonitorEvent): void {
    const full: MonitorEvent = { id: this.monitorSeq++, time: Date.now(), ...event };
    this.monitorEvents = appendMonitorEvent(this.monitorEvents, full);
  }

  clearMonitor(): void {
    this.monitorEvents = [];
  }

  /** Surface a client-side editor fault on the Monitor as an `error` event, so a
      live-show failure (a thrown xyflow callback, a failed graph projection) is visible
      in the Monitor timeline instead of silently corrupting the canvas. `source` groups
      the fault (e.g. `trigger-graph`), `label` names it, `detail` carries the message. */
  reportError(source: string, label: string, detail?: string): void {
    this.addMonitor({ type: 'error', direction: 'local', source, label, detail });
  }

  setMonitorTypeFilter(type: MonitorFilterType): void {
    this.monitorTypeFilter = type;
  }

  setMonitorTextFilter(text: string): void {
    this.monitorTextFilter = text;
  }

  setMonitorSourceFilter(source: string): void {
    this.monitorSourceFilter = source;
  }

  setMonitorDestinationFilter(destination: string): void {
    this.monitorDestinationFilter = destination;
  }

  resetMonitorFilters(): void {
    this.monitorTypeFilter = DEFAULT_MONITOR_FILTERS.type;
    this.monitorTextFilter = DEFAULT_MONITOR_FILTERS.text;
    this.monitorSourceFilter = DEFAULT_MONITOR_FILTERS.source;
    this.monitorDestinationFilter = DEFAULT_MONITOR_FILTERS.destination;
  }

  visibleMonitorEvents = $derived.by(() => {
    return filterMonitorEvents(this.monitorEvents, {
      type: this.monitorTypeFilter,
      text: this.monitorTextFilter,
      source: this.monitorSourceFilter,
      destination: this.monitorDestinationFilter,
    });
  });

  private renderFrame(): void {
    compositeFrame(this.frameBuf, this.sim, this.labModel);
  }

  private markLocalPreview(): void {
    this.localPreviewActive = true;
    if (this.localPreviewTimer) clearTimeout(this.localPreviewTimer);
    this.localPreviewTimer = setTimeout(() => {
      this.localPreviewActive = false;
      this.localPreviewTimer = null;
    }, 350);
  }

  private mappedDrumIdForMidiNote(note: number): string | null {
    return this.project?.inputMap.midiNotes.find((m) => m.note === note)?.drumId ?? null;
  }

  private sourceDrumIdForTriggerSource(src: TriggerSource | undefined): string {
    if (src?.kind === 'drum') return src.drumId;
    if (src?.kind === 'midi' && src.note !== undefined) {
      return this.mappedDrumIdForMidiNote(src.note) ?? this.pads[0]?.drumId ?? '';
    }
    return this.pads[0]?.drumId ?? '';
  }

  private fireRawMidiLocal(note: number, value: number): void {
    const toFire = resolveGraphsForFire(this.resolvedView.graphs, { kind: 'midi', note, value });
    if (toFire.length === 0) return;
    const idx = this.sections.findIndex((s) => s.id === this.activeSectionId);
    const ctx = {
      velocity: Math.max(0, Math.min(1, value / 127)),
      sectionIndex: idx < 0 ? 0 : idx,
      sectionCount: this.sections.length,
      beatPhase: this.beatPhase,
      sourceDrumId: this.mappedDrumIdForMidiNote(note) ?? this.pads[0]?.drumId ?? '',
      bpm: this.bpm,
    };
    for (const { key, graph } of toFire) {
      const resolved = this.sim.triggerGraph(this.graphLabel(key), graph, ctx);
      this.addMonitor({
        type: 'effect',
        direction: 'local',
        source: `midi:${note}`,
        label: this.graphLabel(key),
        detail: resolved.join(' | '),
      });
    }
    this.renderFrame();
    this.snapshot();
    this.markLocalPreview();
  }

  // --- play surface --------------------------------------------------------

  /**
   * Resolve which graphs to fire locally for a pad hit — U4 model + U3 source filter.
   * Candidate graphs = the ACTIVE section's flat graph list; a graph fires when its trigger
   * `source` is a `drum` source matching this pad's drum+zone ({@link sourceMatchesPad}) — so
   * each zone still fires only its own graph, and LAYERING is two section graphs sharing a
   * source (both fire). Returns one entry per matching graph in section order (may be empty
   * when the section doesn't use this pad). Falls back to the flat per-pad graph when there
   * is NO active section — today's pre-section per-zone behaviour.
   *
   * (Raw MIDI/OSC direct bindings resolve via the sim's `resolveGraphsForFire` / the server
   * input-router — U3 — not this pad path.)
   */
  private resolveHitGraphsLocal(pad: Pad): Array<{ graph: TriggerGraph; label: string; key: string }> {
    const section = this.activeSection;
    // Resolved graphs (S42): a referenced section's keys (`lib:<id>/…`) only exist in the resolved
    // view, so hit-resolution reads through it — a referenced section fires exactly like a local one.
    const graphs = this.resolvedView.graphs;
    if (section) {
      const resolved: Array<{ graph: TriggerGraph; label: string; key: string }> = [];
      for (const key of section.graphs) {
        const g = graphs[key];
        if (g && sourceMatchesPad(triggerSourceOf(g), pad.drumId, String(pad.zone))) {
          resolved.push({ graph: g, label: this.graphLabel(key), key });
        }
      }
      return resolved;
    }
    const key = padKey(pad);
    const g = graphs[key];
    return g ? [{ graph: g, label: `${pad.drumLabel} · ${pad.zoneLabel}`, key }] : [];
  }

  hit(pad: Pad): void {
    const toFire = this.resolveHitGraphsLocal(pad);
    if (toFire.length === 0) return;
    // Mark each fired graph's UI fire-clock so its live-on-trigger node previews play (both
    // online + offline — the preview is display-only and reacts to the local intent either way).
    for (const { key } of toFire) this.markGraphFire(key);
    // Connected: the server owns resolution + render. Forward the hit and let its frames/levels
    // come back; do NOT fire the local sim (authority principle, doc 03). `onInput` has no `key`
    // echo branch, so this is a single authoritative fire.
    if (this.link === 'open') {
      this.client.send({ t: 'key', drumId: pad.drumId, zone: String(pad.zone), velocity: this.velocity });
      return;
    }
    // Offline preview: fire the local sim (it drives the lab's voice lanes + resolution log).
    const idx = this.sections.findIndex((s) => s.id === this.activeSectionId);
    const ctx = {
      velocity: this.velocity,
      sectionIndex: idx < 0 ? 0 : idx,
      sectionCount: this.sections.length,
      beatPhase: this.beatPhase,
      sourceDrumId: pad.drumId,
      bpm: this.bpm,
    };
    for (const { graph, label } of toFire) {
      const resolved = this.sim.triggerGraph(label, graph, ctx);
      this.addMonitor({ type: 'effect', direction: 'local', source: `${pad.drumId}:${pad.zone}`, label, detail: resolved.join(' | ') });
    }
    this.renderFrame();
    this.snapshot();
    this.markLocalPreview();
  }

  /** Fire the graph at `index` in the ACTIVE section's ordered graph list directly — the
      computer-keyboard performance path (keys 1–9 → graphs 1–9, 0 → graph 10). Unlike
      {@link hit} this does NOT filter by trigger-source match: it plays exactly the n-th graph
      the active section lists, and is a no-op when the section has fewer graphs. */
  fireSectionGraph(index: number): void {
    const key = this.activeSection?.graphs[index];
    const graph = key ? this.graphs[key] : undefined;
    if (!key || !graph) return;
    this.selectedPadKey = key; // show the graph that fired
    this.lastSectionFire = { key, seq: ++this.fireSeq }; // Graphs-dock card flash
    this.markGraphFire(key); // live-on-trigger node previews
    const src = triggerSourceOf(graph);
    // Connected: send the `fireGraph` INTENT (the exact graph key), not a synthetic MIDI/OSC
    // source. The server fires precisely this graph — no re-resolution, so no zone-map/direct
    // both-fire and no echo mis-fire (the old keyboard triple-fire). The local sim stays silent
    // (authority principle, doc 03 §3).
    if (this.link === 'open') {
      this.client.send({ t: 'fireGraph', graphKey: key, velocity: this.velocity });
      return;
    }
    // Offline preview: fire the local sim directly (no source-match filter — the n-th graph plays).
    const idx = this.sections.findIndex((s) => s.id === this.activeSectionId);
    const ctx = {
      velocity: this.velocity,
      sectionIndex: idx < 0 ? 0 : idx,
      sectionCount: this.sections.length,
      beatPhase: this.beatPhase,
      sourceDrumId: this.sourceDrumIdForTriggerSource(src),
      bpm: this.bpm,
    };
    const resolved = this.sim.triggerGraph(this.graphLabel(key), graph, ctx);
    this.addMonitor({ type: 'effect', direction: 'local', source: 'keyboard', label: this.graphLabel(key), detail: resolved.join(' | ') });
    this.renderFrame();
    this.snapshot();
    this.markLocalPreview();
  }

  togglePlay(): void {
    this.playing = !this.playing;
  }

  stopBus(busId: string): void {
    this.sim.stopBus(busId);
    this.snapshot();
  }
  panic(): void {
    this.sim.stopAll();
    this.snapshot();
  }

  // --- voice model (branch 1) ----------------------------------------------

  setPolyphony(busId: string, poly: Polyphony): void {
    if (this.isViewer) return; // read-only viewer (S2): authoring no-op
    const b = this.buses.find((x) => x.id === busId);
    if (b) b.polyphony = poly;
  }
  setCrossfade(busId: string, ms: number): void {
    if (this.isViewer) return; // read-only viewer (S2): authoring no-op
    const b = this.buses.find((x) => x.id === busId);
    if (b) b.crossfadeMs = ms;
  }

  // --- active section (U4: merged look-recall + arrange focus) -------------

  /**
   * Activate a section — it becomes the one you're PLAYING and the one you're EDITING
   * (U4 merged the old `recall` look-morph and `setArrangeSection` arrange focus). Sets
   * `activeSectionId`, recalls the timed look-morph when a fixture look shares this id, and
   * tells the engine to fire this section's graphs.
   */
  setActiveSection(sectionId: string): void {
    this.activeSectionId = sectionId;
    const look = this.sections.find((s) => s.id === sectionId);
    // Offline preview only: when connected the server engine spawns this section's looks
    // itself (S15 engine parity), so firing the sim too would double-spawn. Mirror the
    // outbound authority gate (S12) — the sim resolves only while the link is closed.
    if (look && this.link !== 'open') {
      this.sim.recallSection(look);
      this.snapshot();
    }
    if (this.link === 'open') {
      this.client.send({ t: 'recallSection', songId: this.activeSongId, sectionId });
    }
  }

  /**
   * Select a graph within a section: make that section active (above) and open the graph in
   * the canvas (highlighted via `selectedPadKey`). The Sections view and the Trigger view's
   * section list both call this for select → activate + open + highlight. No-op-safe if the
   * graph key is unknown.
   */
  selectGraphInSection(sectionId: string, graphKey: string): void {
    this.setActiveSection(sectionId);
    // Resolved lookup (S42) so a referenced section's `lib:<id>/…` graph is selectable/openable.
    if (this.resolvedView.graphs[graphKey]) this.selectedPadKey = graphKey;
  }

  // --- authoritative project mutators (Patch graph: routing / geometry / IO) ------
  // Each writes the edit into the local `project` optimistically (so the UI reflects it
  // before the round-trip) AND forwards it to the server over WS. The server applies it
  // to the live voice host (S1) and re-broadcasts `state`, which re-adopts above. Edits
  // are NOT persisted to localStorage — the server Project is the source of truth, so
  // routing/geometry survive a reload by coming back down in the next `state` message.
  // No-op writes when offline (project null); the WS send is a no-op until the link is up.
  // The pure immutable Project transforms live in the trigger-routing slice.

  /** Edit a drum's transform (origin/rotation/spin/start-angle/literal pixel count). */
  setDrumTransform(drumId: string, partial: routing.DrumTransformPartial): void {
    if (this.isViewer) return; // read-only viewer (S2): authoring no-op
    if (this.project) this.project = routing.applyDrumTransform(this.project, drumId, partial);
    this.client.send({ t: 'setKitTransform', drumId, ...partial });
  }

  /** Set the kit-global mirror (S11): a geometry-only world reflection (none/x/y). Kit-wide,
   * not per-drum — applies live to the whole model and persists with the project. */
  setKitMirror(mirror: 'none' | 'x' | 'y'): void {
    if (this.isViewer) return; // read-only viewer (S2): authoring no-op
    if (this.project) this.project = routing.applyKitGlobal(this.project, { mirror });
    this.client.send({ t: 'setKitGlobal', mirror });
  }

  /** Replace the physical-output topology (a Patch graph rewire → PixLite patch order). */
  setRouting(outputs: OutputConfig[]): void {
    if (this.isViewer) return; // read-only viewer (S2): authoring no-op
    if (this.project) this.project = routing.applyRouting(this.project, outputs);
    this.client.send({ t: 'setKitOutputs', outputs });
  }

  /** Replace the input map (zone-node MIDI note / OSC address routing). */
  setInputMap(inputMap: InputMap): void {
    if (this.isViewer) return; // read-only viewer (S2): authoring no-op
    if (this.project) this.project = routing.applyInputMap(this.project, inputMap);
    this.client.send({ t: 'setInputMap', inputMap });
  }

  setMidiChannel(channel: number | null): void {
    if (this.isViewer || !this.project) return;
    this.setInputMap({ ...this.project.inputMap, midiChannel: channel });
  }

  startMidiLearn(target: MidiLearnTarget): void {
    this.midi.startLearn(target);
  }

  cancelMidiLearn(): void {
    this.midi.cancelLearn();
  }

  private acceptsMidiChannel(channel: number | undefined): boolean {
    return acceptsChannel(this.midiChannel, channel);
  }

  /** Record a heard input event for the activity badges (S04). Applies the global MIDI
      channel filter here so a badge appears iff the event would also fire; upserts under
      the event's identity key (newest wins), which is why unrelated traffic never churns
      an unrelated binding. Called from BOTH input paths — the local WebMIDI forward and
      the server `input` echo — since the server does not echo a client's own input back. */
  private recordInputActivity(activity: InputActivity): void {
    if (activity.kind === 'midi') {
      if (activity.note === undefined || !this.acceptsMidiChannel(activity.channel)) return;
      this.inputActivity.set(activityKey({ kind: 'midi', note: activity.note }), activity);
    } else if (activity.address) {
      this.inputActivity.set(activityKey({ kind: 'osc', address: activity.address }), activity);
    }
  }

  /** Last-heard badge for an input binding, or null when nothing matching has been heard
      (or the field is drum/CC/empty → null binding). Reactive: reads the activity map +
      the age clock, so a component `$derived(store.inputBadge(b))` tracks both. */
  inputBadge(binding: InputBinding | null): InputBadgeView | null {
    return deriveInputBadge(binding, this.inputActivity, this.nowTick);
  }

  /** Apply a partial output-settings change (controller node: protocol/host/rgb/fps/…). */
  setOutput(partial: routing.OutputPartial): void {
    if (this.isViewer) return; // read-only viewer (S2): authoring no-op
    if (this.project) this.project = routing.applyOutput(this.project, partial);
    this.client.send({ t: 'setOutput', ...partial });
  }

  // --- PixLite controller monitor + test (S48/S49, group L) -----------------
  // Public API preserved as thin forwarders onto {@link monitor} (R20) and {@link controllerTest}
  // (R22) — the store split. The domain docs + gating live on those controllers; these keep the
  // store's call surface unchanged.

  watchController(watching: boolean): void {
    this.monitor.watch(watching);
  }

  discoverControllers(): void {
    this.monitor.discover();
  }

  adoptController(host: string): void {
    this.monitor.adopt(host);
  }

  setControllerAuth(password: string): void {
    this.monitor.setAuth(password);
  }

  identifyController(durationS = 5): void {
    this.monitor.identify(durationS);
  }

  setControllerTestData(pattern: ControllerTestPattern): void {
    this.controllerTest.setTestData(pattern);
  }

  backToLive(): void {
    this.controllerTest.backToLive();
  }

  /** Set or clear a Patch node's display-label override (the Inspector's rename field).
      A blank label clears the override (back to the derived title). Purely local + UI-only
      — the device topology ids aren't server state — so this persists via the authored
      autosave, never over WS. */
  setPatchLabel(nodeId: string, label: string): void {
    if (this.isViewer) return; // read-only viewer (S2): authoring no-op
    this.patchLabels = routing.setPatchLabel(this.patchLabels, nodeId, label);
  }

  // --- patch copy / paste (group K, S45) -------------------------------------
  // Copy serializes the device slices (kit incl. outputs, input map, output settings) as a
  // portable `patch` ClipDoc; paste re-rigs the device via the bulk `setProject` message —
  // schema-validated + applied wholesale server-side, behind an explicit diff confirm dialog.

  /** The current rig's device slices as a `patch` ClipDoc, ready to write to the clipboard.
      null offline (no live project). Reads the authoritative server project so a copy round-trips
      the REAL wiring, not a local optimistic edit that hasn't confirmed. */
  buildPatchDoc(): string | null {
    if (!this.project) return null;
    const { name, kit, inputMap, output } = this.project;
    return clipdoc.serialize(clipdoc.buildPatchClipDoc({ name, kit, inputMap, output }));
  }

  /** Write the current rig as a `patch` ClipDoc to the system clipboard. Returns false when there
      is nothing to copy (offline) or the clipboard is unavailable — the toolbar surfaces the result. */
  async copyPatch(): Promise<boolean> {
    const text = this.buildPatchDoc();
    if (!text || !navigator.clipboard?.writeText) return false;
    try {
      await navigator.clipboard.writeText(text);
      return true;
    } catch {
      return false; // clipboard write refused (permissions / insecure context)
    }
  }

  /** Send a validated-shape patch to the server as the bulk `setProject` re-rig. The server is the
      authoritative validator (zod) + applier — it round-trips the next `state`, which re-adopts
      above — so this does NOT optimistically write `project`. Clears any prior server error; a new
      rejection re-populates {@link serverError}. No-op for a read-only viewer. */
  setProjectPatch(patch: clipdoc.PatchPayload): void {
    if (this.isViewer) return; // read-only viewer (S2): authoring no-op
    this.serverError = null;
    this.client.send({ t: 'setProject', patch });
  }

  /** Dismiss the current server-error notice (S45 paste failure surface). */
  clearServerError(): void {
    this.serverError = null;
  }

  // --- setlist arranging (songs → sections → per-drum graph slots) ----------
  // Song CRUD (setActiveSong / createSong / renameSong / duplicateSong / removeSong) lives on
  // {@link showsCtl} (R23) — forwarded above. The section-arrangement edits below (add/rename/remove/
  // reorder sections + graph slots, R24) still go through {@link updateActiveSong} against the songs
  // rune the controller owns (read/written via the delegators), and re-point `activeSectionId`.

  /** Mutate the active song immutably via the pure setlist ops, then store it back. The single
      chokepoint for every section + graph-slot edit, so the viewer read-only guard here covers
      addSection/renameSection/removeSection + add/remove/reorder graphs (S2). */
  private updateActiveSong(fn: (song: Song) => Song): void {
    if (this.isViewer) return; // read-only viewer (S2): authoring no-op
    const id = this.activeSongId;
    this.songs = this.songs.map((s) => (s.id === id ? fn(s) : s));
  }
  /** Append a graph reference to a section's flat list (idempotent — see setlist.addGraph). */
  addGraphToSection(sectionId: string, graphKey: string): void {
    this.updateActiveSong((song) => setlist.addGraph(song, sectionId, graphKey));
  }
  /** Remove a graph reference from a section's flat list. */
  removeGraphFromSection(sectionId: string, graphKey: string): void {
    this.updateActiveSong((song) => setlist.removeGraph(song, sectionId, graphKey));
  }
  /** Replace a section's whole graph list (de-duplicated, order preserved) — for reorder. */
  setSectionGraphs(sectionId: string, graphs: string[]): void {
    this.updateActiveSong((song) => setlist.setGraphs(song, sectionId, graphs));
  }

  /** Reorder a section in the active song by drag/drop. */
  moveSection(sectionId: string, toIndex: number): void {
    this.updateActiveSong((song) => setlist.moveSection(song, sectionId, toIndex));
  }

  /** Move one graph placement within a section or across sections by drag/drop. */
  moveGraphPlacement(fromSectionId: string, graphKey: string, toSectionId: string, toIndex: number): void {
    this.updateActiveSong((song) => setlist.moveGraphPlacement(song, fromSectionId, graphKey, toSectionId, toIndex));
  }

  /** Set (or clear) the effect a section LOOPS on a bus — its "look" (S16). `effectId` `null`
      = None. Rides the standard authored-edit path: the mutation to `songs` persists via
      autosave and live-resyncs the Show to the engine (the debounced `syncShowToServer`
      re-sends `setShow` + re-recalls the active section, so a look edited on the active section
      re-morphs with the new effect). Offline — where that resync never runs — re-morph the
      local sim NOW when the edited section is the active one, so the pick is immediately
      visible/audible in the preview; connected we defer to the resync's re-recall (an immediate
      recall would race the not-yet-sent Show, spawning the stale look). */
  setLook(sectionId: string, busId: string, effectId: string | null): void {
    this.updateActiveSong((song) => setlist.setLook(song, sectionId, busId, effectId));
    if (this.link !== 'open' && sectionId === this.activeSectionId) {
      const look = this.sections.find((s) => s.id === sectionId);
      if (look) {
        this.sim.recallSection(look);
        this.snapshot();
      }
    }
  }
  addSongSection(name: string): void {
    if (this.isViewer) return; // read-only viewer (S2): authoring no-op
    const id = nid('section');
    this.updateActiveSong((song) => setlist.addSection(song, setlist.makeSection(id, name)));
    this.activeSectionId = id;
  }

  /** Rename a section of the active song (no-op-safe on an unknown id). Persists via the
      authored autosave like every other section edit. */
  renameSection(sectionId: string, name: string): void {
    this.updateActiveSong((song) => setlist.renameSection(song, sectionId, name));
  }

  /** Delete a section from the active song. When it was the ACTIVE section, re-point
      `activeSectionId` to a sensible neighbour — the section to its left, else the new
      first section, else `null` once none remain. No-op on an unknown id. Persists via the
      authored autosave. */
  removeSection(sectionId: string): void {
    if (this.isViewer) return; // read-only viewer (S2): authoring no-op
    const idx = (this.activeSong?.sections ?? []).findIndex((s) => s.id === sectionId);
    if (idx < 0) return; // not a section of the active song
    this.updateActiveSong((song) => setlist.removeSection(song, sectionId));
    if (this.activeSectionId === sectionId) {
      const remaining = this.activeSong?.sections ?? [];
      this.activeSectionId = (remaining[idx - 1] ?? remaining[0])?.id ?? null;
    }
  }

  /** Copy a section of the active song onto the clipboard (a deep, non-reactive copy via
      {@link setlist.cloneSection}, so later edits to the source never bleed into it). No-op
      if the id isn't a section of the active song. */
  copySection(sectionId: string): void {
    const sec = this.activeSong?.sections.find((s) => s.id === sectionId);
    if (!sec) return;
    // clone under its own id/name → a plain snapshot; pasteSection re-clones with a fresh id.
    this.sectionClipboard = setlist.cloneSection(sec, sec.id, sec.name);
  }

  /** Paste the clipboard as a NEW section appended to the active song (fresh id, name
      "<name> copy"), and make it active. No-op when the clipboard is empty. The clone is
      independent — its graph list is a copy, though the graph keys still reference the same
      underlying graphs (reuse). Autosave persists the new section with the rest of `songs`. */
  pasteSection(): void {
    if (this.isViewer) return; // read-only viewer (S2): authoring no-op
    const clip = this.sectionClipboard;
    if (!clip) return;
    const id = nid('section');
    const clone = setlist.cloneSection(clip, id);
    this.updateActiveSong((song) => setlist.addSection(song, clone));
    this.activeSectionId = id;
  }

  /** Duplicate a section in one step (copy + paste): appends an independent "<name> copy"
      after the song's sections and activates it. */
  duplicateSection(sectionId: string): void {
    this.copySection(sectionId);
    this.pasteSection();
  }

  // --- system clipboard copy / paste (S44, group K) ------------------------------
  // Copy lifts an authored thing PLUS its dependency closure into a portable ClipDoc (clipdoc.ts)
  // and writes the JSON to the system clipboard, so it pastes across browser sessions and servers.
  // Sources are the RESOLVED view (S42) so a referenced-library graph/section/song copies its
  // materialized content, not a dangling ref. Paste parses defensively (foreign/malformed ⇒ a
  // friendly toast, never a crash), remaps every incoming id against THIS show (built-ins kept,
  // content-equal deps reused — no duplicates on re-paste), then unions the fresh closure and
  // inserts the primary object. The pure build/parse/remap lives in clipdoc.ts; this region is the
  // thin store adapter (clipboard IO + rune mutation + toasts).

  /** The resolved-view slices a copy extracts its closure from — snapshotted so the serialized
      envelope carries plain data, never live rune proxies. */
  private clipSources(): ClosureSources {
    return {
      graphs: $state.snapshot(this.resolvedView.graphs),
      graphNames: $state.snapshot(this.resolvedView.graphNames),
      effects: $state.snapshot(this.resolvedView.effects) as EffectDef[],
      presets: $state.snapshot(this.resolvedView.presets) as Preset[],
      canvasScenes: $state.snapshot(this.canvasScenes) as CanvasScene[],
    };
  }

  /** Provenance stamped on every exported ClipDoc (advisory only — never gates paste). */
  private clipMeta(): Partial<ClipDocMeta> {
    const name = this.activeShow?.name;
    return name ? { sourceShow: name } : {};
  }

  /** Find a section by id anywhere in the resolved setlist (local or referenced song). */
  private findResolvedSection(sectionId: string): SetlistSection | undefined {
    for (const song of this.resolvedView.songs) {
      const sec = song.sections.find((s) => s.id === sectionId);
      if (sec) return sec;
    }
    return undefined;
  }

  /** Serialize a ClipDoc to the system clipboard and toast the outcome. */
  private async writeClip(doc: ClipDoc, okMessage: string): Promise<void> {
    const wrote = await writeClipboardText(serialize(doc));
    pushToast(wrote ? okMessage : 'Couldn’t reach the clipboard — copy blocked by the browser.', {
      tone: wrote ? 'success' : 'error',
    });
  }

  /** Copy a graph (by key) + its effect/preset closure to the system clipboard. */
  async copyGraphToClipboard(key: string): Promise<void> {
    if (!this.resolvedView.graphs[key]) return;
    await this.writeClip(buildGraphClipDoc(key, this.clipSources(), this.clipMeta()), 'Graph copied.');
  }

  /** Copy a section + its graphs' closure to the system clipboard. Keeps the in-app section
      clipboard ({@link copySection}) written in PARALLEL as a same-session fast path. */
  async copySectionToClipboard(sectionId: string): Promise<void> {
    const section = this.findResolvedSection(sectionId);
    if (!section) return;
    this.copySection(sectionId); // in-app fast path (no-op for a referenced song's section)
    await this.writeClip(
      buildSectionClipDoc($state.snapshot(section), this.clipSources(), this.clipMeta()),
      'Section copied.',
    );
  }

  /** Copy a song + its full closure to the system clipboard. */
  async copySongToClipboard(songId: string): Promise<void> {
    const song = this.resolvedView.songs.find((s) => s.id === songId);
    if (!song) return;
    await this.writeClip(buildSongClipDoc($state.snapshot(song), this.clipSources(), this.clipMeta()), 'Song copied.');
  }

  /** The local-show reconciliation context a paste remaps against: this show's registries (for
      content-reuse) + which effect ids are built-in registry vocabulary (kept verbatim). `mint` is
      injected only by tests; production uses the reservation-safe default. */
  private remapCtx(mint?: RemapMint): RemapContext {
    return {
      graphs: $state.snapshot(this.graphs),
      effects: $state.snapshot(this.effects) as EffectDef[],
      presets: $state.snapshot(this.presets) as Preset[],
      canvasScenes: $state.snapshot(this.canvasScenes) as CanvasScene[],
      isBuiltInEffectId: (id) => EFFECTS.some((e) => e.id === id),
      mint,
    };
  }

  /** Union a materialized paste's fresh closure into the runes (reused/built-in deps are absent)
      and insert its primary object — mirrors {@link detachSongReference}. Sim registries re-sync
      through the resolved-view effect. */
  private applyRemapResult(res: RemapResult): void {
    // Reserve the carried node/edge ids (and remapped domain ids) FIRST, so a later mint into the
    // pasted content can't collide with an id that arrived verbatim from another machine.
    reserveIds(remapResultIds(res));
    if (Object.keys(res.graphs).length > 0) this.graphs = { ...this.graphs, ...res.graphs };
    if (Object.keys(res.graphNames).length > 0) this.graphNames = { ...this.graphNames, ...res.graphNames };
    if (res.effects.length > 0) this.effects = [...this.effects, ...res.effects];
    if (res.presets.length > 0) this.presets = [...this.presets, ...res.presets];
    if (res.canvasScenes.length > 0) this.canvasScenes = [...this.canvasScenes, ...res.canvasScenes];
    if (res.kind === 'graph' && res.graphKey) {
      this.selectedPadKey = res.graphKey;
    } else if (res.kind === 'section' && res.section) {
      const section = res.section;
      this.updateActiveSong((song) => setlist.addSection(song, section));
      this.activeSectionId = section.id;
    } else if (res.kind === 'song' && res.song) {
      const song = res.song;
      this.songs = [...this.songs, song];
      this.activeSongId = song.id;
    }
  }

  /**
   * Materialize pasted clipboard text into this show — the PURE, IO-free heart of paste (parse →
   * validate context → remap/union → insert), returning a typed {@link PasteResult} the caller
   * toasts. No clipboard access here, so it's unit-testable with injected text + mint. A song paste
   * with `songDest: 'library'` instead lifts the closure into the Song Library pool (mirrors
   * {@link exportSongToLibrary}); every other authored kind remaps into the active show.
   */
  materializePaste(text: string, opts: { context: PasteContext; songDest?: SongPasteDest; mint?: RemapMint }): PasteResult {
    if (this.isViewer) return { ok: false, message: 'This show is read-only — paste is disabled.' };

    const doc = parse(text);
    if (isClipParseError(doc)) return { ok: false, message: friendlyParseMessage(doc.reason) };
    if (doc.kind === 'patch') return { ok: false, message: 'That’s a patch — paste it in the Patch view.' };
    if (doc.kind !== opts.context) {
      return { ok: false, message: `Clipboard holds a ${doc.kind}, not a ${opts.context}.` };
    }

    // Song → Library: extract a fresh, self-contained namespaced closure into the pool.
    if (doc.kind === 'song' && opts.songDest === 'library') {
      const libId = freshId('song', (id) => id in this.songLibrary.songs);
      const sources: ClosureSources = {
        graphs: doc.deps.graphs ?? {},
        graphNames: doc.deps.graphNames ?? {},
        effects: doc.deps.effects ?? [],
        presets: doc.deps.presets ?? [],
      };
      const closure = extractSongClosure(doc.payload.song, sources, libId);
      this.songLibrary = songRefsLib.withLibrarySong(this.songLibrary, closure);
      // Reserve the new pool entry's raw node/edge ids: S42 lets a user edit this referenced graph,
      // so a fresh node mint must clear any high id the pasted closure carried in.
      reserveIds(idsFromLibrarySong(closure));
      return { ok: true, kind: 'song', message: `Pasted “${doc.payload.song.name || 'song'}” into the library.` };
    }

    const res = remapClipDoc(doc, this.remapCtx(opts.mint));
    if (isClipParseError(res)) return { ok: false, message: friendlyParseMessage(res.reason) };
    this.applyRemapResult(res);
    return { ok: true, kind: res.kind, message: pasteSuccessMessage(res) };
  }

  /** Toast the outcome of a paste. */
  private finishPaste(result: PasteResult): void {
    pushToast(result.message, { tone: result.ok ? 'success' : 'error' });
  }

  /** Paste a graph from the system clipboard into the show. Opens the manual paste-text fallback
      when the browser blocks clipboard reads. */
  async pasteGraphFromClipboard(): Promise<void> {
    const text = await readClipboardText();
    if (text === null) {
      this.pasteFallback = { context: 'graph' };
      return;
    }
    this.finishPaste(this.materializePaste(text, { context: 'graph' }));
  }

  /** Paste a section from the system clipboard into the active song. When clipboard reads are
      blocked, fall back to the in-app section clipboard if present, else the paste-text dialog. */
  async pasteSectionFromClipboard(): Promise<void> {
    const text = await readClipboardText();
    if (text === null) {
      if (this.sectionClipboard) {
        this.pasteSection();
        return;
      }
      this.pasteFallback = { context: 'section' };
      return;
    }
    this.finishPaste(this.materializePaste(text, { context: 'section' }));
  }

  /** Submit manually-pasted text from the graph/section fallback dialog. */
  submitPasteFallback(text: string): void {
    const ctx = this.pasteFallback;
    this.pasteFallback = null;
    if (!ctx) return;
    this.finishPaste(this.materializePaste(text, { context: ctx.context }));
  }

  /** Dismiss the paste-text fallback dialog without pasting. */
  cancelPasteFallback(): void {
    this.pasteFallback = null;
  }

  /** Open / close the Songs paste dialog (destination chooser + fallback). */
  openSongPaste(): void {
    this.songPasteOpen = true;
  }
  closeSongPaste(): void {
    this.songPasteOpen = false;
  }

  /** Paste a song from the system clipboard into the chosen destination. Returns `'blocked'` when
      clipboard reads are unavailable so the dialog can reveal its manual paste-text field. */
  async pasteSong(dest: SongPasteDest): Promise<'ok' | 'blocked'> {
    const text = await readClipboardText();
    if (text === null) return 'blocked';
    this.pasteSongText(dest, text);
    return 'ok';
  }

  /** Materialize a song from explicit text (manual fallback) into the chosen destination, then
      close the dialog. */
  pasteSongText(dest: SongPasteDest, text: string): void {
    this.finishPaste(this.materializePaste(text, { context: 'song', songDest: dest }));
    this.songPasteOpen = false;
  }

  /** Author a brand-new, empty trigger graph (just the implicit trigger input) and
      select it for editing. Returns its key. The label defaults to "New graph N"
      (first unused N). Persisted via the authored-state autosave. */
  createGraph(name?: string): string {
    if (this.isViewer) return this.selectedPadKey ?? ''; // read-only viewer (S2): authoring no-op
    const key = freshId('graph', (k) => k in this.graphs); // global uniqueness (survives reload)
    const label = name?.trim() || graphsLib.nextGraphName(this.graphNames);
    this.graphs = { ...this.graphs, [key]: graphsLib.buildEmptyGraph() };
    this.graphNames = { ...this.graphNames, [key]: label };
    this.selectedPadKey = key;
    return key;
  }

  /** Rename ANY graph — its display label in `graphNames`. Works on every graph key (pad graphs
      included — pad-label hydration seeds their names). The autosave-consistent wrapper the
      Inspector + Sections rename fields call. A blank name keeps the existing label (mirrors
      {@link renameSong}); an unknown key (not in `graphs`) is a no-op. Persists via autosave. */
  renameGraph(key: string, name: string): void {
    if (this.isViewer) return; // read-only viewer (S2): authoring no-op
    if (!(key in this.graphs)) return;
    const trimmed = name.trim();
    if (!trimmed) return;
    this.graphNames = { ...this.graphNames, [key]: trimmed };
  }

  /** Duplicate ANY graph under a fresh authored key: deep-clone its nodes/edges (independent of
      the source), label it "<name> copy", and select it for editing. Mirrors
      {@link duplicateSong}/{@link duplicateSection}. Returns the new key, or null if `key` is
      unknown. The clone is a first-class generic graph (`graph-<n>` key) regardless of whether
      the source was a pad or authored graph; its trigger source is copied verbatim, so a
      duplicated pad graph keeps firing the same drum until rebound. NOT added to any section —
      the user places it where they want (reuse is by reference). Persists via autosave. */
  duplicateGraph(key: string): string | null {
    if (this.isViewer) return null; // read-only viewer (S2): authoring no-op
    const src = this.graphs[key];
    if (!src) return null;
    const newKey = freshId('graph', (k) => k in this.graphs); // global uniqueness (survives reload)
    const clone = graphsLib.cloneGraph($state.snapshot(src) as TriggerGraph);
    this.graphs = { ...this.graphs, [newKey]: clone };
    this.graphNames = { ...this.graphNames, [newKey]: `${this.graphLabel(key)} copy` };
    this.selectedPadKey = newKey;
    return newKey;
  }

  /** Delete ANY graph everywhere: drop it from `graphs` + `graphNames`, and purge its key from
      EVERY section across ALL songs (no dangling references). Works on every graph key — a pad
      graph is deletable too; a deleted pad graph leaves its pad SILENT (no respawn) until a
      graph with a matching trigger source exists again (hit-resolution is by source). When the
      deleted graph was the open/selected one, clear the selection. An unknown key (not in
      `graphs`) is a no-op. Persists via the authored autosave. */
  deleteGraph(key: string): void {
    if (this.isViewer) return; // read-only viewer (S2): authoring no-op
    if (!(key in this.graphs)) return;
    const next = graphsLib.removeGraphEverywhere(this.graphs, this.graphNames, this.songs, key);
    this.graphs = next.graphs;
    this.graphNames = next.graphNames;
    this.songs = next.songs;
    if (this.selectedPadKey === key) this.selectedPadKey = null;
  }

  // --- trigger source (what fires a graph — U1 model; Inspector UI is a later slice) ---

  /** Set the trigger node's source (drum / midi / osc) for a graph. The future
      Trigger-node Inspector calls this — an optimistic local write the authored autosave
      persists (the source lives on the graph's trigger node, already inside `graphs`). No
      WS message: resolving a fire from the source is a later slice. No-op if the graph or
      its trigger node is missing. */
  setTriggerSource(graphKey: string, source: TriggerSource): void {
    if (this.isViewer) return; // read-only viewer (S2): authoring no-op
    const g = this.graphs[graphKey];
    if (!g) return;
    const trig = g.nodes.find((n) => n.kind === 'trigger');
    if (trig) trig.source = source;
  }

  /** The explicit trigger source for a graph (what the Inspector reads). undefined when
      the graph/trigger is missing, or an authored graph has no source bound yet. */
  triggerSource(graphKey: string): TriggerSource | undefined {
    // Resolved (S42): a referenced section's rows read their graph's source from the resolved view.
    return this.resolvedView.graphs[graphKey]?.nodes.find((n) => n.kind === 'trigger')?.source;
  }

  // --- registries / lookups ------------------------------------------------

  /** Every resolvable canvas scene: the core built-in library (read-only, D4/U6) plus this
      show's authored scenes. An authored scene with a built-in's id shadows it. */
  get allCanvasScenes(): CanvasScene[] {
    const authoredIds = new Set(this.canvasScenes.map((scene) => scene.id));
    return [...BUILTIN_CANVAS_SCENES.filter((scene) => !authoredIds.has(scene.id)), ...this.canvasScenes];
  }

  /** True for scenes from the core built-in library (not shadowed by an authored scene) —
      read-only in the Objects view: duplicate to customise. */
  isBuiltinCanvasScene(id: string): boolean {
    return BUILTIN_CANVAS_SCENES.some((scene) => scene.id === id) && !this.canvasScenes.some((scene) => scene.id === id);
  }

  /** Virtual `canvas:<id>` effects derived from the built-in + authored scenes — never
      persisted as real effects (they'd duplicate); the scene doc is the source of truth (U5). */
  get canvasEffects(): EffectDef[] {
    return this.allCanvasScenes.map(canvasScenesLib.canvasEffectDef);
  }

  /** Real effects + virtual canvas effects — the set the gallery/inspector select from. */
  get selectableEffects(): EffectDef[] {
    return [...this.effects, ...this.canvasEffects];
  }

  /** Real presets + each scene's derived default preset (deduped by id). */
  get allPresets(): Preset[] {
    const existing = new Set(this.presets.map((p) => p.id));
    const canvasDefaults = this.allCanvasScenes
      .map(canvasScenesLib.canvasDefaultPreset)
      .filter((p) => !existing.has(p.id));
    return [...this.presets, ...canvasDefaults];
  }

  effectsForScope(scope: Scope): EffectDef[] {
    return this.selectableEffects.filter((e) => e.scope === scope);
  }
  effectOf(node: GraphNode) {
    return node.kind === 'play' || node.kind === 'effect' ? this.selectableEffects.find((e) => e.id === node.effectId) : undefined;
  }
  presetsForEffect(effectId: string): Preset[] {
    return this.allPresets.filter((p) => p.effectId === effectId);
  }
  presetById(id: string): Preset | undefined {
    return this.allPresets.find((p) => p.id === id);
  }
  /** Live params shown for a play node — always its own node-local copy (a preset is a
      snapshot, not a live binding — S39). */
  liveParams(node: GraphNode): voice.ParamValues {
    if (node.kind !== 'play' && node.kind !== 'effect') return {};
    return node.params;
  }

  // --- graph editing (freeform node wiring) --------------------------------

  /** A single copied graph node (deep, non-reactive), ready to paste into any graph.
      Node-only — wires are NOT captured (they reference other nodes). Transient: a fresh
      session starts empty. The trigger node is never copyable (a graph has exactly one). */
  nodeClipboard = $state<GraphNode | null>(null);

  /** Clone `src` into the selected graph with a fresh id at a free position near `(x, y)`,
      select it, and return it. Node-only (no wires). Refuses the trigger kind + viewers. */
  private placeClone(src: GraphNode, x: number, y: number): GraphNode | null {
    if (this.isViewer) return null;
    const g = this.selectedGraph;
    if (!g || isAnchorNode(src)) return null;
    const occupied = g.nodes.map((n) => ({ x: n.x, y: n.y, w: 184, h: 76 }));
    const pos = findFreePosition(occupied, x, y, 184, 76);
    const clone: GraphNode = { ...structuredClone($state.snapshot(src)), id: nid('n'), x: pos.x, y: pos.y };
    g.nodes.push(clone);
    return clone;
  }

  /** Copy a node onto the node clipboard (deep, non-reactive). No-op for the trigger node. */
  copyNode(node: GraphNode): void {
    if (isAnchorNode(node)) return;
    this.nodeClipboard = structuredClone($state.snapshot(node));
  }

  /** Paste the node clipboard into the selected graph, offset so it doesn't stack on the
      original. Returns the new node (selected) or null when the clipboard is empty. */
  pasteNode(): GraphNode | null {
    if (!this.nodeClipboard) return null;
    return this.placeClone(this.nodeClipboard, this.nodeClipboard.x + 36, this.nodeClipboard.y + 36);
  }

  /** Duplicate a node in place (fresh id, offset position), node-only. Returns the copy. */
  duplicateNode(node: GraphNode): GraphNode | null {
    return this.placeClone(node, node.x + 36, node.y + 36);
  }

  /** Add a node of a kind at a canvas position. Play nodes seed the first effect. */
  addNode(kind: NodeKind, x: number, y: number, options: AddNodeOptions = {}): GraphNode | null {
    if (this.isViewer) return null; // read-only viewer (S2): authoring no-op
    const g = this.selectedGraph;
    if (!g || kind === 'trigger' || kind === 'output') return null;
    this.pushUndoSnapshot();
    let node: GraphNode;
    if (kind === 'play' || kind === 'effect') {
      node = makeNode('effect', nid('n'), x, y, graphsLib.playNodeInit(this.effects, (id) => this.presetById(id)));
    } else if (kind === 'modifier') {
      node = makeNode('modifier', nid('n'), x, y, graphsLib.modifierNodeInit());
        } else if (kind === 'envelope') {
      // Seed a modulation-source envelope with a default shape in the well-known slot so it
      // animates the moment it is wired (the inspector edits this shape via the S24 editor).
      node = makeNode('envelope', nid('n'), x, y, envelopeNodeDefaults(options.envelopePreset));
    } else if (kind === 'lfo') {
      // S36 — seed default LFO settings so it animates the moment it is wired.
      node = makeNode('lfo', nid('n'), x, y, {
        lfo: { ...voice.defaultLfoSettings(), waveform: lfoPresetWaveform(options.lfoWaveform) },
      });
    } else if (kind === 'cc') {
      // Seed a CC source with controller 1 on omni (any channel) so it reads immediately; the
      // inspector edits the controller/channel or MIDI-learns the next incoming CC. (S37)
      node = makeNode('cc', nid('n'), x, y, { ccController: 1, ccChannel: null });
    } else if (kind === 'note') {
      node = makeNode('note', nid('n'), x, y, { noteNumber: 60, noteChannel: null, noteMode: 'gate', noteReleaseMs: 0 });
    } else if (kind === 'osc') {
      node = makeNode('osc', nid('n'), x, y, { oscAddress: '' });
    } else if (kind === 'randomMod') {
      node = makeNode('randomMod', nid('n'), x, y, { randomDistribution: 'linear', randomSteps: 4 });
    } else {
      node = makeNode(kind, nid('n'), x, y);
    }
    g.nodes.push(node);
    // R04: a freshly-added Effect auto-wires to the terminal Output so it makes light on the next
    // hit instead of sitting silent — folded into this add's undo checkpoint (one Ctrl/Z reverts
    // both), announced with a toast. Only the light-making Effect node auto-wires.
    if (node.kind === 'effect') this.autoWireEffectToOutput(node);
    return node;
  }

  /** Auto-wire a freshly-added Effect to the selected graph's terminal Output anchor (R04) so it
      renders on the next hit. Routes through the validated {@link connect} path — a rejected wire
      (never expected for a fresh Effect → Output, but belt-and-braces) is skipped silently — and
      batches into the add's undo checkpoint so add + wire revert as one. Announces a successful
      wire with a single toast (R02 conventions). No-op when the graph has no Output anchor. */
  private autoWireEffectToOutput(node: GraphNode): void {
    const g = this.selectedGraph;
    if (!g) return;
    const output = g.nodes.find((n) => n.kind === 'output');
    if (!output) return;
    const rejection = this.batchIntoCurrentUndo(() => this.connect(node.id, output.id));
    if (rejection === null) {
      pushToast('Effect wired to the Output anchor — it lights on the next hit.', { tone: 'info' });
    }
  }

  /** Add a modifier node pre-set to a specific registered modifier (the category palette adds
      a chosen modifier directly, vs `addNode('modifier')` which seeds the first one). Unknown
      ids are still placed — the inspector/chain runner tolerate an unresolved modifierId. */
  addModifierNode(modifierId: string, x: number, y: number): GraphNode | null {
    if (this.isViewer) return null; // read-only viewer (S2): authoring no-op
    const g = this.selectedGraph;
    if (!g) return null;
    this.pushUndoSnapshot();
    const node = makeNode('modifier', nid('n'), x, y, {
      modifierId,
      params: graphsLib.modifierParamsFor(modifierId),
    });
    g.nodes.push(node);
    return node;
  }

  moveNode(node: GraphNode, x: number, y: number): void {
    if (this.isViewer) return; // read-only viewer (S2): authoring no-op
    this.pushUndoSnapshot();
    node.x = x;
    node.y = y;
    this.setLiveNodePosition(node.id, x, y);
  }

  setLiveNodePosition(nodeId: string, x: number, y: number): void {
    this.liveNodePositions = { ...this.liveNodePositions, [nodeId]: { x, y } };
  }

  liveNodeY(nodeId: string): number | undefined {
    return this.liveNodePositions[nodeId]?.y;
  }

  removeNode(node: GraphNode): void {
    if (this.isViewer) return; // read-only viewer (S2): authoring no-op
    const g = this.selectedGraph;
    if (!g || isAnchorNode(node)) return;
    this.pushUndoSnapshot();
    g.nodes = g.nodes.filter((n) => n.id !== node.id);
    g.edges = g.edges.filter((e) => e.from !== node.id && e.to !== node.id);
    if (this.settingsBlock?.id === node.id) this.settingsBlock = null;
    if (this.galleryBlock?.id === node.id) this.galleryBlock = null;
    if (this.envTarget?.block.id === node.id) this.envTarget = null;
  }

  /** Wire a node's output to another's input (rejects dup / cycle / bad direction).
      `fromPort` is the source handle the wire leaves (a value+bands switch's `band-${i}`);
      undefined = the node's default single output. `toPort` is the target input handle:
      `'mod'` routes a modifier-chain wire into a play/modifier node's `mod` input, undefined
      the trigger-flow `in`. Validation is total — never throws (bad wires are ignored).

      Returns the rejection reason (`direction` / `duplicate` / `cycle`) when the wire was
      refused, else `null` on success — so the caller can surface *why* (a reason toast, R03).
      A viewer / missing-graph no-op returns `null` (nothing the user did wrong to explain). */
  connect(fromId: string, toId: string, fromPort?: string, toPort?: ToPort): WireRejection | null {
    if (this.isViewer) return null; // read-only viewer (S2): authoring no-op
    const g = this.selectedGraph;
    if (!g) return null;
    const rejection = classifyConnection(g, fromId, toId, fromPort, toPort);
    if (rejection) return rejection;
    this.pushUndoSnapshot();
    // store CANONICAL ports (''/'in' aliases collapse to undefined) so a persisted edge can
    // never dodge the dedup guard under a differently-spelled duplicate later
    const edge: GraphEdge = {
      id: nid('e'),
      from: fromId,
      to: toId,
      fromPort: normalizeFromPort(fromPort),
      toPort: normalizeToPort(toPort),
    };
    // A modulation wire (`param:<key>`) IS one mapping — bake its default settings from the
    // target param spec (amount 1, no invert, range = spec min/max) so it is editable + persists.
    const key = voice.paramKeyOf(toPort);
    if (key !== null) {
      const to = g.nodes.find((n) => n.id === toId);
      const spec = to ? this.modTargetSpecs(to).find((s) => s.key === key) : undefined;
      edge.amount = 1;
      edge.invert = false;
      edge.rangeMin = spec?.min ?? 0;
      edge.rangeMax = spec?.max ?? 1;
    }
    g.edges.push(edge);
    return null;
  }
  disconnect(edgeId: string): void {
    if (this.isViewer) return; // read-only viewer (S2): authoring no-op
    const g = this.selectedGraph;
    if (!g || !g.edges.some((e) => e.id === edgeId)) return;
    this.pushUndoSnapshot();
    g.edges = g.edges.filter((e) => e.id !== edgeId);
  }
  /** Re-point an existing edge to a new source/target (an edge-end drag). Validates
      exactly as connect() does — but ignoring the edge being moved — and leaves the
      wire untouched if the move would be a dup / wrong-direction / cycle, so a bad
      reconnect drag snaps back instead of deleting the wire. Returns the rejection reason
      when the move was refused, else `null` on success (see {@link connect}). */
  reconnect(
    edgeId: string,
    fromId: string,
    toId: string,
    fromPort?: string,
    toPort?: ToPort,
  ): WireRejection | null {
    if (this.isViewer) return null; // read-only viewer (S2): authoring no-op
    const g = this.selectedGraph;
    if (!g) return null;
    const rejection = classifyReconnect(g, edgeId, fromId, toId, fromPort, toPort);
    if (rejection) return rejection;
    this.pushUndoSnapshot();
    const edge = g.edges.find((e) => e.id === edgeId)!;
    edge.from = fromId;
    edge.to = toId;
    edge.fromPort = normalizeFromPort(fromPort);
    edge.toPort = normalizeToPort(toPort);
    return null;
  }

  /** Would dropping node `nodeId` onto flow edge `edgeId` splice it in? Read-only mirror of
      {@link spliceOnDrop}'s guard (R08), so the view can ARM the wire during a drag (pre-release
      indication) knowing release will actually splice. No side effects. */
  canSplice(edgeId: string, nodeId: string): boolean {
    const g = this.selectedGraph;
    return !!g && !this.isViewer && canSplice(g, edgeId, nodeId);
  }

  /** Splice dropped node `nodeId` into flow edge `edgeId` (R08): remove the edge and re-wire
      `source →(source-port) node → target (target-port)`, preserving the source band/output port
      and the target's input port so routing is unchanged but for the inserted node. Recorded as
      its OWN undo checkpoint — the caller commits the drag position FIRST (a separate checkpoint),
      so one Ctrl/Z pops the splice wiring while the node stays where it was dropped. The remove +
      two connects fold into this single checkpoint (batched) so undo reverts the whole splice at
      once. No-op (returns false) when the splice is invalid; announces a successful splice with one
      toast. */
  spliceOnDrop(edgeId: string, nodeId: string): boolean {
    if (this.isViewer) return false;
    const g = this.selectedGraph;
    if (!g || !canSplice(g, edgeId, nodeId)) return false;
    const edge = g.edges.find((e) => e.id === edgeId)!;
    const { from, to, fromPort, toPort } = edge;
    this.pushUndoSnapshot();
    this.batchIntoCurrentUndo(() => {
      g.edges = g.edges.filter((e) => e.id !== edgeId);
      this.connect(from, nodeId, fromPort ?? undefined, undefined);
      this.connect(nodeId, to, undefined, toPort);
    });
    pushToast('Node spliced into the wire.', { tone: 'info' });
    return true;
  }

  setMixEdgeOpacity(edgeId: string, opacity: number): void {
    this.editEdge(edgeId, (e) => (e.opacity = Math.max(0, Math.min(1, opacity))));
  }

  setMixBlendMode(node: GraphNode, mode: BlendMode): void {
    if (this.isViewer || node.kind !== 'mix') return;
    this.pushUndoSnapshot();
    node.mixBlendMode = mode;
  }

    /** Change a node's kind, seeding kind-specific defaults and pruning invalid wires. */
  changeKind(node: GraphNode, kind: NodeKind): void {
    if (this.isViewer) return; // read-only viewer (S2): authoring no-op
    if (isAnchorNode(node) || kind === 'trigger' || kind === 'output') return;
    if (node.kind === kind) return;

    this.pushUndoSnapshot();

    const g = this.selectedGraph;
    node.kind = kind;

    if (kind === 'play' || kind === 'effect') {
      if (!node.effectId) {
        const init = graphsLib.playNodeInit(this.effects, (id) => this.presetById(id));
        node.effectId = init.effectId;
        node.scope = init.scope;
        node.presetId = init.presetId;
        node.params = init.params;
      }
      if (g) g.edges = g.edges.filter((e) => e.from !== node.id);
    } else if (kind === 'modifier') {
      // Seed a modifier id if the node has none yet. A modifier takes no trigger-flow input,
      // so drop any flow wire that landed on it (mod wires — `toPort:'mod'` — are kept).
      if (!node.modifierId) {
        const init = graphsLib.modifierNodeInit();
        node.modifierId = init.modifierId;
        node.params = init.params;
      }
      if (g) g.edges = g.edges.filter((e) => !(e.to === node.id && e.toPort !== 'mod'));
    } else if (kind === 'envelope') {
      Object.assign(node, envelopeNodeDefaults('pluck'));
      if (g) pruneEdgesForModSource(g, node.id);
    } else if (kind === 'lfo') {
      node.lfo = voice.defaultLfoSettings();
      if (g) pruneEdgesForModSource(g, node.id);
    } else if (kind === 'cc') {
      node.ccController = 1;
      node.ccChannel = null;
      node.ccSource = 'midi';
      if (g) pruneEdgesForModSource(g, node.id);
    } else if (kind === 'note') {
      node.noteNumber = 60;
      node.noteChannel = null;
      node.noteMode = 'gate';
      node.noteReleaseMs = 0;
      if (g) pruneEdgesForModSource(g, node.id);
    } else if (kind === 'osc') {
      node.oscAddress = '';
      if (g) pruneEdgesForModSource(g, node.id);
    } else if (kind === 'randomMod') {
      node.randomDistribution = 'linear';
      node.randomSteps = 4;
      if (g) pruneEdgesForModSource(g, node.id);
    }
  }

  /** Drum info for the current kit, used by the Inspector's scope-target dropdowns. */
  get kitDrumInfos(): { id: string; label: string; hoopCount: number }[] {
    return this.labModel.pm.drums.map((d) => ({ id: d.drumId, label: d.label, hoopCount: d.hoopCount }));
  }

  setMode(node: GraphNode, mode: PlayMode): void {
    if (this.isViewer) return; // read-only viewer (S2): authoring no-op
    if ((node.kind !== 'play' && node.kind !== 'effect') || node.mode === mode) return;
    this.pushUndoSnapshot();
    node.mode = mode;
  }

  /** Set the render scope on a play node (kit / drum / hoop). Clearing targetId on
      scope change prevents a stale targetId from a previous scope from leaking. */
  setScope(node: GraphNode, scope: Scope): void {
    if (this.isViewer) return; // read-only viewer (S2): authoring no-op
    if (node.kind !== 'play' && node.kind !== 'effect' && node.kind !== 'scope' && node.kind !== 'output') return;
    this.pushUndoSnapshot();
    node.scope = scope;
    node.targetId = undefined;
  }

  /** Set (or clear) the per-play-node target id: drum = drumId, hoop = "drumId#hoopIndex".
      Pass undefined or empty string to clear (auto = firing/source drum). */
  setTargetId(node: GraphNode, targetId: string | undefined): void {
    if (this.isViewer) return; // read-only viewer (S2): authoring no-op
    if (node.kind !== 'play' && node.kind !== 'effect' && node.kind !== 'scope' && node.kind !== 'output') return;
    this.pushUndoSnapshot();
    node.targetId = targetId || undefined;
  }
  setNoRepeat(node: GraphNode, v: boolean): void {
    if (this.isViewer) return; // read-only viewer (S2): authoring no-op
    if (node.kind !== 'random' || node.noRepeat === v) return;
    this.pushUndoSnapshot();
    node.noRepeat = v;
  }
  setChance(node: GraphNode, p: number): void {
    if (this.isViewer) return; // read-only viewer (S2): authoring no-op
    if (node.kind !== 'chance' || node.p === p) return;
    this.pushUndoSnapshot();
    node.p = p;
  }
  setSwitchOn(node: GraphNode, on: SwitchOn): void {
    if (this.isViewer) return; // read-only viewer (S2): authoring no-op
    if (node.kind !== 'switch') return;
    this.pushUndoSnapshot();
    node.on = on;
    // backfill value-mode fields the first time a node becomes a value switch (a graph
    // persisted before value-mode lacks them); leaving value collapses band wires.
    if (on === 'value') this.ensureValueDefaults(node);
    else this.stripBandPorts(node);
  }

  // --- value switch (gate + bands) -----------------------------------------

  /** Backfill value-switch fields for a node that lacks them (older persisted graph). */
  private ensureValueDefaults(node: GraphNode): void {
    const d = vsw.valueDefaults(node);
    node.valueMode = d.valueMode;
    node.threshold = d.threshold;
    node.invert = d.invert;
    node.bands = d.bands;
  }

  /** Drop per-band source ports from a node's outgoing edges, collapsing them to the
      default output — so leaving bands mode never strands a wire on a handle the node
      no longer renders (which xyflow can't draw). */
  private stripBandPorts(node: GraphNode): void {
    const g = this.selectedGraph;
    if (!g) return;
    g.edges = vsw.stripBandPorts(g.edges, node.id);
  }

  setValueMode(node: GraphNode, mode: ValueMode): void {
    if (this.isViewer) return; // read-only viewer (S2): authoring no-op
    if (node.kind !== 'switch' || node.on !== 'value') return;
    this.pushUndoSnapshot();
    node.valueMode = mode;
    // gate has a single output; collapse any band wires so they fire as default children.
    if (mode === 'gate') this.stripBandPorts(node);
  }
  setThreshold(node: GraphNode, threshold: number): void {
    if (this.isViewer) return; // read-only viewer (S2): authoring no-op
    if (node.kind !== 'switch' || node.on !== 'value') return;
    this.pushUndoSnapshot();
    node.threshold = vsw.clamp01(threshold);
  }
  setInvert(node: GraphNode, invert: boolean): void {
    if (this.isViewer) return; // read-only viewer (S2): authoring no-op
    if (node.kind !== 'switch' || node.on !== 'value') return;
    this.pushUndoSnapshot();
    node.invert = invert;
  }

  // --- delay node mutators -------------------------------------------------

  /** Switch a delay node between absolute-time (`'time'`) and musical-division
      (`'beats'`) modes. Guards `node.kind === 'delay'`. */
  setDelayMode(node: GraphNode, mode: 'time' | 'beats'): void {
    if (this.isViewer) return; // read-only viewer (S2): authoring no-op
    if (node.kind !== 'delay') return;
    this.pushUndoSnapshot();
    node.delayMode = mode;
  }

  /** Set the absolute delay time in milliseconds. Guards `node.kind === 'delay'`. */
  setDelayMs(node: GraphNode, ms: number): void {
    if (this.isViewer) return; // read-only viewer (S2): authoring no-op
    if (node.kind !== 'delay') return;
    this.pushUndoSnapshot();
    node.ms = Math.max(0, ms);
  }

  /** Set the musical division string (e.g. `'1/8'`, `'dotted-1/4'`). Guards
      `node.kind === 'delay'`. */
  setDivision(node: GraphNode, division: string): void {
    if (this.isViewer) return; // read-only viewer (S2): authoring no-op
    if (node.kind !== 'delay') return;
    this.pushUndoSnapshot();
    node.division = division;
  }

  /** Append a band by splitting the final "rest" band (a new cutoff between the last
      cutoff and 1). Appending never disturbs existing band ports. */
  addBand(node: GraphNode): void {
    if (this.isViewer) return; // read-only viewer (S2): authoring no-op
    if (node.kind !== 'switch' || node.on !== 'value') return;
    this.pushUndoSnapshot();
    node.bands = vsw.addBand(node.bands);
  }
  /** Remove cutoff `cutoffIndex` (merging band cutoffIndex+1 down into it), keeping at
      least one cutoff (≥2 bands). Remaps the outgoing band ports to match. */
  removeBand(node: GraphNode, cutoffIndex: number): void {
    if (this.isViewer) return; // read-only viewer (S2): authoring no-op
    if (node.kind !== 'switch' || node.on !== 'value') return;
    if (!vsw.canRemoveBand(node.bands, cutoffIndex)) return;
    this.pushUndoSnapshot();
    node.bands = vsw.removeBandAt(node.bands, cutoffIndex);
    this.remapBandPorts(node, cutoffIndex);
  }
  /** Set cutoff `cutoffIndex`, clamped WITHIN its neighbours so cutoffs stay ascending
      without reordering — reordering would scramble which band each port maps to. */
  setBandCutoff(node: GraphNode, cutoffIndex: number, value: number): void {
    if (this.isViewer) return; // read-only viewer (S2): authoring no-op
    if (node.kind !== 'switch' || node.on !== 'value') return;
    const bands = node.bands ?? [0.5];
    if (cutoffIndex < 0 || cutoffIndex >= bands.length) return;
    this.pushUndoSnapshot();
    node.bands = vsw.setBandCutoff(bands, cutoffIndex, value);
  }
  /** After cutoff `removed` is dropped, band (removed+1) merges into `removed` and every
      higher band shifts down one — remap edge ports to match, then drop any duplicate
      (target, port) wires the merge collided. */
  private remapBandPorts(node: GraphNode, removed: number): void {
    const g = this.selectedGraph;
    if (!g) return;
    g.edges = vsw.remapBandPorts(g.edges, node.id, removed);
  }

  // --- effect / preset / params / envelopes --------------------------------

  openGallery(node: GraphNode): void {
    if (isEffectNode(node)) this.galleryBlock = node;
  }
  closeGallery(): void {
    this.galleryBlock = null;
  }
  openSettings(node: GraphNode): void {
    if (isEffectNode(node)) this.settingsBlock = node;
  }
  closeSettings(): void {
    this.settingsBlock = null;
  }
  openEnv(node: GraphNode, key: string): void {
    this.envTarget = { block: node, key };
  }
  closeEnv(): void {
    this.envTarget = null;
  }

  // --- effect / preset object CRUD (the Objects view consumes these) --------
  // Effects are foundational: rename + duplicate ONLY, never delete. Presets add delete,
  // gated to usage-count 0 (and never a live effect's `:default`). Each keeps the sim's
  // registries in sync so the live preview reflects the edit, and persists via the authored
  // autosave (effects/presets are part of the snapshot). The pure builders + gating live in
  // the objects slice; the sim-registry sync stays here.

  /** Rename an effect (its display name) — the only edit effects allow. No-op on an unknown id
      or a blank name (keeps the old name, mirrors {@link renameSong}). Replaces the EffectDef
      IMMUTABLY (a built-in's seed array shares the module fixture objects by reference, so an
      in-place mutation would corrupt the global registry), then re-points the sim's id-map at
      the new object so the live preview reflects it. Persists via the authored autosave
      ({@link unionEffects} keeps a built-in's renamed name on reload). */
  renameEffect(id: string, name: string): void {
    if (this.isViewer) return; // read-only viewer (S2): authoring no-op
    const trimmed = name.trim();
    if (!trimmed) return;
    const cur = this.effects.find((e) => e.id === id);
    if (!cur) return;
    const renamed: EffectDef = { ...cur, name: trimmed };
    this.effects = this.effects.map((e) => (e.id === id ? renamed : e));
    this.sim.registerEffect(renamed);
  }

  /** Duplicate an effect: clone its definition under a fresh id named "<name> copy", register
      it with the sim, and seed its `${newId}:default` preset. This is the ONLY effect-authoring
      path now (the pattern-authoring EffectCreator was retired with the pattern engine in U3).
      Returns the new id, or null for an unknown id. The clone is independent (its own id +
      Default preset); a generator-backed effect keeps its `generatorId` so it renders
      identically. Persists via the authored autosave. */
  duplicateEffect(id: string): string | null {
    if (this.isViewer) return null; // read-only viewer (S2): authoring no-op
    const src = this.effects.find((e) => e.id === id);
    if (!src) return null;
    const name = `${src.name} copy`;
    const newId = objects.freshEffectId(this.effects, name);
    const eff = objects.cloneEffect($state.snapshot(src) as EffectDef, newId, name);
    this.effects.push(eff);
    this.sim.registerEffect(eff);
    const preset = objects.defaultPresetFor(eff);
    this.presets.push(preset);
    this.sim.registerPreset(preset);
    return newId;
  }

  /** Rename a preset. No-op on an unknown id or a blank name (mirrors {@link renameSong}).
      Replaces the Preset IMMUTABLY (re-added built-in presets share the module fixture by
      reference) and re-points the sim's id-map. Persists via the autosave ({@link unionPresets}
      keeps a renamed built-in preset on reload). */
  renamePreset(id: string, name: string): void {
    if (this.isViewer) return; // read-only viewer (S2): authoring no-op
    const trimmed = name.trim();
    if (!trimmed) return;
    const cur = this.presetById(id);
    if (!cur) return;
    const renamed: Preset = { ...cur, name: trimmed };
    this.presets = this.presets.map((p) => (p.id === id ? renamed : p));
    this.sim.registerPreset(renamed);
  }

  /** Duplicate a preset: clone it under a fresh id named "<name> copy" (same effect, an
      independent copy of its params), and register it with the sim. Returns the new id, or
      null for an unknown id. Persists via the authored autosave. */
  duplicatePreset(id: string): string | null {
    if (this.isViewer) return null; // read-only viewer (S2): authoring no-op
    const src = this.presetById(id);
    if (!src) return null;
    const newId = freshId('preset', (k) => this.presets.some((p) => p.id === k)); // global uniqueness (survives reload)
    const preset = objects.clonePreset(src, newId);
    this.presets.push(preset);
    this.sim.registerPreset(preset);
    return newId;
  }

  /** How many play nodes — across EVERY graph (pad + authored) — carry this preset as their
      `presetId` provenance (they forked their own params from it; presets are snapshots now, so
      no node depends on it at runtime — S39). Advisory: shown in the Objects view and still gates
      {@link deletePreset}. */
  presetUsageCount(id: string): number {
    return objects.presetUsageCount(this.graphs, id);
  }

  /** Delete a preset — ONLY when it is used nowhere ({@link presetUsageCount} === 0) and it is
      not a live effect's foundational `:default` (an effect's seeded baseline is never
      deletable while the effect exists). Removes it from `presets` + the sim registry and
      returns true; returns false (a no-op) when the id is unknown, the preset is in use, or it
      is a live effect's `:default`. Persists via the authored autosave. */
  deletePreset(id: string): boolean {
    if (this.isViewer) return false; // read-only viewer (S2): authoring no-op
    const pr = this.presetById(id);
    const usage = pr ? objects.presetUsageCount(this.graphs, id) : 0;
    if (!objects.canDeletePreset(pr, usage, this.effects)) return false;
    this.presets = this.presets.filter((p) => p.id !== id);
    this.sim.unregisterPreset(id);
    return true;
  }

  /** Swap the effect: reset to that effect's Default preset (own instance). Cross-category
      swaps are allowed; the node's playType follows the selected effect so the gallery is a
      full-library browser rather than a type-locked picker. */
  pickEffect(node: GraphNode, effectId: string): void {
    if (this.isViewer) return; // read-only viewer (S2): authoring no-op
    if (!isEffectNode(node)) return;
    const eff = this.selectableEffects.find((e) => e.id === effectId);
    if (!eff) return;

    const nodeType = eff.playType ?? 'ambient';

    if (nodeType === 'canvas') {
      this.setCanvasScene(node, effectId.slice('canvas:'.length));
      return;
    }

    const pr = this.presetById(`${effectId}:default`);
    this.pushUndoSnapshot();
    node.effectId = effectId;
    node.playType = nodeType;
    node.canvasScene = undefined;
    node.scope = eff.scope;
    node.presetId = `${effectId}:default`;
    node.busId = ''; // follow the new effect's default layer
    node.params = { ...(pr?.params ?? defaultParams(eff)) };
    node.env = {};
  }

  // --- canvas scenes (U5) --------------------------------------------------

  /** Create a new authored canvas scene, returning its id. */
  createCanvasScene(name?: string): string {
    if (this.isViewer) return '';
    const id = freshId('scene', (candidate) => this.canvasScenes.some((scene) => scene.id === candidate));
    const scene = canvasScenesLib.makeCanvasScene(id, name?.trim() || `Canvas scene ${this.canvasScenes.length + 1}`);
    this.canvasScenes = [...this.canvasScenes, scene];
    return id;
  }

  renameCanvasScene(id: string, name: string): void {
    if (this.isViewer) return;
    const trimmed = name.trim();
    if (!trimmed) return;
    this.canvasScenes = this.canvasScenes.map((scene) => (scene.id === id ? { ...scene, name: trimmed } : scene));
  }

  /** Duplicate an authored OR built-in scene into a fresh authored scene — duplicating a
      built-in is how users customise the read-only core library. */
  duplicateCanvasScene(id: string): string | null {
    if (this.isViewer) return null;
    const src = this.allCanvasScenes.find((scene) => scene.id === id);
    if (!src) return null;
    const nextId = freshId('scene', (candidate) => this.allCanvasScenes.some((scene) => scene.id === candidate));
    const snapshot = this.canvasScenes.some((scene) => scene.id === id) ? $state.snapshot(src) : src;
    const clone: CanvasScene = structuredClone({ ...snapshot, id: nextId, name: `${src.name} copy` });
    this.canvasScenes = [...this.canvasScenes, clone];
    return nextId;
  }

  /** Delete a scene: retarget/clear referencing nodes onto a fallback scene (first remaining,
      or none), and drop any saved presets for the deleted virtual effect. */
  deleteCanvasScene(id: string): boolean {
    if (this.isViewer) return false;
    const exists = this.canvasScenes.some((scene) => scene.id === id);
    if (!exists) return false;
    const remaining = this.canvasScenes.filter((scene) => scene.id !== id);
    // Prefer the first remaining authored scene, else fall back to the built-in library
    // (which always exists), so referencing nodes never go sceneless.
    const fallback = remaining[0] ?? BUILTIN_CANVAS_SCENES.find((scene) => scene.id !== id) ?? null;
    this.canvasScenes = remaining;
    this.graphs = canvasScenesLib.retargetSceneRefs(this.graphs, id, fallback);
    const deletedEffectId = canvasEffectId(id);
    this.presets = this.presets.filter((preset) => preset.effectId !== deletedEffectId);
    return true;
  }

  /** The scene's JSON (empty string when unknown) for the Objects-view editor — built-ins
      are viewable (read-only) too. */
  canvasSceneJson(id: string): string {
    const authored = this.canvasScenes.find((s) => s.id === id);
    if (authored) return canvasScenesLib.formatCanvasScene($state.snapshot(authored));
    const builtin = BUILTIN_CANVAS_SCENES.find((s) => s.id === id);
    return builtin ? canvasScenesLib.formatCanvasScene(builtin) : '';
  }

  /** Apply edited scene JSON. Returns a typed result so the editor can show inline errors. */
  updateCanvasSceneJson(id: string, text: string): { ok: true } | { ok: false; message: string } {
    if (this.isViewer) return { ok: false, message: 'This show is read-only.' };
    const parsed = canvasScenesLib.parseCanvasSceneJson(id, text);
    if (!parsed.ok) return { ok: false, message: parsed.message };
    this.canvasScenes = this.canvasScenes.map((scene) => (scene.id === id ? parsed.scene : scene));
    return { ok: true };
  }

  /** Point a canvas play node at a scene, seeding its default preset params. */
  setCanvasScene(node: GraphNode, sceneId: string): void {
    if (this.isViewer || !isEffectNode(node)) return;
    const scene = this.allCanvasScenes.find((s) => s.id === sceneId);
    if (!scene) return;
    const eff = canvasScenesLib.canvasEffectDef(scene);
    const preset = this.presetById(`${eff.id}:default`) ?? canvasScenesLib.canvasDefaultPreset(scene);
    this.pushUndoSnapshot();
    node.playType = 'canvas';
    node.canvasScene = scene.id;
    node.effectId = eff.id;
    node.scope = eff.scope;
    node.presetId = preset.id;
    node.busId = '';
    node.params = { ...preset.params };
    node.env = {};
  }

  /** Add a typed play node (D3). Canvas seeds/selects a scene; other types seed a matching
      effect. Returns the created node (or null for viewers / no graph). */
  addPlayNode(playType: PlayType, x: number, y: number): GraphNode | null {
    if (this.isViewer) return null;
    const g = this.selectedGraph;
    if (!g) return null;

    this.pushUndoSnapshot();
    let node: GraphNode;
    if (playType === 'canvas') {
      // Built-ins always exist, so a new canvas node starts on the first library scene.
      const sceneId = this.allCanvasScenes[0]?.id ?? this.createCanvasScene('New canvas scene');
      const scene = this.allCanvasScenes.find((s) => s.id === sceneId);
      if (!scene) return null;
      const eff = canvasScenesLib.canvasEffectDef(scene);
      const preset = this.presetById(`${eff.id}:default`) ?? canvasScenesLib.canvasDefaultPreset(scene);
      node = makeNode('effect', nid('n'), x, y, {
        playType: 'canvas',
        canvasScene: scene.id,
        effectId: eff.id,
        presetId: preset.id,
        scope: eff.scope,
        params: { ...preset.params },
      });
    } else {
      const eff =
        this.selectableEffects.find((e) => !e.deprecated && e.playType === playType) ??
        this.selectableEffects.find((e) => !e.deprecated);
      if (!eff) return null;
      const preset = this.presetById(`${eff.id}:default`);
      node = makeNode('effect', nid('n'), x, y, {
        playType,
        effectId: eff.id,
        presetId: `${eff.id}:default`,
        scope: eff.scope,
        params: { ...(preset?.params ?? defaultParams(eff)) },
      });
    }

    g.nodes.push(node);
    return node;
  }

  /** Route a play node to a layer/bus ('' → the effect's default). */
  setBus(node: GraphNode, busId: string): void {
    if (this.isViewer) return; // read-only viewer (S2): authoring no-op
    if (!isEffectNode(node) || node.busId === busId) return;
    this.pushUndoSnapshot();
    node.busId = busId;
  }
  /** The effective layer for a play node (its override, or the effect's default). */
  busOf(node: GraphNode): string {
    if (!isEffectNode(node)) return '';
    return node.busId || this.effectOf(node)?.busId || '';
  }

  /** Select a preset for this play node and APPLY it — points `presetId` at the preset (kept as
      a provenance label) and forks a private copy of its params onto the node. A preset is a
      snapshot, never a live binding (S39): later param edits stay node-local. No-op off a play
      node or for an unknown preset. */
  selectPreset(node: GraphNode, presetId: string): void {
    if (this.isViewer) return; // read-only viewer (S2): authoring no-op
    if (!isEffectNode(node)) return;
    const pr = this.presetById(presetId);
    if (!pr) return;
    this.pushUndoSnapshot();
    node.presetId = presetId;
    node.params = { ...pr.params };
  }

  /** Re-apply the node's CURRENT preset — copy its params onto the node, discarding local edits
      (the explicit "Apply" action; {@link selectPreset} already applies when the choice changes).
      No-op when the node's `presetId` resolves to nothing. */
  applyPreset(node: GraphNode): void {
    if (this.isViewer) return; // read-only viewer (S2): authoring no-op
    if (!isEffectNode(node)) return;
    const pr = this.presetById(node.presetId);
    if (!pr) return;
    node.params = { ...pr.params };
  }

  /** Snapshot this play node's current params as a NEW preset for its effect, register it, and
      point the node's `presetId` at it (provenance). `name` defaults to "<Effect> preset".
      Returns the new preset id, or null off a play node / unknown effect. Persists via the
      authored autosave. */
  saveNodeAsPreset(node: GraphNode, name?: string): string | null {
    if (this.isViewer) return null; // read-only viewer (S2): authoring no-op
    if (!isEffectNode(node)) return null;
    const eff = this.effectOf(node);
    if (!eff) return null;
    const newId = freshId('preset', (k) => this.presets.some((p) => p.id === k)); // global uniqueness (survives reload)
    const label = name?.trim() || `${eff.name} preset`;
    const preset: Preset = { id: newId, name: label, effectId: eff.id, params: { ...node.params } };
    this.presets.push(preset);
    this.sim.registerPreset(preset);
    node.presetId = newId;
    return newId;
  }

  /** Author a param value onto a play or modifier node — always node-local now that presets are
      snapshots (S39: no linked write-through to a shared preset). */
  setParam(node: GraphNode, key: string, value: ParamValue): void {
    if (this.isViewer) return; // read-only viewer (S2): authoring no-op
    if (!nodeHasParams(node)) return;
    this.pushUndoSnapshot();
    node.params = { ...node.params, [key]: value };
  }

  /** Set the modifier a modifier node applies (its `modifierId`), seeding the new
      modifier's default params so its inspector controls resolve. No-op off a modifier. */
  setModifierId(node: GraphNode, modifierId: string): void {
    if (this.isViewer) return; // read-only viewer (S2): authoring no-op
    if (node.kind !== 'modifier' || node.modifierId === modifierId) return;
    this.pushUndoSnapshot();
    node.modifierId = modifierId;
    node.params = graphsLib.modifierParamsFor(modifierId);
    node.env = {};
  }
  /** Toggle a modifier node's bypass (identity when true; the chain keeps its state slot). */
  setModifierBypass(node: GraphNode, bypass: boolean): void {
    if (this.isViewer) return; // read-only viewer (S2): authoring no-op
    if (node.kind !== 'modifier') return;
    this.pushUndoSnapshot();
    node.bypass = bypass;
  }

  getEnvelope(node: GraphNode, key: string): Envelope | null {
    return nodeHasParams(node) ? node.env[key] ?? null : null;
  }
  envKind(node: GraphNode, key: string): EnvKind {
    return nodeHasParams(node) ? node.env[key]?.kind ?? 'none' : 'none';
  }
  isEnveloped(node: GraphNode, key: string): boolean {
    return nodeHasParams(node) && !!node.env[key] && node.env[key]!.kind !== 'none';
  }
  /** Set or clear the envelope on a param (seeds a preset curve; 'none' removes it). */
  setEnvKind(node: GraphNode, key: string, kind: EnvKind): void {
    if (this.isViewer) return; // read-only viewer (S2): authoring no-op
    if (!nodeHasParams(node)) return;
    this.pushUndoSnapshot();
    if (kind === 'none') delete node.env[key];
    else node.env[key] = defaultEnvelope(kind);
  }
  setEnvAmount(node: GraphNode, key: string, amount: number): void {
    if (this.isViewer) return; // read-only viewer (S2): authoring no-op
    if (!nodeHasParams(node)) return;
    const e = node.env[key];
    if (e) {
      this.pushUndoSnapshot();
      e.amount = amount;
    }
  }
  /** Replace the curve breakpoints (marks the envelope as hand-edited / custom). */
  setEnvPoints(node: GraphNode, key: string, points: EnvPoint[]): void {
    if (this.isViewer) return; // read-only viewer (S2): authoring no-op
    if (!nodeHasParams(node)) return;
    const e = node.env[key];
    if (!e) return;
    this.pushUndoSnapshot();
    e.points = points;
    e.kind = 'custom';
  }
  /** Set the ADSR shape on a param's envelope (regenerates the render curve). */
  setEnvAdsr(node: GraphNode, key: string, adsr: AdsrShape): void {
    if (this.isViewer) return; // read-only viewer (S2): authoring no-op
    if (!nodeHasParams(node)) return;
    this.pushUndoSnapshot();
    let e = node.env[key];
    if (!e) {
      e = { kind: 'custom', amount: 1, points: [] };
      node.env[key] = e;
    }
    e.adsr = { ...adsr };
    e.points = adsrToPoints(adsr);
    e.kind = 'custom';
  }

  // --- modulation graph layer (doc 10, S34) --------------------------------

  /** The numeric params a target node can expose as modulation targets, normalized to
      `{ key, label, min, max }` — effect params for play nodes, modifier params for modifier
      nodes (which use the core `type` spec field). Non-number params are excluded. */
  modTargetSpecs(node: GraphNode): { key: string; label: string; min?: number; max?: number }[] {
    if (isEffectNode(node)) {
      const eff = this.effectOf(node);
      return (eff?.params ?? [])
        .filter((s) => s.kind === 'number')
        .map((s) => ({ key: s.key, label: s.label, min: s.min, max: s.max }));
    }
    if (node.kind === 'modifier') {
      const def = listModifiers().find((m) => m.id === node.modifierId);
      return (def?.paramSpec ?? [])
        .filter((s) => s.type === 'number')
        .map((s) => ({ key: s.key, label: s.label, min: s.min, max: s.max }));
    }
    return [];
  }

  /** The ordered exposed modulation-target rows on a node. */
  modInputsOf(node: GraphNode): { param: string }[] {
    return node.modInputs ?? [];
  }

  /** Numeric params not yet exposed — the "Add parameter" picker options. */
  availableModParams(node: GraphNode): { key: string; label: string }[] {
    const exposed = new Set((node.modInputs ?? []).map((m) => m.param));
    return this.modTargetSpecs(node)
      .filter((s) => !exposed.has(s.key))
      .map((s) => ({ key: s.key, label: s.label }));
  }

  /** Expose a param as a modulation target (adds a node-face row + input handle). Idempotent. */
  addModInput(node: GraphNode, param: string): void {
    if (this.isViewer) return; // read-only viewer (S2): authoring no-op
    if (!isEffectNode(node) && node.kind !== 'modifier') return;
    if (!node.modInputs) node.modInputs = [];
    if (node.modInputs.some((m) => m.param === param)) return;
    this.pushUndoSnapshot();
    node.modInputs.push({ param });
  }

  /** Un-expose a param AND delete its incoming modulation wires (the caller confirms first). */
  removeModInput(node: GraphNode, param: string): void {
    if (this.isViewer) return; // read-only viewer (S2): authoring no-op
    this.pushUndoSnapshot();
    node.modInputs = (node.modInputs ?? []).filter((m) => m.param !== param);
    const g = this.selectedGraph;
    if (g) g.edges = g.edges.filter((e) => !(e.to === node.id && e.toPort === `param:${param}`));
  }

  /** The incoming mapping edges for a node's exposed param — one per wire, each editable. */
  mappingsFor(node: GraphNode, param: string): GraphEdge[] {
    const g = this.selectedGraph;
    if (!g) return [];
    return g.edges.filter((e) => e.to === node.id && e.toPort === `param:${param}`);
  }

  /** The resolved modulation SOURCES wired into an exposed param row, each with its edge's
      `invert` — drives the S38 node-face live tick (`paramRowSignal`). Dangling / non-source
      wires are skipped (never thrown), mirroring `resolveNodeModulations`. */
  modSourcesFor(node: GraphNode, param: string): { source: voice.ModSource; invert: boolean }[] {
    const g = this.selectedGraph;
    if (!g) return [];
    const out: { source: voice.ModSource; invert: boolean }[] = [];
    for (const e of g.edges) {
      if (e.to !== node.id || e.toPort !== `param:${param}`) continue;
      const src = g.nodes.find((n) => n.id === e.from);
      if (!src) continue;
      const source = voice.nodeModSource(src);
      if (!source) continue;
      out.push({ source, invert: e.invert === true });
    }
    return out;
  }

  /** A `cc` source node's current live 0..1 level, read from the sim's CC table — or, when the
      node is in OSC mode, from the sim's OSC table at its address. Drives the node-face value bar
      + readout (S38); the branch keeps the preview honest for both live inputs. */
  ccNodeLiveValue(node: GraphNode): number {
    if (node?.kind !== 'cc') return 0;
    return voice.sampleCc(this.sim.ccTable, node.ccController ?? 1, node.ccChannel ?? null);
  }

  oscNodeLiveValue(node: GraphNode): number {
    return node?.kind === 'osc' ? voice.sampleOsc(this.sim.oscTable, node.oscAddress ?? '') : 0;
  }

  noteNodeLiveValue(node: GraphNode): number {
    return node?.kind === 'note'
      ? voice.sampleNote(this.sim.noteTable, node.noteNumber ?? 60, node.noteChannel ?? null, node.noteMode ?? 'gate', node.noteReleaseMs ?? 0, this.sim.timeMs)
      : 0;
  }

  /** The live CC value table (sim mirror) — the S38 param-row tick reads it for `cc` sources. */
  get liveCcTable(): voice.CcTable {
    return this.sim.ccTable;
  }

  /** The live OSC value table (sim mirror) — the S38 param-row tick reads it for `osc` sources. */
  get liveOscTable(): voice.OscTable {
    return this.sim.oscTable;
  }

  private editEdge(edgeId: string, mut: (e: GraphEdge) => void): void {
    if (this.isViewer) return; // read-only viewer (S2): authoring no-op
    const edge = this.selectedGraph?.edges.find((e) => e.id === edgeId);
    if (edge) mut(edge);
  }
  /** Per-mapping depth 0..1 (edited target-side, under the param row). */
  setMappingAmount(edgeId: string, amount: number): void {
    this.editEdge(edgeId, (e) => (e.amount = amount));
  }
  /** Per-mapping invert (flips the source before scaling into the range). */
  setMappingInvert(edgeId: string, invert: boolean): void {
    this.editEdge(edgeId, (e) => (e.invert = invert));
  }
  /** Per-mapping output range the source maps into (clamped to the param spec at render). */
  setMappingRange(edgeId: string, min: number, max: number): void {
    this.editEdge(edgeId, (e) => {
      e.rangeMin = min;
      e.rangeMax = max;
    });
  }

  // --- envelope SOURCE node shape (the S24 editor drives this via the node inspector) -------

  /** The envelope source node's ADSR shape (stored in the well-known slot). */
  envelopeNodeAdsr(node: GraphNode): AdsrShape {
    return (node?.kind === 'envelope' ? node.env[voice.ENVELOPE_NODE_KEY]?.adsr : undefined) ?? defaultAdsr();
  }
  /** The envelope source node's full envelope (shape + render points), or null. */
  envelopeNodeEnvelope(node: GraphNode): Envelope | null {
    return node?.kind === 'envelope' ? node.env[voice.ENVELOPE_NODE_KEY] ?? null : null;
  }
  /** Set the envelope source node's shape (regenerates its render curve; single source). */
  setEnvelopeNodeAdsr(node: GraphNode, adsr: AdsrShape): void {
    if (this.isViewer) return; // read-only viewer (S2): authoring no-op
    if (node.kind !== 'envelope') return;
    let e = node.env[voice.ENVELOPE_NODE_KEY];
    if (!e) {
      e = { kind: 'custom', amount: 1, points: [] };
      node.env[voice.ENVELOPE_NODE_KEY] = e;
    }
    e.adsr = { ...adsr };
    e.points = adsrToPoints(adsr);
    e.kind = 'custom';
  }

  // --- LFO SOURCE node settings (doc 10, S36) — edited via the LFO node inspector ----------

  /** The LFO source node's settings (defaults when unset). */
  lfoSettings(node: GraphNode): voice.LfoSettings {
    return (node?.kind === 'lfo' ? node.lfo : undefined) ?? voice.defaultLfoSettings();
  }
  /** Patch the LFO source node's settings (seeds defaults first so partial edits are safe). */
  setLfo(node: GraphNode, patch: Partial<voice.LfoSettings>): void {
    if (this.isViewer) return; // read-only viewer (S2): authoring no-op
    if (node.kind !== 'lfo') return;
    node.lfo = { ...(node.lfo ?? voice.defaultLfoSettings()), ...patch };
  }

  // --- CC SOURCE node settings (S37) ---------------------------------------
  // The node's controller number + channel filter drive an engine CC-table read at sample
  // time. MIDI-learn reuses the shared learn flow (see startMidiLearn + applyCcLearn).

  /** The CC source node's controller number (default 1). */
  ccNodeController(node: GraphNode): number {
    return node?.kind === 'cc' ? node.ccController ?? 1 : 1;
  }
  /** The CC source node's channel filter (1..16), or null for omni (any channel). */
  ccNodeChannel(node: GraphNode): number | null {
    return node?.kind === 'cc' ? node.ccChannel ?? null : null;
  }

  /** Whether a controller number is bindable — rejects the reserved section-recall CC 0 and
      anything outside the MIDI range (1..127). Drives the inspector's validation. */
  isBindableCcController(controller: number): boolean {
    return Number.isFinite(controller) && controller >= 1 && controller <= 127;
  }

  /** Set the CC node's controller. Controller 0 is reserved for section recall and REJECTED
      (validation, not a throw); an out-of-range value is likewise ignored, leaving the prior
      binding untouched. Valid range 1..127. */
  setCcController(node: GraphNode, controller: number): void {
    if (this.isViewer) return; // read-only viewer (S2): authoring no-op
    if (node.kind !== 'cc') return;
    if (!this.isBindableCcController(controller)) return; // 0 reserved + out-of-range rejected
    node.ccController = Math.round(controller);
  }

  /** Set the CC node's channel filter (1..16), or null for omni (any channel). Out-of-range
      numeric channels are ignored (the prior filter stays). */
  setCcChannel(node: GraphNode, channel: number | null): void {
    if (this.isViewer) return; // read-only viewer (S2): authoring no-op
    if (node.kind !== 'cc') return;
    if (channel === null) {
      node.ccChannel = null;
      return;
    }
    if (!Number.isFinite(channel) || channel < 1 || channel > 16) return;
    node.ccChannel = Math.round(channel);
  }

  // --- OSC modulation input (the cc source node's alternate live input) ------
  // A cc node reads MIDI CC by default; switched to OSC it reads a live 0..1 value at an OSC
  // address instead (nodeModSource maps it to an `osc` ModSource). Both are "controller" inputs.

  /** The cc node's live input mode: 'midi' (Control Change) or 'osc' (address). Default 'midi'. */
  ccNodeSource(node: GraphNode): 'midi' | 'osc' {
    return node?.kind === 'cc' ? node.ccSource ?? 'midi' : 'midi';
  }
  /** Switch the cc node between MIDI CC and OSC as its live input. */
  setCcNodeSource(node: GraphNode, source: 'midi' | 'osc'): void {
    if (this.isViewer) return; // read-only viewer (S2): authoring no-op
    if (node.kind !== 'cc') return;
    node.ccSource = source;
  }
  /** The cc node's OSC address (read when in OSC mode); '' until one is set. */
  oscNodeAddress(node: GraphNode): string {
    return node?.kind === 'osc' ? node.oscAddress ?? '' : '';
  }
  /** Set the cc node's OSC address (trimmed). Empty is allowed (⇒ neutral until set). */
  setOscNodeAddress(node: GraphNode, address: string): void {
    if (this.isViewer) return; // read-only viewer (S2): authoring no-op
    if (node.kind !== 'osc') return;
    node.oscAddress = address.trim();
  }

  noteNodeNumber(node: GraphNode): number {
    return node?.kind === 'note' ? node.noteNumber ?? 60 : 60;
  }
  noteNodeChannel(node: GraphNode): number | null {
    return node?.kind === 'note' ? node.noteChannel ?? null : null;
  }
  noteNodeMode(node: GraphNode): voice.NoteModMode {
    return node?.kind === 'note' ? node.noteMode ?? 'gate' : 'gate';
  }
  noteNodeReleaseMs(node: GraphNode): number {
    return node?.kind === 'note' ? node.noteReleaseMs ?? 0 : 0;
  }
  setNoteNodeNumber(node: GraphNode, note: number): void {
    if (this.isViewer || node.kind !== 'note' || !Number.isFinite(note)) return;
    node.noteNumber = Math.max(0, Math.min(127, Math.round(note)));
  }
  setNoteNodeChannel(node: GraphNode, channel: number | null): void {
    if (this.isViewer || node.kind !== 'note') return;
    if (channel === null) node.noteChannel = null;
    else if (Number.isFinite(channel) && channel >= 1 && channel <= 16) node.noteChannel = Math.round(channel);
  }
  setNoteNodeMode(node: GraphNode, mode: voice.NoteModMode): void {
    if (this.isViewer || node.kind !== 'note') return;
    node.noteMode = mode;
  }
  setNoteNodeReleaseMs(node: GraphNode, releaseMs: number): void {
    if (this.isViewer || node.kind !== 'note' || !Number.isFinite(releaseMs)) return;
    node.noteReleaseMs = Math.max(0, Math.round(releaseMs));
  }

  randomDistribution(node: GraphNode): voice.RandomDistribution {
    return node?.kind === 'randomMod' ? node.randomDistribution ?? 'linear' : 'linear';
  }
  setRandomDistribution(node: GraphNode, distribution: voice.RandomDistribution): void {
    if (this.isViewer || node.kind !== 'randomMod') return;
    node.randomDistribution = distribution;
  }
  randomSteps(node: GraphNode): number {
    return node?.kind === 'randomMod' ? node.randomSteps ?? 4 : 4;
  }
  setRandomSteps(node: GraphNode, steps: number): void {
    if (this.isViewer || node.kind !== 'randomMod' || !Number.isFinite(steps)) return;
    node.randomSteps = Math.max(2, Math.min(64, Math.round(steps)));
  }
}
