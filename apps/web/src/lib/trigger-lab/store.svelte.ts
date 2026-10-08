/* Reactive bridge over the offline Sim. Owns the editable authored document as runes, drives the
   Sim from a rAF loop, and snapshots transient voice/log state each frame. See ./NOTES.md.

   THIN WRAPPER (S3.2): the domain logic lives in pure slices under `store/` (ids · shows ·
   show-library-sync · song-library-sync · effect-song-library · input-mappings · canvas-scenes ·
   trigger-routing · transport) + the existing pure modules (persistence · save-status · setlist ·
   show-builder · clipdoc · effects-files). This class holds the runes + sim/client lifecycle and
   delegates each domain to its slice — mirroring setlist.ts / shell-nav.ts.

   EFFECT CHAINS (S05): the authored document is the v3 show library. Sections carry `effects` /
   `master`; the store implements {@link EffectsAuthoringApi} by delegating to
   {@link EffectsController} (pure ops in `effects-doc.ts`) — except `canEdit`, which stays
   viewer-only for app callers, so Effects UI mounts take `store.effectsApi` (the controller, with
   the mutators' canEdit) instead of the store itself. The runtime Show is core `buildRuntimeShow`
   (via `buildEffectsShow`), sent to the server and loaded into the offline Sim's core engine. */

import { Sim, type LogEntry } from './sim';
import { DRUMS, PADS, type Pad } from './fixtures';
import { buildLabModel } from './kit';
import * as clipdoc from './clipdoc';
import { renderFrame as compositeFrame } from './render';
import { WSClient, type ConnectionState, type InputEcho } from '../ws/client';
import { TRACK_INPUT_LIMIT, trackInputIdSchema, type TrackInputsStatus } from '@ledrums/protocol';
import { type MidiClockEvent, type MidiDeviceInfo, type MidiEvent } from '../midi/webmidi';
import type { BackupSnapshotMeta, ClientMessage, ControllerStatus, ControllerTestPattern, DiscoveredController, MidiClockStatus, MonitorEvent, NetworkAdapter, OscListenInfo, OutputStatus, SerializedModel, TunnelInfo, VoiceStat } from '../ws/protocol-types';
import { LocalMidiClock, parseClockInputValue, readStoredClockDevice, resolveClockStatus, shouldForwardClock, writeStoredClockDevice } from './store/midi-clock';
import type { ClockInput, TransportSource } from '@ledrums/core';
import { appendVelocityHit, type VelocityHits } from '../app/velocity-hits';
import type { CurveHit } from '../ui/curve-field';
import { selectDockVoices, type DockVoice } from './dock-voices';
import { smoothBusLevels, smoothDockVoices, smoothingAlpha } from './dock-smoothing';
import { packetsPerSecond, type PacketSample } from '../app/docks/inspectors/output-status';
// The zone-map writers are pure helpers; the store reuses them so an OSC learn writes the
// SAME shape the zones editor does (one mutation path, mutation parity), not a second one.
import { setZoneOscAddress, zoneSlotsForDrum, zoneLabel } from '../app/docks/patch-inspector';
import type {
  CanvasScene,
  GlobalControlAction,
  GlobalControlBinding,
  GlobalControls,
  InputMap,
  NodeLayout,
  OutputConfig,
  Project,
} from '@ledrums/core';
import { applyDrumVelocity, BUILTIN_CANVAS_SCENES, buildPixelModel, defaultProject, effectChain, globalControlForNote, withGlobalControlBinding } from '@ledrums/core';
import type { KitConfig } from '@ledrums/core';
import { voice } from '@ledrums/core';
import * as canvasScenesLib from './store/canvas-scenes';
import { projectResyncMessages } from './store/project-resync';
import { buildEffectsShow, type EffectsShowSource } from './show-builder';
import { compareRecallIdentity, type AuthoritativeRecall, type RecallIdentity } from './recall-order';
import * as setlist from '../app/setlist';
import type { SetlistSection, Song } from '../app/setlist';
import { installErrorCapture } from '../app/error-capture';
import {
  serializeShowLibraryV3,
  serializeSongLibraryV2,
  type AuthoredStateV3,
  type ShowV3,
  type SongLibraryV2,
} from './persistence';
import { seedAuthoredV3 } from './seed-effects';
import { EffectsController, type EffectsControllerHost } from './effects-controller.svelte';
import {
  MASTER_CELL,
  type ApplyResult,
  type DeviceSelection,
  type SelectionVerb,
  type CellSelection,
  type CellSummary,
  type EffectsAuthoringApi,
  type GridColumn,
  type GridRow,
} from './effects-api';
import type { ChainOwner, EffectsSection } from './effects-doc';
import type { BindResult, MapModeApi, MapTarget } from './map-api';
import * as inputMappings from './store/input-mappings';
import * as effectsFiles from './effects-files';
import { detectLegacyLibrary, pendingLegacyShowNames, type LegacyLibrary } from './legacy-import';
import { extractEffectSong, toEffectSong, toStoreSong } from './store/effect-song-library';
import { SaveStatusController, type SaveStatus } from './save-status';
import { ControllerMonitor } from './controller-monitor.svelte';
import { ControllerTest } from './controller-test.svelte';
import { MidiController, type MidiLearnTarget } from './midi-controller.svelte';
import { AudioController } from './audio-controller.svelte';
import type { AudioCaptureErrorCode, AudioCaptureStatus, AudioInputInfo } from '../audio/capture';
import type { AudioAnalysisSettings } from '../audio/analysis';
import { OscLearnController, type OscLearnTarget } from './osc-learn.svelte';
import {
  ShowsController,
  browserStorage,
  writeStoredLibrary,
  writeStoredSongLibrary,
  type ShowsControllerHost,
} from './shows-controller.svelte';
import { SectionsController, type SectionClipboard, type SectionsControllerHost } from './sections-controller.svelte';
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
import { freshId, reserveIds } from './store/ids';
import { seedDocumentV3 } from './store/seed';
import { idsFromSongLibraryV2 } from './store/reserve-library-ids';
import * as routing from './store/trigger-routing';
import {
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
import { openTextFile, saveTextFile, type OpenOutcome, type SaveOutcome } from './file-io';
import { pushToast } from '../ui/toast.svelte';
import { bindingRejectionMessage } from '../app/binding-claim-label';
import { EngineLinkSync } from './store/transport';
import { trackDocument } from './store/track-document';
import { DocumentHistory } from './store/document-history';
import {
  DEFAULT_MONITOR_FILTERS,
  appendMonitorEvent,
  filterMonitorEvents,
  type MonitorFilterType,
} from '../app/monitor';


/** How long after the last authored change we wait before writing to storage. */
const SAVE_DEBOUNCE_MS = 300;
/** How often the offline Layers dock re-reads the Sim's Effect-path voices (it allocates). */
const EFFECT_STATS_INTERVAL_MS = 100;
// Defensive per-device echo ceiling from the wire vocabulary: channel × note/gate/CC, bands,
// and eight macros. The registry's held-note limit is tighter; ordinary OSC is not capped here.
const TRACK_OSC_KEY_LIMIT = 16 * 128 * 3 + voice.AUDIO_BANDS.length + 8;

/** One shared empty buffer, so a drum with no hits yet reads a stable identity. */
const EMPTY_HITS: readonly CurveHit[] = [];


/** Re-exported from the extracted MIDI controller (R21) so `MidiLearnTarget` stays importable from
    the store — the inspectors that arm a learn keep their import path unchanged. */
export type { MidiLearnTarget };
/** The Effect-chain authoring contract this store implements (effect chains S05). */
export type { EffectsAuthoringApi } from './effects-api';
/** The MIDI-map authoring contract the store implements (effect chains S07, wave 5b). */
export type { MapModeApi } from './map-api';

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
export type PasteContext = 'section' | 'song';
/** Where a pasted song lands: the active show's setlist, or the shared Song Library pool. */
export type SongPasteDest = 'show' | 'library';

/** The typed outcome of {@link TriggerLab.materializePaste} — the caller toasts `message`. */
export type PasteResult =
  | { ok: true; kind: PasteContext; message: string }
  | { ok: false; message: string };

/** What a new show starts from (the New show dialog). Both start one song with one empty section:
    the grid already lays out a column for every declared zone. */
export type ShowTemplate = 'blank' | 'zones';

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
    counter BEFORE it enters the show: the fresh section / song ids come off the counter already,
    but the Effect ids and device uids travel verbatim, so a cross-machine paste can bring a high
    id the local counter is below — a later mint would then re-mint it. */
function* remapResultIds(res: RemapResult): Iterable<string> {
  const sections = res.section ? [res.section] : res.song?.sections ?? [];
  if (res.song) yield res.song.id;
  for (const section of sections) {
    yield section.id;
    for (const effect of section.effects) {
      yield effect.id;
      for (const modifier of effect.modifiers) yield modifier.uid;
      for (const control of effect.controls) yield control.uid;
    }
    for (const modifier of section.master) yield modifier.uid;
  }
  for (const scene of res.canvasScenes) yield scene.id;
}

/** The Effect id of a server `effect-fired` Monitor line (see voice-engine-host), or null. */
function serverFiredEffectId(event: { type?: string; source?: string; destination?: string }): string | null {
  if (event.type !== 'effect' || event.source !== 'server/voice') return null;
  return event.destination?.startsWith('effect:') ? event.destination.slice('effect:'.length) || null : null;
}

/** The success message for a materialized authored paste. */
function pasteSuccessMessage(res: RemapResult): string {
  return res.kind === 'section' ? 'Pasted section.' : 'Pasted song.';
}

/** One undo checkpoint: the authored show slice plus a separate snapshot of the authoritative
    project slice (routing/geometry/IO), which is server-owned and NOT part of the authored
    state. Keeping both in one stack entry preserves ordering across mixed trigger/patch edits. */
interface UndoEntry {
  authored: AuthoredStateV3;
  project: Project | null;
}

const EMPTY_EFFECTS: readonly effectChain.Effect[] = [];
const EMPTY_MASTER: readonly effectChain.ModifierDevice[] = [];
const READ_ONLY: ApplyResult = { ok: false, reason: 'This section is read-only.' };
/** Offline stand-in for the server Project's kit / input map (the grid needs rows + zones). */
const OFFLINE_PROJECT = defaultProject();

/** Per-bus meter levels from a voice list: the summed voice levels, capped at 1. */
function busLevelsOf(voices: readonly VoiceStat[]): Record<string, number> {
  const levels: Record<string, number> = {};
  for (const v of voices) levels[v.busId] = Math.min(1, (levels[v.busId] ?? 0) + v.level);
  return levels;
}

/** How many Effects a runtime Show carries (the Monitor's `setShow` line). */
function countShowEffects(show: voice.Show): number {
  let n = 0;
  for (const song of show.songs ?? []) for (const section of song.sections) n += section.effects?.length ?? 0;
  return n;
}

function nowMs(): number {
  return typeof performance !== 'undefined' ? performance.now() : Date.now();
}

/** A new show from a template (effect chains): one song holding one empty section. */
function blankAuthoredV3(): AuthoredStateV3 {
  const song = toEffectSong(setlist.makeSong('song-1', 'Song 1', [setlist.makeSection('song-1-s1', 'Section 1')]));
  return {
    ...seedAuthoredV3(),
    songs: [song],
    selectedCell: null,
    selectedEffectId: null,
    activeSongId: song.id,
    activeSectionId: song.sections[0]?.id ?? null,
  };
}

/** A per-browser flag: the old-library import prompt was dismissed. A NEW key — the old library
    keys are never written. Best-effort (private mode / SSR read as not dismissed). */
const LEGACY_IMPORT_DISMISSED_KEY = 'ledrums:legacy-import:dismissed';
function readLegacyDismissed(): boolean {
  try {
    return browserStorage()?.getItem(LEGACY_IMPORT_DISMISSED_KEY) === '1';
  } catch {
    return false;
  }
}
function writeLegacyDismissed(): void {
  try {
    browserStorage()?.setItem(LEGACY_IMPORT_DISMISSED_KEY, '1');
  } catch {
    // best-effort
  }
}

export class TriggerLab implements EffectsAuthoringApi, MapModeApi {
  /** The kit's playable drum zones (the Perform surface's pads). */
  pads = $state<Pad[]>(structuredClone(PADS));
  /** User-authored canvas scene documents (U5), persisted in the show doc; a Scene Generator plays
      one by id (see `allCanvasScenes`). */
  canvasScenes = $state<CanvasScene[]>([]);

  bpm = $state(120);
  velocity = $state(0.85);
  /** transport — playing gates the sim clock; beatsPerBar drives the readout. */
  playing = $state(true);
  beatsPerBar = $state(4);

  // --- setlist (songs → sections → Effect stacks) ------------------------------
  // `songs` / `songRefs` / `activeSongId` are owned by {@link showsCtl} (R23) — see the
  // delegators alongside its field. The section-arrangement concern (the active-section
  // pointer, the clipboard, the activeSection derived, and section CRUD) is owned by
  // {@link sectionsCtl} (R24, store split 5/5) — the store delegates its public surface
  // to this via the accessors + forwarders below, so callers/tests are unchanged.
  private readonly sectionsCtl = new SectionsController({
    isViewer: () => this.isViewer,
    activeSongById: () => this.activeSongById,
    activeSongId: () => this.activeSongId,
    songs: () => this.songs,
    isLocalSong: (songId) => this.songs.some((song) => song.id === songId),
    setSongs: (songs) => (this.songs = songs),
    recordUndo: () => this.pushUndoSnapshot(),
    activeSectionChanged: () => this.followActiveSection(),
  } satisfies SectionsControllerHost);


  // --- section-arrangement state delegators (R24) — owned by sectionsCtl ------------------------
  /** The ONE active section (U4 merged the old look-recall + arrange focus): the section you're
      playing IS the one you're editing. Drives hit-resolution (its Effects fire, in the play
      surface below), the recall, and the Sections / Effects views' highlight. */
  get activeSectionId(): string | null {
    return this.sectionsCtl.activeSectionId;
  }
  set activeSectionId(id: string | null) {
    const activeSong = this.activeSongById;
    this.sectionsCtl.activeSectionId =
      id !== null && !activeSong?.sections.some((section) => section.id === id) ? null : id;
  }
  /** Section copy/paste scratch — a deep copy of the last-copied section, or null when empty.
      Transient (NOT persisted): a fresh session starts empty. `pasteSection` clones it. */
  get sectionClipboard(): SectionClipboard | null {
    return this.sectionsCtl.sectionClipboard;
  }
  set sectionClipboard(v: SectionClipboard | null) {
    this.sectionsCtl.sectionClipboard = v;
  }

  // --- clipboard paste dialogs (S44) ---------------------------------------------
  /** Open when the Songs paste flow is active — the dialog picks a destination (this show vs the
      Song Library) and offers a manual-paste textarea when the browser blocks clipboard reads. */
  songPasteOpen = $state(false);
  /** Document revision, not show id: same-id server replacements invalidate pending clipboard IO. */
  private documentGeneration = 0;
  /** Non-null when a section paste hit a blocked clipboard read: drives the manual paste-text
      fallback dialog, remembering which context the pasted text should materialize into. */
  pasteFallback = $state<{ context: 'section' } | null>(null);

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
  log = $state<LogEntry[]>([]);
  timeMs = $state(0);
  beat = $state(0);
  busLevels = $state<Record<string, number>>({});
  /** Per-voice detail streamed from the server engine's stats (S17) — the authoritative voice list
      while the engine link is open (the Sim stops firing when connected).
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
      swap machinery, the section-arrangement boundary (R24), and the WS link through the injected
      host. */
  private readonly showsCtl = new ShowsController({
    canvasScenes: () => this.canvasScenes,
    mergeCanvasScenes: (scenes) => this.unionCanvasScenes(scenes),
    recordUndo: () => this.pushUndoSnapshot(),
    toAuthored: () => this.toAuthored(),
    replaceDocument: (show, source) => this.replaceDocument(show, source),
    saveNow: () => {
      this.saveStatusCtl.saving();
      this.flushSave();
    },
    setActiveSectionId: (id) => {
      this.activeSectionId = id;
      // Section ids are only unique within a song, so a song switch can land on an id equal to
      // the outgoing one — which the change-only accessor hook would not see.
      this.followActiveSection();
    },
    reconcileActiveSection: () => this.sectionsCtl.reconcileActiveSection(),
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
  /** authored arrangement: songs, each with sections that hold an Effect stack + Master chain. */
  get songs(): Song[] {
    return this.showsCtl.songs;
  }
  set songs(v: Song[]) {
    this.showsCtl.songs = v;
    this.sectionsCtl.reconcileActiveSection();
  }
  /** Library-song references (S41): ids into {@link songLibrary} the active show resolves in. */
  get songRefs(): string[] {
    return this.showsCtl.songRefs;
  }
  set songRefs(v: string[]) {
    this.showsCtl.setSongRefs(v);
  }
  /** which song the Sections view + Songs rail show. */
  get activeSongId(): string {
    return this.showsCtl.activeSongId;
  }
  set activeSongId(id: string) {
    this.showsCtl.activeSongId = id;
    this.sectionsCtl.reconcileActiveSection();
  }
  /** The canonical song pool shows reference (S40) — a second server-authoritative library. */
  get songLibrary(): SongLibraryV2 {
    return this.showsCtl.songLibrary;
  }
  set songLibrary(v: SongLibraryV2) {
    this.showsCtl.songLibrary = v;
  }
  /** The show list for the browser UI — `{ id, name }` in insertion order. */
  get shows(): { id: string; name: string }[] {
    return this.showsCtl.shows;
  }
  /** The active show (id + name + its cached authored). null only before construction completes. */
  get activeShow(): ShowV3 | null {
    return this.showsCtl.activeShow;
  }
  /** The active song over the RESOLVED song list (local + referenced) — falls back to the first. */
  get activeSong(): Song | null {
    return this.showsCtl.activeSong;
  }
  /** The exact active song in the resolved setlist; unlike `activeSong`, never falls back. */
  get activeSongById(): Song | null {
    return this.showsCtl.activeSongById;
  }
  /** The exact active song in the local authored setlist, or null for a library reference/stale id. */
  get activeLocalSong(): Song | null {
    return this.showsCtl.activeLocalSong;
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
  /** Create a show and switch to it. With a `template`, it starts one song with one EMPTY section
      (both templates: the grid already lays out every declared zone, so `zones` needs no per-zone
      content); without one, from the demo seed. */
  newShow(name?: string, template?: ShowTemplate): string {
    return this.showsCtl.newShow(name, template ? blankAuthoredV3() : undefined);
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

  /** Whether a relative move has a destination in the resolved, ordered setlist. */
  canStepSetlist(axis: voice.NavAxis, delta: number): boolean {
    return this.setlistNavTarget(axis, delta) !== null;
  }

  /** Resolve a relative move through the same pure core rule used by the engine. */
  setlistNavTarget(axis: voice.NavAxis, delta: number): voice.NavTarget | null {
    return voice.relativeNavTarget(
      { songs: this.resolvedSongs },
      { activeSongId: this.activeSongId || null, activeSectionId: this.activeSectionId },
      axis,
      delta,
    );
  }

  /** Navigate without an edit-permission gate. The server/engine remains authoritative when
      connected; the local setters provide the immediate view transition. */
  stepSetlist(axis: voice.NavAxis, delta: number): boolean {
    const target = this.setlistNavTarget(axis, delta);
    if (!target) return false;
    if (axis === 'song') this.setActiveSong(target.songId);
    else this.setActiveSection(target.sectionId);
    return true;
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
  /** Server-authoritative recall ordering. A pending item is not acknowledged until its canonical
      song/section can be resolved against the reconciled client library. */
  private recallSessionId: string | null = null;
  private appliedRecall: RecallIdentity | null = null;
  private pendingRecall: AuthoritativeRecall | null = null;
  /** Local project backups (#123), newest-first — the server's reply to `listBackups`, rendered by
      the Backups dialog. Populated on demand via {@link refreshBackups}; empty until then. Public +
      settable like {@link presence}/{@link controllerStatus} so the dev shot-seam can seed it. */
  backups = $state<BackupSnapshotMeta[]>([]);
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

  /** OSC listen surface (#139) from the server's `state` message: the host:port a third-party
      sender (Sensory Percussion, an Ableton/Max device) must be configured with, plus whether the
      UDP socket actually bound. null until the first `state` lands. */
  oscListen = $state<OscListenInfo | null>(null);
  /** The most recent OSC packet heard on ANY address, for the "is anything arriving?" badge on
      the listen surface. Distinct from {@link inputActivity}, which is keyed per address so a
      binding's badge only tracks its own traffic — here the question is whether the transport
      itself is carrying anything at all. */
  lastOscHeard = $state<InputActivity | null>(null);

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
  /** Offline voices for the Layers dock, refreshed at telemetry rate (the Sim engine's `stats()`
      allocates, so never per frame). The same `VoiceStat` wire shape the server streams. */
  effectVoices = $state.raw<VoiceStat[]>([]);
  /** Voice list for the Layers dock (S17): the server's streamed voices while the engine link is
      open (its render is authoritative — the Sim no longer fires when connected), the Sim engine's
      voices offline. Pure source-selection lives in {@link selectDockVoices}. Gated on `link` (the
      firing/authority gate), not `useServer` (the stricter visualiser-frame gate): the dock owns no
      pixels, so it can adopt server voices the instant the link opens without waiting for a frame. */
  dockVoices = $derived<DockVoice[]>(
    selectDockVoices({ connected: this.link === 'open', simVoices: this.effectVoices, serverVoices: this.serverVoices }),
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
      ignored). View-only interactions (selecting/panning/switching, playing pads) stay enabled.
      NOTE: this field stays viewer-only for its app callers; it is NOT the Effects contract's
      canEdit ("the Effect mutators apply", also false on a referenced library song or with no
      active section). Effects UI mount sites pass {@link effectsApi} (whose canEdit is the
      mutators' rule) in place of casting the store. Pinned in store.song-library.test.ts. */
  canEdit = $derived(!this.isViewer);
  /** Whether the active song is authored by this show. Referenced library songs are resolved for
      playback/navigation but their sections are canonical and read-only until detached. */
  activeSongIsLocal = $derived(this.songs.some((song) => song.id === this.activeSongId));
  canEditActiveSong = $derived(this.canEdit && this.activeSongIsLocal);
  activeSongEditBlockReason = $derived(
    this.isViewer
      ? 'Another client is editing'
      : this.activeSongIsLocal
        ? null
        : 'Library song is read-only — detach a copy in Objects to edit it',
  );

  /** Stable local-song membership guard for controllers and view identity checks. */
  isLocalSong(songId: string): boolean {
    return this.songs.some((song) => song.id === songId);
  }
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
  /** Uninstall for the global web-error capture (observability #122), installed in {@link start}
      and torn down in {@link stop}. Null while not running. */
  private errorCaptureUninstall: (() => void) | null = null;
  /** MIDI input + MIDI-learn (R6/S37) — the WebMIDI device layer + learn-arm machinery, extracted
      into {@link MidiController} (R21). The store keeps `forwardMidi`/`receiveInputEcho` (entangled
      with the offline sim + S04 badges) and delegates the rest via the accessors + forwarders below,
      so callers/tests are unchanged. */
  private readonly midi = new MidiController({
    isViewer: () => this.isViewer,
    getInputMap: () => this.project?.inputMap ?? null,
    setInputMap: (inputMap) => this.setInputMap(inputMap),
    setGlobalControlBinding: (action, patch) => this.setGlobalControlBinding(action, patch),
    setCueMidiSource: (effectId, source) => this.setCueSource(effectId, source),
    setCellResetFromLearn: (cell, reset) => this.setCellResetFromLearn(cell, reset),
    bindMapSource: (target, source) => this.bindFromMapLearn(target, source),
  });
  /** OSC learn — bind the next heard address (Settings → Global controls). A separate arm
      from {@link midi}'s so a control's MIDI and OSC Learn buttons don't disarm each other. */
  private readonly osc = new OscLearnController({
    isViewer: () => this.isViewer,
    setGlobalControlBinding: (action, patch) => this.setGlobalControlBinding(action, patch),
    setZoneOscAddress: (drumId, slot, address) => {
      if (this.isViewer || !this.project) return false;
      this.setInputMap(setZoneOscAddress(this.project.inputMap, drumId, slot, address));
      return true;
    },
    setCueOscAddress: (effectId, address) => this.setCueSource(effectId, { oscAddress: address }),
    setCellResetFromLearn: (cell, reset) => this.setCellResetFromLearn(cell, reset),
    bindMapOscAddress: (target, address) => this.bindFromMapLearn(target, { oscAddress: address }),
  });
  /** Audio input capture (GH #214): lifecycle, meter and local preferences live on the
      controller; frames come back through {@link forwardAudio}. */
  private readonly audio = new AudioController({
    isViewer: () => this.isViewer,
    onFrame: (frame) => this.forwardAudio(frame),
  });
  /** The armed MIDI-learn target, or null when nothing is waiting to bind. See
      {@link MidiController.learnTarget}. */
  get midiLearnTarget(): MidiLearnTarget | null {
    return this.midi.learnTarget;
  }
  /** The armed OSC-learn target, or null when nothing is waiting to bind. */
  get oscLearnTarget(): OscLearnTarget | null {
    return this.osc.target;
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

  // --- MIDI clock (external transport sync) ---------------------------------
  /** Timing source, from the server project's transport (server-authoritative, like the MIDI
      channel filter): `manual` (default) or `midiClock`. */
  timingSource = $derived<TransportSource>(this.project?.composition.transport.source ?? 'manual');
  /** Which route the server accepts the clock from: the desktop app's native port, or this
      browser's selected WebMIDI port. */
  clockInput = $derived<ClockInput>(this.project?.composition.transport.clockInput ?? 'native');
  /** The WebMIDI port that owns the clock in `browser` mode — machine-local (localStorage), never
      part of the show, because a port id means nothing on another machine. */
  clockDeviceId = $state<string | null>(readStoredClockDevice());
  /** The server's clock truth from the throttled stats stream (null until the first tick). */
  private serverClock = $state<MidiClockStatus | null>(null);
  /** The offline preview's own clock: the same core reducer, fed from the selected port. */
  private readonly localClock = new LocalMidiClock(120);
  /** Mirror of the local reducer's state, so `clockStatus` re-derives on each offline advance. */
  private localClockState = $state.raw(this.localClock.state);
  /** What the settings panel shows: server truth while connected, the local reducer when this
      browser reads a port offline, and never "synced" when neither can confirm it. */
  clockStatus = $derived<MidiClockStatus>(
    resolveClockStatus(this.link === 'open', this.serverClock, this.localClockState, {
      source: this.timingSource,
      clockInput: this.clockInput,
      manualBpm: this.bpm,
    }),
  );

  // Named track status is transient server truth, not authored show content.
  trackInputs = $state<TrackInputsStatus | null>(null);
  private trackInputSessionId: string | null = null;
  /** Only explicit echo metadata owns keys — a regular OSC /tracks/... address is ordinary
      OSC. Empty sets are removed, and both dimensions are bounded even between snapshots. */
  private readonly trackOscKeys = new Map<string, Set<string>>();

  private forgetTrackOscOwnership(address: string): void {
    for (const [id, keys] of this.trackOscKeys) {
      if (!keys.delete(address)) continue;
      if (keys.size === 0) this.trackOscKeys.delete(id);
      return;
    }
  }

  private clearOscMirror(address: string): void {
    this.inputActivity.delete(activityKey({ kind: 'osc', address }));
    if (this.lastOscHeard?.address === address) this.lastOscHeard = null;
  }

  private clearTrackOscKey(id: string, address: string): void {
    const keys = this.trackOscKeys.get(id);
    if (!keys?.delete(address)) return;
    this.clearOscMirror(address);
    if (keys.size === 0) this.trackOscKeys.delete(id);
  }

  private clearTrackOscInput(id: string): void {
    const keys = this.trackOscKeys.get(id);
    if (keys) for (const address of keys) this.clearTrackOscKey(id, address);
  }

  private ownTrackOscKey(id: string, address: string): void {
    if (this.trackOscKeys.get(id)?.has(address)) return;
    this.forgetTrackOscOwnership(address);
    let keys = this.trackOscKeys.get(id);
    if (!keys) {
      // Echoes can precede their low-rate registry snapshot. Retire the oldest mirror rather
      // than retaining unbounded IDs if cleanup/status packets have not arrived yet.
      if (this.trackOscKeys.size >= TRACK_INPUT_LIMIT) {
        const oldest = this.trackOscKeys.keys().next().value;
        if (oldest !== undefined) this.clearTrackOscInput(oldest);
      }
      keys = new Set();
      this.trackOscKeys.set(id, keys);
    }
    if (keys.size >= TRACK_OSC_KEY_LIMIT) {
      const oldest = keys.values().next().value;
      if (oldest !== undefined) this.clearTrackOscKey(id, oldest);
    }
    keys.add(address);
  }

  private clearTrackInputs(): void {
    for (const id of this.trackOscKeys.keys()) this.clearTrackOscInput(id);
    this.trackInputs = null;
    this.trackInputSessionId = null;
    if (this.project?.inputMap.trackAudioInput) this.sim.setAudio(voice.ZERO_AUDIO_FRAME);
  }

  setTrackAudioInput(id: string | undefined): void {
    if (!this.project || !this.canEdit || (id !== undefined && !trackInputIdSchema.safeParse(id).success)) return;
    const { trackAudioInput: previous, ...inputMap } = this.project.inputMap;
    if (previous === id) return;
    this.setInputMap(id === undefined ? inputMap : { ...inputMap, trackAudioInput: id });
    this.sim.setAudio(voice.ZERO_AUDIO_FRAME);
    if (id !== undefined) this.audio.stop();
  }

  // --- audio input (GH #214) -----------------------------------------------
  get audioStatus(): AudioCaptureStatus {
    return this.audio.status;
  }
  get audioError(): AudioCaptureErrorCode | undefined {
    return this.audio.error;
  }
  get audioMessage(): string | undefined {
    return this.audio.message;
  }
  get audioTrackLabel(): string | undefined {
    return this.audio.trackLabel;
  }
  get audioSampleRate(): number | undefined {
    return this.audio.sampleRate;
  }
  /** Latest analysed frame for the settings meters (zero when not capturing). */
  get audioMeter(): voice.AudioFeatureFrame {
    return this.audio.meter;
  }
  get audioDevices(): AudioInputInfo[] {
    return this.audio.devices;
  }
  get audioDeviceId(): string | null {
    return this.audio.deviceId;
  }
  get audioSettings(): AudioAnalysisSettings {
    return this.audio.settings;
  }
  get audioSupported(): boolean {
    return this.audio.supported;
  }
  get audioUnsupportedReason(): string | undefined {
    return this.audio.unsupportedReason;
  }
  get audioRunning(): boolean {
    return this.audio.running;
  }
  /** Explicit user start — the only path that ever opens an input. Viewers are refused. */
  startAudio(): Promise<void> {
    if (this.project?.inputMap.trackAudioInput) return Promise.resolve();
    return this.audio.start();
  }
  stopAudio(): void {
    this.audio.stop();
  }
  setAudioDevice(id: string | null): void {
    this.audio.setDevice(id);
  }
  setAudioSettings(patch: Partial<AudioAnalysisSettings>): void {
    this.audio.setSettings(patch);
  }
  refreshAudioDevices(): Promise<void> {
    return this.audio.refreshDevices();
  }
  /** DEV screenshot seam: stage a meter state without capture (see `shot-seam.ts`). */
  previewAudioMeter(status: AudioCaptureStatus, meter: voice.AudioFeatureFrame, error?: AudioCaptureErrorCode): void {
    if (!import.meta.env.DEV) return;
    this.audio.previewSynthetic(status, meter, error);
  }
  /** One analysed frame → the offline sim's audio table (the local preview + node-face meters)
      and, when the link is open, ONE `audioFeatures` message so the server drives the visible
      kit. `send` drops while the socket is closed, so a reconnect never replays stale frames. */
  private forwardAudio(frame: voice.AudioFeatureFrame): void {
    if (this.project?.inputMap.trackAudioInput) return;
    this.sim.setAudio(frame);
    if (this.link === 'open') this.client.send({ t: 'audioFeatures', level: frame.level, bass: frame.bass, mids: frame.mids, highs: frame.highs });
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

  /** Engine-link change-detection (per-frame transport push + authored-Show resend). */
  private readonly engineSync = new EngineLinkSync();
  /** 32 MiB estimated retained bytes, at most 10,000 checkpoints; unchanged branches are shared. */
  private readonly history = new DocumentHistory<UndoEntry>();
  private restoringUndo = false;
  /** When true, {@link pushUndoSnapshot} is a no-op so a follow-on mutation folds into the
      caller's already-open checkpoint instead of opening its own — the R04 add+auto-wire is one
      undoable action. Set only via {@link batchIntoCurrentUndo}. */
  private suppressUndoSnapshot = false;
  /** Open-gesture nesting depth (see {@link beginGesture}) — a drag that publishes on every
      pointermove must collapse to ONE undo checkpoint. */
  private gestureDepth = 0;
  /** True between beginGesture() and the gesture's first mutation: that mutation takes the
      one checkpoint, then suppression takes over. A gesture that mutates nothing pushes nothing. */
  private gesturePending = false;
  /** `suppressUndoSnapshot` as it stood when the outermost gesture opened, restored on close
      so a gesture nested inside a batchIntoCurrentUndo can't re-arm checkpoints early. */
  private gestureSuppressPrev = false;
  /** Whether a controller discovery sweep is in flight. See {@link ControllerMonitor.scanning}. */
  get controllerScanning(): boolean {
    return this.monitor.scanning;
  }

  constructor(
    makeClient: () => WSClient = () =>
      new WSClient({ pin: readStoredPin(), hostToken: readHostToken() }),
  ) {
    // Hydrate the show + song libraries from storage into the controller (reserving their ids) BEFORE
    // the sim is built and the engine link opens, and mirror the ACTIVE show's authored over the
    // seed defaults — a fresh slice is partial, so applyAuthored fills any absent field. The v3
    // loader never throws: a valid library wins, else a fresh "Untitled Show" is seeded.
    this.applyAuthored(this.showsCtl.hydrateFromStorage());
    this.sim = new Sim();
    this.sim.pixelModel = this.labModel.pm;
    // Effect chains: the offline Sim plays the v3 show through its private core engine.
    this.ensureSimShow();
    // An old-format library under the old local keys is offered for import (never migrated).
    this.legacyLibrary = detectLegacyLibrary(browserStorage());
    this.client = makeClient();
  }

  /** The active section (SetlistSection) in the active song — the section you play + edit.
      Its Effect stack drives hit-resolution + the Sections / Effects views. */
  get activeSection(): SetlistSection | null {
    return this.sectionsCtl.activeSection;
  }
  /** Recent input velocities per drum, for the velocity-sensitivity editor's live overlay
      (Trent, 2026-08-17: see the curve helping while you drum). Each entry is the RAW input
      velocity only — its y is read off whatever curve is on screen, so an unsaved tweak
      re-plots hits that already landed. UI timestamps, never engine state. */
  velocityHits = $state<VelocityHits>({});
  /** Stamp one raw hit against its drum. Connected, the server's `input` echo is the source
      (it carries the pre-curve value + the drum the zone-map claimed); offline the local fire
      paths call it. Never both, or the same stick hit would plot twice. */
  private recordVelocityHit(drumId: string | undefined, value: number): void {
    const now = typeof performance !== 'undefined' ? performance.now() : Date.now();
    this.velocityHits = appendVelocityHit(this.velocityHits, drumId, { x: value, at: now });
  }
  /** The recent hits to plot under one drum's curve. */
  velocityHitsFor(drumId: string): readonly CurveHit[] {
    return this.velocityHits[drumId] ?? EMPTY_HITS;
  }
  /** Shape a velocity by its drum's sensitivity curve — the OFFLINE mirror of the server's
      `toInputEvent` seam. Connected, the server has already applied it and the client must
      not apply it again. */
  private shapeVelocity(drumId: string | undefined, velocity: number): number {
    const inputMap = this.project?.inputMap;
    return inputMap ? applyDrumVelocity(inputMap, drumId, velocity) : velocity;
  }


  // --- effect chains authoring (S05): EffectsAuthoringApi over EffectsController -----------------
  // The store implements the authoring contract by DELEGATING to {@link EffectsController}: every
  // mutator runs one pure `effects-doc.ts` op against the active section, recorded as ONE undo
  // checkpoint through the store's history (drags fold between beginGesture / endGesture), guarded
  // by the viewer / read-only-library-song rule, and autosaved like every other authored edit.
  // The controller owns selection + the cell clipboard; the store supplies the section, kit, input
  // map, fire paths, files, cue learn and legacy import through the host below.

  /** The show's MIDI-map InputMappings (`AuthoredV3.mappings`), validated on load (an invalid
      stored entry is dropped, as core `buildRuntimeShow` drops it). Replaced whole on every edit
      (raw: never mutated in place), so undo checkpoints can hold the live reference. */
  private mappings = $state.raw<readonly effectChain.InputMapping[]>([]);

  private readonly effectsCtl: EffectsController = new EffectsController({
    getSection: () => this.activeEffectsSection,
    setSection: (next) => this.writeActiveEffectsSection(next),
    activeSectionId: () => this.activeSectionId,
    canEdit: () => this.canEditActiveSong && this.activeSection !== null,
    kit: () => this.effectsKit,
    inputMap: () => this.effectsInputMap,
    undo: {
      push: () => this.pushUndoSnapshot(),
      beginGesture: () => this.beginGesture(),
      endGesture: () => this.endGesture(),
    },
    fire: {
      effect: (effectId) => this.auditionEffects([effectId], 'audition'),
      cell: (cell) => this.auditionEffects(this.effectsCtl.cellEffects(cell).map((e) => e.id), 'cell'),
      effectFireAt: (effectId) => this.effectFireStamps[effectId] ?? 0,
      cellFireAt: (cell) => this.effectsCtl.cellEffects(cell).reduce((at, e) => Math.max(at, this.effectFireStamps[e.id] ?? 0), 0),
      hit: (cell) => {
        const slot = cell.column.kind === 'zone' ? cell.column.slot : null;
        const pad = slot === null ? undefined : this.pads.find((p) => p.drumId === cell.row && Number(p.zone) === slot);
        if (!pad) return false;
        this.hit(pad);
        return true;
      },
    },
    files: {
      saveEffect: async (effect) => {
        const file = effectsFiles.effectFile($state.snapshot(effect) as effectChain.Effect, this.effectsClipSources(), this.clipMeta());
        await this.writeFile(file.text, file.fileName, `Saved “${effect.name || 'Effect'}”.`);
      },
      saveCell: async (cell, stack) => {
        const file = effectsFiles.cellFile($state.snapshot(cell) as effectChain.EffectCell, $state.snapshot(stack) as effectChain.Effect[], this.effectsClipSources(), this.clipMeta());
        await this.writeFile(file.text, file.fileName, 'Saved the cell.');
      },
      saveDevice: async (effect, device) => this.saveEffectsDevice(effect.id, device),
      loadIntoCell: (cell) => this.readEffectsFile((text) => this.applyEffectsFileToCell(cell, text)),
      loadIntoEffect: (effectId) => this.readEffectsFile((text) => this.applyEffectsFileToEffect(effectId, text)),
    },
    learn: {
      start: (effectId, via) => {
        this.cancelCueLearnArms();
        if (via === 'midi') this.midi.startLearn({ kind: 'cue', effectId });
        else this.osc.start({ kind: 'cue', effectId });
      },
      cancel: () => this.cancelCueLearnArms(),
      effectId: () => {
        const midi = this.midi.learnTarget;
        if (midi?.kind === 'cue') return midi.effectId;
        const osc = this.osc.target;
        return osc?.kind === 'cue' ? osc.effectId : null;
      },
      startReset: (cell, via) => {
        this.cancelCueLearnArms();
        if (via === 'midi') this.midi.startLearn({ kind: 'cell-reset', cell });
        else this.osc.start({ kind: 'cell-reset', cell });
      },
      resetCell: () => {
        const midi = this.midi.learnTarget;
        if (midi?.kind === 'cell-reset') return midi.cell;
        const osc = this.osc.target;
        return osc?.kind === 'cell-reset' ? osc.cell : null;
      },
    },
    legacyImport: {
      available: () => this.legacyImportAvailable,
      showNames: () => this.legacyShowNames,
      run: () => this.runLegacyImport(),
      dismiss: () => this.dismissLegacyImportPrompt(),
    },
  } satisfies EffectsControllerHost);

  /** The Effects authoring surface for UI mounts; its canEdit is the mutators' rule (viewer,
      library song, no section). Mount sites pass `store.effectsApi` rather than casting the store,
      whose own {@link canEdit} is viewer-only. */
  get effectsApi(): EffectsAuthoringApi {
    return this.effectsCtl;
  }

  /** The kit the grid lays out: the server Project's, else the offline default kit. */
  private get effectsKit(): KitConfig {
    return this.project?.kit ?? OFFLINE_PROJECT.kit;
  }
  /** The input map the grid's zone columns come from (the server Project's, else the default). */
  private get effectsInputMap(): InputMap {
    return this.project?.inputMap ?? OFFLINE_PROJECT.inputMap;
  }

  /** The active section as the pure ops' {@link EffectsSection}. */
  private get activeEffectsSection(): (EffectsSection & SetlistSection) | null {
    const section = this.activeSection;
    if (!section) return null;
    if (section.effects && section.master) return section as EffectsSection & SetlistSection;
    return { ...section, effects: section.effects ?? [], master: section.master ?? [] };
  }

  /** Write an edited active section back into its (local) song — the one mutation surface of the
      Effects API. Undo was recorded by the caller. */
  private writeActiveEffectsSection(next: EffectsSection): void {
    const sectionId = this.activeSectionId;
    const songId = this.activeSongId;
    if (sectionId === null) return;
    this.songs = this.songs.map((song) =>
      song.id !== songId
        ? song
        : {
            ...song,
            sections: song.sections.map((section) =>
              section.id === sectionId
                ? { ...section, effects: next.effects, master: next.master, ...(next.cellPlay !== undefined ? { cellPlay: next.cellPlay } : {}) }
                : section,
            ),
          },
    );
  }

  // ---- read models --------------------------------------------------------------------------
  get gridRows(): readonly GridRow[] {
    return this.effectsCtl.gridRows;
  }
  get gridColumns(): readonly GridColumn[] {
    return this.effectsCtl.gridColumns;
  }
  cellSummary(cell: effectChain.EffectCell): CellSummary {
    return this.effectsCtl.cellSummary(cell);
  }
  cellEffects(cell: effectChain.EffectCell): readonly effectChain.Effect[] {
    return this.effectsCtl.cellEffects(cell);
  }
  get masterChain(): readonly effectChain.ModifierDevice[] {
    return this.effectsCtl.masterChain;
  }
  get selectedCell(): CellSelection | null {
    return this.effectsCtl.selectedCell;
  }
  get selectedEffectId(): string | null {
    return this.effectsCtl.selectedEffectId;
  }
  effectById(effectId: string): effectChain.Effect | undefined {
    return this.effectsCtl.effectById(effectId);
  }
  cellFireAt(cell: effectChain.EffectCell): number {
    return this.effectsCtl.cellFireAt(cell);
  }
  effectFireAt(effectId: string): number {
    return this.effectsCtl.effectFireAt(effectId);
  }

  // ---- selection + audition ----------------------------------------------------------------
  selectCell(cell: CellSelection | null): void {
    this.effectsCtl.selectCell(cell);
  }
  selectEffect(effectId: string | null): void {
    this.effectsCtl.selectEffect(effectId);
  }
  get selectedDevice(): DeviceSelection | null {
    return this.effectsCtl.selectedDevice;
  }
  selectDevice(selection: DeviceSelection | null): void {
    this.effectsCtl.selectDevice(selection);
  }
  editSelection(verb: SelectionVerb): ApplyResult | null {
    return this.effectsCtl.editSelection(verb);
  }
  /** The keyboard's route to {@link editSelection} (Delete / ⌘X / ⌘C / ⌘V in the Effects view):
      the same edit, plus a toast for a refusal or a note, so a key that did nothing says why.
      True when the key was the strip's to take. */
  editSelectionFromKeyboard(verb: SelectionVerb): boolean {
    const result = this.effectsCtl.editSelection(verb);
    if (result === null) return false;
    if (!result.ok) pushToast(result.reason, { tone: 'error' });
    else if (result.note) pushToast(result.note, { tone: 'info' });
    return true;
  }
  fireEffect(effectId: string): void {
    this.effectsCtl.fireEffect(effectId);
  }
  fireEffectAt(index: number): void {
    this.effectsCtl.fireEffectAt(index);
  }
  fireCell(cell: effectChain.EffectCell): void {
    this.effectsCtl.fireCell(cell);
  }

  // ---- Effects --------------------------------------------------------------------------------
  addEffect(cell: effectChain.EffectCell, generator: effectChain.GeneratorKind, style?: string): string | null {
    return this.effectsCtl.addEffect(cell, generator, style);
  }
  removeEffect(effectId: string): void {
    this.effectsCtl.removeEffect(effectId);
  }
  duplicateEffect(effectId: string): string | null {
    return this.effectsCtl.duplicateEffect(effectId);
  }
  moveEffect(effectId: string, to: effectChain.EffectCell, index: number): void {
    this.effectsCtl.moveEffect(effectId, to, index);
  }
  renameEffect(effectId: string, name: string): void {
    this.effectsCtl.renameEffect(effectId, name);
  }
  setEffectBypass(effectId: string, bypass: boolean): void {
    this.effectsCtl.setEffectBypass(effectId, bypass);
  }
  setEffectBlend(effectId: string, blend: effectChain.Effect['blend']): void {
    this.effectsCtl.setEffectBlend(effectId, blend);
  }
  setEffectOpacity(effectId: string, opacity: number): void {
    this.effectsCtl.setEffectOpacity(effectId, opacity);
  }
  setRetrigger(effectId: string, retrigger: effectChain.Retrigger): void {
    this.effectsCtl.setRetrigger(effectId, retrigger);
  }
  setAmp(effectId: string, amp: Partial<effectChain.AmpEnvelope>): void {
    this.effectsCtl.setAmp(effectId, amp);
  }
  setTrigger(effectId: string, trigger: effectChain.EffectTrigger): void {
    this.effectsCtl.setTrigger(effectId, trigger);
  }
  setTarget(effectId: string, target: effectChain.EffectTarget): void {
    this.effectsCtl.setTarget(effectId, target);
  }

  // ---- Generator ------------------------------------------------------------------------------
  setGenerator(effectId: string, kind: effectChain.GeneratorKind, style?: string): void {
    this.effectsCtl.setGenerator(effectId, kind, style);
  }
  setGeneratorParam(effectId: string, key: string, value: number | boolean | string): void {
    this.effectsCtl.setGeneratorParam(effectId, key, value);
  }
  setGeneratorParams(effectId: string, patch: Readonly<Record<string, number | boolean | string | undefined>>): void {
    this.effectsCtl.setGeneratorParams(effectId, patch);
  }

  // ---- kit geometry for the strip (StripKitInfo) ---------------------------------------------
  /** The project kit's pixel model — hoop counts and bounds as the engine lays them out. */
  private kitPixelModel = $derived(buildPixelModel(this.effectsKit));
  /** How many hoops a drum of the project kit has (Target hoop picking, Splice hoop order). */
  drumHoopCount(drumId: string): number {
    return this.kitPixelModel.drumById.get(drumId)?.hoopCount ?? 0;
  }
  /** The project kit's bounds, mm (a Slice's Space box starts as the whole kit). */
  kitBounds(): { min: { x: number; y: number; z: number }; max: { x: number; y: number; z: number } } {
    return this.kitPixelModel.bounds;
  }
  setSpliceSlots(effectId: string, slots: effectChain.SpliceSlot[]): void {
    this.effectsCtl.setSpliceSlots(effectId, slots);
  }

  // ---- Modifiers (effectId = MASTER_CELL addresses the section master chain) -----------------
  addModifier(owner: ChainOwner, modifierId: string, index?: number): string | null {
    return this.effectsCtl.addModifier(owner, modifierId, index);
  }
  removeModifier(owner: ChainOwner, uid: string): void {
    this.effectsCtl.removeModifier(owner, uid);
  }
  moveModifier(owner: ChainOwner, uid: string, index: number): void {
    this.effectsCtl.moveModifier(owner, uid, index);
  }
  setModifierParam(owner: ChainOwner, uid: string, key: string, value: number | boolean | string): void {
    this.effectsCtl.setModifierParam(owner, uid, key, value);
  }
  setModifierParams(owner: ChainOwner, uid: string, patch: Readonly<Record<string, number | boolean | string | undefined>>): void {
    this.effectsCtl.setModifierParams(owner, uid, patch);
  }
  setModifierMix(owner: ChainOwner, uid: string, mix: number): void {
    this.effectsCtl.setModifierMix(owner, uid, mix);
  }
  setModifierEnvelope(owner: ChainOwner, uid: string, envelope: effectChain.ModifierEnvelopeSpec | null): void {
    this.effectsCtl.setModifierEnvelope(owner, uid, envelope);
  }
  setModifierBypass(owner: ChainOwner, uid: string, bypass: boolean): void {
    this.effectsCtl.setModifierBypass(owner, uid, bypass);
  }

  // ---- Controls -------------------------------------------------------------------------------
  addControl(effectId: string, kind: effectChain.ControlKind): string | null {
    return this.effectsCtl.addControl(effectId, kind);
  }
  removeControl(effectId: string, uid: string): void {
    this.effectsCtl.removeControl(effectId, uid);
  }
  setControlSettings(effectId: string, uid: string, settings: Partial<effectChain.ControlDevice['settings']>): void {
    this.effectsCtl.setControlSettings(effectId, uid, settings);
  }
  addMapping(effectId: string, controlUid: string, mapping: effectChain.ControlMapping): void {
    this.effectsCtl.addMapping(effectId, controlUid, mapping);
  }
  setMapping(effectId: string, controlUid: string, index: number, mapping: Partial<effectChain.ControlMapping>): void {
    this.effectsCtl.setMapping(effectId, controlUid, index, mapping);
  }
  removeMapping(effectId: string, controlUid: string, index: number): void {
    this.effectsCtl.removeMapping(effectId, controlUid, index);
  }

  // ---- Cells ----------------------------------------------------------------------------------
  copyCell(cell: effectChain.EffectCell): void {
    this.effectsCtl.copyCell(cell);
  }
  pasteCell(cell: effectChain.EffectCell): ApplyResult {
    return this.effectsCtl.pasteCell(cell);
  }
  get canPasteCell(): boolean {
    return this.effectsCtl.canPasteCell;
  }
  moveCell(from: effectChain.EffectCell, to: effectChain.EffectCell, copy?: boolean): ApplyResult {
    return this.effectsCtl.moveCell(from, to, copy);
  }
  clearCell(cell: effectChain.EffectCell): void {
    this.effectsCtl.clearCell(cell);
  }

  // ---- Cue learn ------------------------------------------------------------------------------
  startCueLearn(effectId: string, via: 'midi' | 'osc'): void {
    this.effectsCtl.startCueLearn(effectId, via);
  }
  cancelCueLearn(): void {
    this.effectsCtl.cancelCueLearn();
  }
  get cueLearnEffectId(): string | null {
    return this.effectsCtl.cueLearnEffectId;
  }
  cellPlay(cell: effectChain.EffectCell): effectChain.CellPlay | null {
    return this.effectsCtl.cellPlay(cell);
  }
  setCellPlayMode(cell: effectChain.EffectCell, mode: effectChain.CellPlayMode): void {
    this.effectsCtl.setCellPlayMode(cell, mode);
  }
  setCellReset(cell: effectChain.EffectCell, reset: effectChain.CellReset | null): void {
    this.effectsCtl.setCellReset(cell, reset);
  }
  startCellResetLearn(cell: effectChain.EffectCell, via: 'midi' | 'osc'): void {
    this.effectsCtl.startCellResetLearn(cell, via);
  }
  get cellResetLearnCell(): effectChain.EffectCell | null {
    return this.effectsCtl.cellResetLearnCell;
  }
  lastPlayedStep(cell: effectChain.EffectCell): number | null {
    return this.effectsCtl.lastPlayedStep(cell);
  }
  /** Learn bound a cell's reset. Always accepted: a reset may share a note with a zone or Cue —
      the one hit then does both jobs — so say so rather than refuse (the old Sequence node
      refused, which left a zone-mapped kit with no note to pick; Tim, 2026-09-27). */
  private setCellResetFromLearn(cell: effectChain.EffectCell, reset: effectChain.CellReset): boolean {
    if (!this.effectsCtl.cellPlay(cell)) return true; // the cell went back to Layer: nothing to bind
    this.effectsCtl.setCellReset(cell, reset);
    const note = reset.kind === 'midiNote' ? reset.note : null;
    if (note !== null && this.project?.inputMap.midiNotes.some((m) => m.note === note)) {
      pushToast('That note also plays a drum zone — one hit will both play it and reset this cell.', { tone: 'info' });
    }
    return true;
  }

  /** Disarm a cue learn on either transport (another target's arm is left alone). */
  private cancelCueLearnArms(): void {
    if (this.midi.learnTarget?.kind === 'cue') this.midi.cancelLearn();
    if (this.osc.target?.kind === 'cue') this.osc.cancel();
  }

  /**
   * Bind a Cue Effect's source (the MIDI / OSC learn write). A Cue is a `pad-trigger` claim, so it
   * may share a note with a zone but not with a global control or reserved CC 0. False = refused
   * (the learn stays armed).
   */
  private setCueSource(effectId: string, source: effectChain.CueSource): boolean {
    const effect = this.effectsCtl.effectById(effectId);
    if (!effect || effect.trigger.kind !== 'cue' || !this.effectsCtl.canEdit) return false;
    const scope: voice.BindingScope | null = this.project ? { inputMap: this.project.inputMap } : null;
    if (scope) {
      const asSource: voice.TriggerSource =
        source.oscAddress !== undefined ? { kind: 'osc', address: source.oscAddress } : { kind: 'midi', note: source.midiNote, cc: source.midiCc };
      const self: voice.BindingClaim = { group: 'pad-trigger', kind: 'cue', effectId };
      if (this.refuseBindings(voice.sourceBindingRejections(scope, asSource, self))) return false;
    }
    this.effectsCtl.setTrigger(effectId, { kind: 'cue', source });
    return true;
  }

  // ---- MIDI-map mode (effect chains S07): MapModeApi over the show's InputMappings -------------
  // Mappings are SHOW-level (`AuthoredV3.mappings`), so editing them needs only the editor seat
  // (not a local active song). Every write is one undo step and autosaves; the runtime Show carries
  // them to the engine (server, or the offline Sim), which consumes a mapped note / CC / OSC at
  // global-control precedence. Two target kinds resolve HERE instead: key mappings (the web owns
  // the keyboard) and bypass toggles (an authored edit, applied when the input echo arrives
  // linked, or when local MIDI fires offline).

  /** CC / OSC press edges for bypass toggles (a knob sweep toggles once, not per message). */
  private readonly bypassEdges = new inputMappings.BypassToggleEdges();
  /** The last refusal MIDI / OSC learn met, for the armed control (cleared on arm / bind). */
  private mapRefusal = $state<string | null>(null);

  get inputMappings(): readonly effectChain.InputMapping[] {
    return this.mappings;
  }
  get canEditMappings(): boolean {
    return !this.isViewer;
  }
  mapTargetId(target: MapTarget): string {
    return inputMappings.mapTargetId(target);
  }
  bindingFor(target: MapTarget): effectChain.InputMappingSource | null {
    if (target.kind === 'globalControl') return inputMappings.globalControlSource(this.globalControls[target.action]);
    return inputMappings.mappingForTarget(this.mappings, this.mapTargetId(target))?.source ?? null;
  }
  defaultRange(target: effectChain.InputMappingTarget): { min: number; max: number } | null {
    if (!effectChain.isContinuousTarget(target)) return null;
    // The engine's own resolution (the active section's Effect, the param spec's number range),
    // so the range shown is exactly the one a knob scales into.
    const probe: effectChain.InputMapping = { id: 'default-range', source: { key: 'default-range' }, target };
    const [binding] = effectChain.resolveContinuousInputMappings([probe], this.activeEffectsSection);
    return binding ? { min: binding.lo, max: binding.hi } : null;
  }

  bindTarget(target: MapTarget, source: effectChain.InputMappingSource): BindResult {
    if (!this.canEditMappings) return { ok: false, reason: 'Viewing — another client is editing; mappings are read-only.' };
    const kindRefusal = inputMappings.mapSourceKindRefusal(target, source);
    if (kindRefusal) return { ok: false, reason: kindRefusal };
    if (target.kind === 'globalControl') return this.bindGlobalControl(target.action, source);

    const selfId = this.mapTargetId(target);
    const [rejection] = voice.inputMappingConflicts(this.mappingBindingScope, source, selfId);
    if (rejection) return { ok: false, reason: this.bindingRefusalText(rejection) };
    const next = inputMappings.withMappingSource(this.mappings, target, source, () =>
      freshId('map', (id) => this.mappings.some((m) => m.id === id)),
    );
    if (next !== this.mappings) {
      this.pushUndoSnapshot();
      this.mappings = next;
    }
    return { ok: true };
  }

  clearTarget(target: MapTarget): void {
    if (!this.canEditMappings) return;
    if (target.kind === 'globalControl') {
      if (this.globalControls[target.action]) this.setGlobalControlBinding(target.action, inputMappings.CLEAR_GLOBAL_CONTROL);
      return;
    }
    const next = inputMappings.withoutMapping(this.mappings, this.mapTargetId(target));
    if (next === this.mappings) return;
    this.pushUndoSnapshot();
    this.mappings = next;
  }

  /** MapModeApi: a continuous InputMapping's range. */
  setMappingRange(target: effectChain.InputMappingTarget, rangeMin: number | undefined, rangeMax: number | undefined): void {
    if (!this.canEditMappings) return;
    const next = inputMappings.withMappingRange(this.mappings, this.mapTargetId(target), rangeMin, rangeMax);
    if (next === this.mappings) return;
    this.pushUndoSnapshot();
    this.mappings = next;
  }

  /** Arm MIDI AND OSC learn for one control: whichever input arrives binds, and the arm stays up
      (map mode re-binds on each new input until the user disarms). */
  startMapLearn(target: MapTarget): void {
    if (!this.canEditMappings) return;
    this.mapRefusal = null;
    this.midi.startLearn({ kind: 'map', target });
    this.osc.start({ kind: 'map', target });
  }
  cancelMapLearn(): void {
    if (this.midi.learnTarget?.kind === 'map') this.midi.cancelLearn();
    if (this.osc.target?.kind === 'map') this.osc.cancel();
    this.mapRefusal = null;
  }
  get mapLearnTargetId(): string | null {
    const midi = this.midi.learnTarget;
    if (midi?.kind === 'map') return this.mapTargetId(midi.target);
    const osc = this.osc.target;
    return osc?.kind === 'map' ? this.mapTargetId(osc.target) : null;
  }
  get mapLearnRefusal(): string | null {
    return this.mapRefusal;
  }

  performKeyMapping(code: string): boolean {
    const mapping = effectChain.matchInputMapping(this.mappings, { key: code });
    if (!mapping) return false;
    this.performDiscreteMapping(mapping.target);
    return true;
  }

  /** A MIDI / OSC learn bind (midi-controller / osc-learn `map` target): record the refusal for
      the armed control, clear it on success. */
  private bindFromMapLearn(target: MapTarget, source: effectChain.InputMappingSource): void {
    const result = this.bindTarget(target, source);
    this.mapRefusal = result.ok ? null : result.reason;
  }

  /** Map mode binding a global control: only the source's own field changes (Settings stays the
      source of truth), refused with the same guard `setInputMap` applies, but without its toast —
      the overlay shows the reason on the armed control. */
  private bindGlobalControl(action: GlobalControlAction, source: effectChain.InputMappingSource): BindResult {
    const patch = inputMappings.globalControlPatch(source);
    if (!patch) return { ok: false, reason: 'Global controls bind a MIDI note, a CC or an OSC address.' };
    if (!this.project) return { ok: false, reason: 'Connect to the LEDrums server to bind a global control.' };
    const current = this.project.inputMap;
    const next: InputMap = { ...current, globalControls: withGlobalControlBinding(current.globalControls, action, patch) };
    const [rejection] = voice.inputMapBindingRejections(current, next, { mappings: this.mappings });
    if (rejection) return { ok: false, reason: this.bindingRefusalText(rejection) };
    const before = current.globalControls[action];
    const after = next.globalControls[action];
    if (JSON.stringify(before ?? null) === JSON.stringify(after ?? null)) return { ok: true };
    return this.setGlobalControlBinding(action, patch) ? { ok: true } : { ok: false, reason: 'That binding was refused.' };
  }

  /** Everything a mapping source can collide with: the zone map and global controls, every
      section's Effects (a Cue would be starved) and the other mappings. Offline the default
      input map stands in for the server Project's. */
  private get mappingBindingScope(): voice.BindingScope {
    return {
      inputMap: this.effectsInputMap,
      mappings: this.mappings,
      effects: this.resolvedSongs.flatMap((song) => song.sections.flatMap((section) => section.effects ?? [])),
    };
  }

  private bindingRefusalText(rejection: voice.BindingRejection): string {
    return bindingRejectionMessage(rejection, this.drums);
  }

  /**
   * Perform a discrete target the web resolves itself — a key press (every discrete kind), or a
   * MIDI / OSC press on a bypass toggle. Fires go through the same audition path the grid uses
   * (the server when linked, the Sim offline); a recall re-points the active song / section; a
   * bypass toggle is an authored edit (one undo step, the Effects mutators' guard). Continuous
   * targets are the engine's (a key mapping is refused on them at bind time).
   */
  private performDiscreteMapping(target: effectChain.InputMappingTarget): void {
    switch (target.kind) {
      case 'fireCell':
        this.effectsCtl.fireCell(target.cell);
        return;
      case 'fireEffect':
        this.effectsCtl.fireEffect(target.effectId);
        return;
      case 'recallSection': {
        const songId = target.songId
          ?? this.resolvedSongs.find((song) => song.sections.some((s) => s.id === target.sectionId))?.id;
        if (!songId) return;
        if (this.activeSongId !== songId) this.setActiveSong(songId);
        this.setActiveSection(target.sectionId);
        return;
      }
      case 'bypass':
        this.toggleMappedBypass(target);
        return;
      default:
        return;
    }
  }

  /** Flip an Effect's bypass, or one of its (or the Master chain's) Modifiers' when a uid is
      given. A target that no longer resolves in the active section is a no-op. */
  private toggleMappedBypass(target: Extract<effectChain.InputMappingTarget, { kind: 'bypass' }>): void {
    if (target.modifierUid === undefined) {
      const effect = this.effectsCtl.effectById(target.effectId);
      if (effect) this.effectsCtl.setEffectBypass(effect.id, !effect.bypass);
      return;
    }
    const owner: ChainOwner = target.effectId === MASTER_CELL ? MASTER_CELL : target.effectId;
    const chain = owner === MASTER_CELL ? this.effectsCtl.masterChain : (this.effectsCtl.effectById(owner)?.modifiers ?? []);
    const modifier = chain.find((m) => m.uid === target.modifierUid);
    if (modifier) this.effectsCtl.setModifierBypass(owner, modifier.uid, !modifier.bypass);
  }

  /** Whether map mode's MIDI learn arm is up: a heard MIDI input is then a learn gesture only. */
  private get midiMapLearnArmed(): boolean {
    return this.midi.learnTarget?.kind === 'map';
  }
  /** Whether map mode's OSC learn arm is up (see {@link midiMapLearnArmed}). */
  private get oscMapLearnArmed(): boolean {
    return this.osc.target?.kind === 'map';
  }

  /**
   * A heard MIDI / OSC input that a mapping the STORE owns takes, performed on its press edge: a
   * bypass toggle always, and a section recall when `recall` is set (offline CC — offline notes
   * reach it through {@link fireMappedMidiLocal}; linked, the engine recalls). Called from the
   * input echo when linked and from the local MIDI forward offline — never both, since offline
   * there is no echo. With `learning` (a map learn arm was up when the input arrived) the press
   * edge is still recorded but nothing is performed: the input only binds (spec story 62).
   */
  private performStoreOwnedInput(
    event: effectChain.InputMappingEvent,
    value01: number,
    { recall = false, learning = false }: { recall?: boolean; learning?: boolean } = {},
  ): void {
    if (this.mappings.length === 0) return;
    const mapping = effectChain.matchInputMapping(this.mappings, event);
    if (!mapping) return;
    const target = mapping.target;
    if (target.kind !== 'bypass' && !(recall && target.kind === 'recallSection')) return;
    const presses = event.midiCc !== undefined
      ? this.bypassEdges.cc(event.midiCc, value01)
      : event.oscAddress !== undefined
        ? this.bypassEdges.osc(value01)
        : value01 > 0;
    if (!presses || learning) return;
    if (target.kind === 'bypass') this.toggleMappedBypass(target);
    else this.performDiscreteMapping(target);
  }

  // ---- Files (Tim's save / load to file, extended) --------------------------------------------
  saveEffectToFile(effectId: string): Promise<void> {
    return this.effectsCtl.saveEffectToFile(effectId);
  }
  saveCellToFile(cell: effectChain.EffectCell): Promise<void> {
    return this.effectsCtl.saveCellToFile(cell);
  }
  saveDeviceToFile(effectId: string, device: 'generator' | string): Promise<void> {
    return this.effectsCtl.saveDeviceToFile(effectId, device);
  }
  loadFileIntoCell(cell: effectChain.EffectCell): Promise<ApplyResult> {
    return this.effectsCtl.loadFileIntoCell(cell);
  }
  loadFileIntoEffect(effectId: string): Promise<ApplyResult> {
    return this.effectsCtl.loadFileIntoEffect(effectId);
  }
  /** Save one Master-chain modifier to a device file. Outside the contract (it has no master
      save / load) — reported as a gap for the orchestrator. */
  saveMasterModifierToFile(uid: string): Promise<void> {
    return this.saveEffectsDevice(MASTER_CELL, uid);
  }
  /** Load a modifier device file onto the end of the Master chain (outside the contract, see
      {@link saveMasterModifierToFile}). */
  loadFileIntoMaster(): Promise<ApplyResult> {
    if (!this.effectsCtl.canEdit) return Promise.resolve(READ_ONLY);
    return this.readEffectsFile((text) => this.applyDeviceFileToMaster(text));
  }

  /** IO-free: load an Effect / cell file's text into `cell` (one undo step, scenes included). */
  applyEffectsFileToCell(cell: effectChain.EffectCell, text: string): ApplyResult {
    return this.applyEffectsFile((section, ctx) => effectsFiles.applyFileToCell(section, cell, text, ctx));
  }
  /** IO-free: load an Effect / device file's text onto an existing Effect (one undo step). */
  applyEffectsFileToEffect(effectId: string, text: string): ApplyResult {
    return this.applyEffectsFile((section, ctx) => effectsFiles.applyFileToEffect(section, effectId, text, ctx));
  }
  /** IO-free: load a modifier device file onto the Master chain (one undo step). */
  applyDeviceFileToMaster(text: string): ApplyResult {
    return this.applyEffectsFile((section, ctx) => effectsFiles.applyDeviceFile(section, MASTER_CELL, text, ctx));
  }

  /** The one load chokepoint: guard, apply the pure file op to a detached copy of the active
      section, then write the section AND the scenes it brought in ONE undo checkpoint. */
  private applyEffectsFile(
    apply: (section: EffectsSection, ctx: effectsFiles.EffectsFileContext) => effectsFiles.EffectsFileApplied<EffectsSection>,
  ): ApplyResult {
    const section = this.activeEffectsSection;
    if (!section || !this.effectsCtl.canEdit) return READ_ONLY;
    const plain = $state.snapshot({ effects: section.effects, master: section.master, ...(section.cellPlay ? { cellPlay: section.cellPlay } : {}) }) as EffectsSection;
    const out = apply(plain, { canvasScenes: $state.snapshot(this.canvasScenes) as CanvasScene[] });
    if (!out.result.ok) return out.result;
    this.pushUndoSnapshot();
    this.batchIntoCurrentUndo(() => {
      this.writeActiveEffectsSection(out.section);
      this.unionCanvasScenes(out.canvasScenes);
    });
    const placed = out.effectIds[0];
    if (placed) this.effectsCtl.selectEffect(placed);
    return out.result;
  }

  /** Pick a file and apply it; toasts the outcome. Guards the show being replaced meanwhile. */
  private async readEffectsFile(apply: (text: string) => ApplyResult): Promise<ApplyResult> {
    const generation = this.documentGeneration;
    const opened: OpenOutcome = await openTextFile();
    if (generation !== this.documentGeneration) return { ok: false, reason: 'The show changed while the file was open.' };
    if (opened === 'cancelled') return { ok: false, reason: 'Cancelled.' };
    const result: ApplyResult = opened === 'failed' ? { ok: false, reason: 'Couldn’t read that file.' } : apply(opened.text);
    pushToast(result.ok ? 'Loaded the file.' : result.reason, { tone: result.ok ? 'success' : 'error' });
    return result;
  }

  private async saveEffectsDevice(effectId: string, device: 'generator' | string): Promise<void> {
    const section = this.activeEffectsSection;
    if (!section) return;
    const payload = effectsFiles.findDevice($state.snapshot(section) as EffectsSection, effectId, device);
    if (!payload) return;
    const file = effectsFiles.deviceFile(payload, this.effectsClipSources(), this.clipMeta());
    await this.writeFile(file.text, file.fileName, 'Saved the device.');
  }

  private effectsClipSources(): { canvasScenes: CanvasScene[] } {
    return { canvasScenes: $state.snapshot(this.canvasScenes) as CanvasScene[] };
  }

  /** Add scenes the show does not already hold (by id) — file loads and song detach. */
  private unionCanvasScenes(scenes: readonly CanvasScene[]): void {
    const have = new Set(this.canvasScenes.map((scene) => scene.id));
    const fresh = scenes.filter((scene) => !have.has(scene.id));
    if (fresh.length > 0) this.canvasScenes = [...this.canvasScenes, ...fresh];
  }

  // ---- fire paths + flashes -------------------------------------------------------------------

  /** Per-Effect last-fire time (`performance.now()` ms) for the grid / strip fire flashes. A UI
      timestamp, never engine state. Stamped from local intents (hit / audition) online and
      offline, and offline also from the Sim's engine (Always / Clock fires). */
  effectFireStamps = $state.raw<Record<string, number>>({});
  /** The Sim time each Effect was last seen firing, so the offline poll stamps only new fires. */
  private readonly simFireSeen = new Map<string, number>();

  private stampEffectFires(effectIds: readonly string[]): void {
    if (effectIds.length === 0) return;
    const now = nowMs();
    const next = { ...this.effectFireStamps };
    for (const id of effectIds) next[id] = now;
    this.effectFireStamps = next;
  }

  /** Offline: stamp the active section's Effects the Sim's engine fired since the last frame. */
  private pollSimEffectFires(): void {
    const fired: string[] = [];
    for (const effect of this.activeSection?.effects ?? EMPTY_EFFECTS) {
      const at = this.sim.effectFiredAt(effect.id);
      if (at > 0 && at !== this.simFireSeen.get(effect.id)) {
        this.simFireSeen.set(effect.id, at);
        fired.push(effect.id);
      }
    }
    this.stampEffectFires(fired);
  }

  /** The active section's Effects an input fires (core's matcher — the one the engine runs). */
  private matchActiveEffects(event: effectChain.EffectInputEvent): effectChain.Effect[] {
    const section = this.activeSection;
    return section ? effectChain.matchSectionEffects({ effects: section.effects ?? EMPTY_EFFECTS }, event) : [];
  }

  /** Is this input some Sequence / Random cell's reset? Such an input must still reach the
      engine even when it fires no Effect itself — dropping it as "routes nowhere" would mean a
      reset-only zone or note never rewinds anything. */
  private isActiveCellReset(event: effectChain.EffectInputEvent): boolean {
    const section = this.activeSection;
    return !!section && effectChain.isCellReset(section, event);
  }

  /** Flash a local intent's Effects at once — except a Sequence / Random cell's, where the input
      reaches every step but only ONE plays: those flash when the engine reports the fire (the
      Sim offline, the server connected), so the ▶ marker is never a guess. */
  private stampLocalFires(fired: readonly effectChain.Effect[]): void {
    const section = this.activeSection;
    this.stampEffectFires(fired.filter((e) => !section || effectChain.cellPlayMode(section, e.cell) === 'layer').map((e) => e.id));
  }

  /** Audition Effects by id: the `fireEffect` intent connected, the Sim's engine offline. */
  private auditionEffects(effectIds: readonly string[], source: 'audition' | 'cell'): void {
    if (effectIds.length === 0) return;
    this.stampEffectFires(effectIds);
    if (this.link === 'open') {
      for (const effectId of effectIds) this.client.send({ t: 'fireEffect', effectId });
      return;
    }
    this.ensureSimShow();
    for (const effectId of effectIds) this.sim.fireEffect(effectId);
    this.addMonitor({
      type: 'effect',
      direction: 'local',
      source,
      label: effectIds.map((id) => this.effectsCtl.effectById(id)?.name ?? id).join(', '),
      detail: effectIds.map((id) => `▶ ${this.effectsCtl.effectById(id)?.name ?? id}`).join(' | '),
    });
    this.renderFrame();
    this.snapshot();
    this.markLocalPreview();
  }

  // ---- legacy import (old v1 / v2 libraries) -----------------------------------------------------

  /** An old-format library found at boot (local keys) or in the server's first `state`. */
  private legacyLibrary = $state.raw<LegacyLibrary | null>(null);
  private legacyDismissed = $state(readLegacyDismissed());

  private noteServerLegacyLibrary(showLibrary: unknown, songLibrary: unknown): void {
    if (this.legacyLibrary) return; // local wins (the freshest copy), and the first sighting sticks
    this.legacyLibrary = detectLegacyLibrary(null, { showLibrary, songLibrary });
  }

  /** Names of the old-format shows an import would still bring across. */
  get legacyShowNames(): readonly string[] {
    const lib = this.legacyLibrary;
    return lib ? pendingLegacyShowNames(lib, { shows: this.showsCtl.showLibrary, activeShowId: this.activeShowId }) : [];
  }
  /** Offer the import: an old library with shows not yet imported, not dismissed, not a viewer. */
  get legacyImportAvailable(): boolean {
    return !this.legacyDismissed && !this.isViewer && this.legacyShowNames.length > 0;
  }
  importLegacyShows(): ApplyResult {
    return this.effectsCtl.importLegacyShows();
  }
  dismissLegacyImport(): void {
    this.effectsCtl.dismissLegacyImport();
  }

  /** Import every not-yet-imported old show (and its song library) beside the current shows. The
      old data is never written or deleted; the active show stays active. Idempotent. */
  private runLegacyImport(): ApplyResult {
    if (this.isViewer) return { ok: false, reason: 'This show is read-only.' };
    const lib = this.legacyLibrary;
    if (!lib) return { ok: false, reason: 'No old shows to import.' };
    const imported = this.showsCtl.importLegacy(lib);
    if (imported.length === 0) return { ok: false, reason: 'Every old show is already imported.' };
    pushToast(`Imported ${imported.length} show${imported.length === 1 ? '' : 's'}.`, { tone: 'success' });
    this.scheduleSave();
    return { ok: true };
  }

  private dismissLegacyImportPrompt(): void {
    this.legacyDismissed = true;
    writeLegacyDismissed();
  }

  // --- lifecycle -----------------------------------------------------------

  start(): void {
    if (this.raf) return;
    this.startAutosave();
    this.wireClient();
    // Global web-error capture (#122): forward uncaught errors / rejections / console.error over the
    // socket. Fire-and-forget; `send` no-ops while the link is closed, so early-boot errors before
    // the socket opens are simply dropped (the local Monitor still shows server-echoed faults).
    this.errorCaptureUninstall = installErrorCapture((report) =>
      this.client.send({ t: 'webError', ...report }),
    );
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
      this.ensureSimShow();
      if (this.timingSource === 'midiClock' && this.clockInput === 'browser' && this.link !== 'open') {
        // Offline preview under external clock: the same reducer the server runs, fed from the
        // selected port. The sim's beat is set from the reducer (tick-counted + interpolated),
        // never accumulated from dt, so it cannot drift from the pulses.
        const snap = this.localClock.advance();
        this.localClockState = this.localClock.state;
        this.sim.bpm = snap.bpm;
        if (snap.playing) this.sim.tick(dt);
        this.sim.beat = snap.beat;
      } else {
        this.sim.bpm = this.bpm;
        if (this.playing) this.sim.tick(dt);
      }
      // Skip the sim composite while the visualiser is adopting SERVER frames — the local
      // buffer would be rendered and thrown away every frame (wave-1 finding: wasted work,
      // and a second render truth ticking in the background). The sim still ticks above so
      // the offline preview resumes instantly when the link drops.
      if (!this.useServer) this.renderFrame();
      // Capture follows edit ownership: a client that dropped to viewer releases the input.
      this.audio.enforceOwnership(this.isViewer);
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
    this.audio.dispose();
    this.clearTrackInputs();
    this.errorCaptureUninstall?.();
    this.errorCaptureUninstall = null;
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
        if (ev.on && ev.velocity > 0) {
          // Local WebMIDI never round-trips back as a server `input` echo, so record the
          // badge activity here (channel-filtered inside recordInputActivity).
          this.recordInputActivity({ kind: 'midi', note: ev.note, channel: ev.channel, value: ev.velocity, time: Date.now() });
          if (this.acceptsMidiChannel(ev.channel)) {
            // Captured before the learn applies: a map learn arm makes this press a bind only —
            // nothing fires, toggles or recalls locally (spec story 62), not even the mapping
            // the press just created.
            const learning = this.midiMapLearnArmed;
            this.midi.applyNoteLearn(ev.note);
            // Preview the fire on the local sim ONLY when offline. When connected the server is the
            // sole resolver/renderer and streams its frames/levels back — firing here as well would
            // double the hit (the echo loop). Authority principle, doc 03.
            //
            // A note bound to a global control is CONSUMED and must not fire an Effect —
            // the same precedence the server pins in `toInputEvent`, mirrored here so the two
            // modes agree on what a bound note does NOT do. The action itself stays
            // server-resolved (like Program Change / CC#0 recall), so offline it is inert.
            const consumed = globalControlForNote(this.globalControls, ev.note) !== null;
            if (!consumed && !learning && this.link !== 'open') {
              // A MIDI-map mapping takes the note next (global control > mapping > zone).
              const mapping = effectChain.matchInputMapping(this.mappings, { midiNote: ev.note });
              if (mapping) this.fireMappedMidiLocal(mapping, ev.note, ev.velocity);
              else this.fireRawMidiLocal(ev.note, ev.velocity);
            }
          }
        } else if (this.link !== 'open' && this.acceptsMidiChannel(ev.channel)) {
          // Note-off: release the `hold` Effects this note (and the zone it claims) fired.
          const claim = this.project?.inputMap.midiNotes.find((m) => m.note === ev.note);
          this.sim.releaseEffects({ note: ev.note, ...(claim ? { drumId: claim.drumId, zone: String(claim.slot) } : {}) });
        }
        this.client.send({ t: 'midi', note: ev.note, velocity: ev.velocity, on: ev.on, channel: ev.channel });
        return;
      case 'cc':
        // A CC learn (global control, Cue, map mode) binds the next incoming controller; the live
        // value feeds the offline Sim's engine so Controls and mappings track it.
        // Controller 0 is reserved for section recall and never learns/binds here.
        if (this.acceptsMidiChannel(ev.channel)) {
          const learning = this.midiMapLearnArmed;
          this.midi.applyCcLearn(ev.controller);
          // Offline there is no input echo, so a CC bypass toggle — and a CC section recall,
          // which the store must perform for the UI to follow — are applied here (linked, the
          // echo toggles and the engine recalls — see receiveInputEcho).
          if (this.link !== 'open') {
            this.performStoreOwnedInput({ midiCc: ev.controller }, voice.ccValue01(ev.value), { recall: true, learning });
          }
        }
        this.sim.setCc(ev.controller, ev.value, ev.channel);
        this.client.send({ t: 'cc', controller: ev.controller, value: ev.value, channel: ev.channel });
        return;
      case 'programChange':
        this.client.send({ t: 'programChange', value: ev.value, channel: ev.channel });
        return;
      case 'clock':
        this.receiveClock(ev);
        return;
    }
  }

  /** Reset every authored rune to the blank-document seed (via {@link seedDocumentV3}) — the clean
      baseline a show SWITCH starts from, so no field of the outgoing show survives. */
  private resetAuthoredToSeed(): void {
    this.applyAuthored(seedDocumentV3());
  }

  /** The sole document replacement boundary, including same-id server adoption. History is
      session-local to this document revision; an in-flight gesture cannot suppress its first edit. */
  private replaceDocument(show: ShowV3, source: 'loaded' | 'live'): void {
    ++this.documentGeneration;
    this.pasteFallback = null;
    this.songPasteOpen = false;
    this.history.replace(show.id);
    this.gestureDepth = 0;
    this.gesturePending = false;
    this.gestureSuppressPrev = false;
    this.suppressUndoSnapshot = false;
    // Save As snapshots the runes already live here. It changes document identity/lifetime, not
    // authored content. Only genuinely loaded documents need the seed defaults.
    if (source === 'loaded') {
      this.resetAuthoredToSeed();
      this.applyAuthored($state.snapshot(show.authored) as AuthoredStateV3);
    }
    this.sectionClipboard = null;
    this.midi.cancelLearn();
    this.osc.cancel();
    this.replaceRuntime();
    // Equal-content Save As is still a new runtime lifetime on the connected engine.
    this.engineSync.reset();
    this.syncShowToServer();
    this.syncTransport();
  }

  /** Re-instantiation, not stopAll: the existing Sim owns a private core engine (voices, sequence /
      PRNG / latch state). A fresh one releases all of it. */
  private replaceRuntime(): void {
    this.sim = new Sim();
    this.sim.pixelModel = this.labModel.pm;
    this.sim.bpm = this.bpm;
    this.sim.beatsPerBar = this.beatsPerBar;
    // A fresh Sim holds no Show: load the Effect show into its private core engine now.
    this.simShow = null;
    this.simFireSeen.clear();
    this.ensureSimShow();
    this.serverVoices = [];
    this.effectVoices = [];
    this.busLevels = {};
    this.frameBuf.fill(0);
    this.snapshot();
  }

  /** One field list for dependency tracking, history and persistence (the v3 document). Effect /
      master arrays stay LIVE references — only toAuthored/History materialize detached data, at
      their respective commit boundaries. */
  private get authoredSource(): AuthoredStateV3 {
    const out: AuthoredStateV3 = {
      songs: this.songs.map(toEffectSong),
      songRefs: this.songRefs,
      canvasScenes: this.canvasScenes,
      selectedCell: this.effectsCtl.selectedCell,
      selectedEffectId: this.effectsCtl.selectedEffectId,
      activeSongId: this.activeSongId,
      activeSectionId: this.activeSectionId,
      bpm: this.bpm,
      velocity: this.velocity,
      beatsPerBar: this.beatsPerBar,
      paneSizes: this.paneSizes,
      patchLabels: this.patchLabels,
    };
    if (this.mappings.length > 0) out.mappings = this.mappings;
    return out;
  }

  /** Materialize only at a save/flush/document-switch boundary. */
  private toAuthored(): AuthoredStateV3 {
    return $state.snapshot(this.authoredSource) as AuthoredStateV3;
  }

  /** Merge a (partial) restored v3 slice into the runes — only present fields, so a
      missing/forward field keeps its seed default. */
  private applyAuthored(a: Partial<AuthoredStateV3>): void {
    if (a.songs) this.songs = a.songs.map(toStoreSong);
    // Always assigned (even when absent) so a show that references nothing CLEARS the outgoing
    // show's refs on a swap — no cross-show bleed of references (seed/replaceDocument reset to []).
    this.songRefs = a.songRefs ?? [];
    // Always assigned (even when absent) so switching from a scene-heavy show to a
    // scene-less show clears prior scenes — no cross-show bleed.
    this.canvasScenes = a.canvasScenes ?? [];
    if (a.activeSongId !== undefined) this.activeSongId = a.activeSongId;
    if (a.activeSectionId !== undefined) this.activeSectionId = a.activeSectionId;
    // After the section pointers (re-pointing the section re-follows the selection): the
    // restored Effect selection wins, else the restored cell.
    if (a.selectedEffectId) this.effectsCtl.selectEffect(a.selectedEffectId);
    if (!a.selectedEffectId || this.effectsCtl.selectedEffectId === null) {
      if (a.selectedCell !== undefined) this.effectsCtl.selectCell(a.selectedCell);
    }
    if (typeof a.bpm === 'number') this.bpm = a.bpm;
    if (typeof a.velocity === 'number') this.velocity = a.velocity;
    if (typeof a.beatsPerBar === 'number') this.beatsPerBar = a.beatsPerBar;
    if (a.paneSizes) this.paneSizes = a.paneSizes;
    if (a.patchLabels) this.patchLabels = a.patchLabels;
    // Always assigned so a swap never inherits another show's mappings.
    this.mappings = effectChain.parseInputMappings(a.mappings).mappings;
    reserveIds(this.mappings.map((m) => m.id));
    this.bypassEdges.reset();
  }

  private pushUndoSnapshot(): void {
    if (this.restoringUndo || this.isViewer || this.suppressUndoSnapshot) return;
    // First mutation inside an open gesture (a pointer drag on a face param / slider): THIS
    // checkpoint covers the whole drag, and everything until endGesture() folds into it.
    if (this.gesturePending) {
      this.gesturePending = false;
      this.suppressUndoSnapshot = true;
    }
    const result = this.history.push(this.activeShowId, {
      authored: this.authoredSource,
      project: this.project,
    });
    if (result === 'oversized') {
      pushToast('Undo cleared: this document exceeds the 32 MiB history budget. Your edit is kept.');
    }
  }

  runUndoable<T>(edit: () => T): T {
    this.pushUndoSnapshot();
    return edit();
  }

  /** Open a continuous-edit GESTURE — a pointer drag or a wheel spin over a numeric control,
      which publishes a value on every move. Without this a single drag of a face param would
      stack one undo entry per pointermove and Cmd-Z would crawl back through the drag pixel
      by pixel. The first mutation inside the gesture takes ONE checkpoint; every later one
      folds into it (S5: one gesture = one undo, matching the G3 param-edit contract).

      Nestable, and lazy: a gesture that mutates nothing pushes nothing. Always pair with
      {@link endGesture} — the caller owns pointercancel / lostpointercapture too, since an
      unclosed gesture would swallow later checkpoints. */
  beginGesture(): void {
    if (this.isViewer) return; // read-only viewer (S2): authoring no-op
    if (this.gestureDepth === 0) {
      // An enclosing batchIntoCurrentUndo already owns suppression — don't take a checkpoint
      // inside it, and restore ITS flag on close.
      this.gestureSuppressPrev = this.suppressUndoSnapshot;
      this.gesturePending = !this.suppressUndoSnapshot;
    }
    this.gestureDepth += 1;
  }

  /** Close the gesture opened by {@link beginGesture}. Extra calls are ignored, so a
      pointerup that races a pointercancel cannot re-open undo mid-drag. */
  endGesture(): void {
    if (this.gestureDepth === 0) return;
    this.gestureDepth -= 1;
    if (this.gestureDepth === 0) {
      this.gesturePending = false;
      this.suppressUndoSnapshot = this.gestureSuppressPrev;
    }
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
    const prev = this.history.pop(this.activeShowId);
    if (!prev) return false;
    this.restoringUndo = true;
    this.resetAuthoredToSeed();
    this.applyAuthored(structuredClone(prev.authored));
    this.replaceRuntime();
    // Restore the authoritative project slice (routing/geometry/IO) and re-send only the granular
    // edits whose slice actually moved, so the engine converges — a trigger-only undo leaves the
    // project untouched and sends nothing.
    const resync = projectResyncMessages(this.project, prev.project);
    if (resync.length > 0) {
      this.project = structuredClone(prev.project);
      for (const msg of resync) this.client.send(msg);
    }
    this.snapshot();
    this.restoringUndo = false;
    return true;
  }

  /** Subscribe without cloning/serializing. Active document and canonical pool have independent
      subscriptions; a drag never traverses inactive shows or the pool. Snapshots are deferred. */
  private startAutosave(): void {
    if (this.persistDispose || typeof localStorage === 'undefined') return;
    this.persistDispose = $effect.root(() => {
      let authoredMounted = false;
      let poolMounted = false;
      $effect(() => {
        this.showsCtl.trackLibraryChanges();
        trackDocument(this.authoredSource);
        this.scheduleSave(authoredMounted);
        authoredMounted = true;
      });
      $effect(() => {
        this.showsCtl.trackSongLibraryChanges();
        this.scheduleSave(poolMounted);
        poolMounted = true;
      });
    });
    if (typeof window !== 'undefined') {
      // Always read NOW: beforeunload can precede the effect that marks the last edit dirty.
      this.flushOnUnload = () => this.flushSave(false);
      window.addEventListener('beforeunload', this.flushOnUnload);
    }
  }

  /** Flush any pending write and tear down the autosave effect (on stop/unmount),
      so edits in the last debounce window are not lost. */
  private stopAutosave(): void {
    if (!this.persistDispose) return;
    this.flushSave(false);
    this.persistDispose();
    this.persistDispose = null;
    if (this.flushOnUnload && typeof window !== 'undefined') {
      window.removeEventListener('beforeunload', this.flushOnUnload);
      this.flushOnUnload = null;
    }
    // Cancel any pending indicator transition and re-arm the mount guard for a future start().
    this.saveStatusCtl.dispose();
  }

  private scheduleSave(edited = true): void {
    if (edited) this.saveStatusCtl.saving();
    if (this.saveTimer) clearTimeout(this.saveTimer);
    this.saveTimer = setTimeout(() => this.flushSave(), SAVE_DEBOUNCE_MS);
  }

  /** One materialization per library per burst, shared by local cache and server push. A timer
      holds no document references, so a replacement during the debounce cannot save the old show.
      Unload/stop remain synchronous local-only durability boundaries (WS delivery isn't awaitable). */
  private flushSave(syncServer = true): void {
    if (this.saveTimer) clearTimeout(this.saveTimer);
    this.saveTimer = null;
    const shows = serializeShowLibraryV3(this.showsCtl.currentLibrary());
    const songs = serializeSongLibraryV2(this.showsCtl.currentSongLibrary());
    const showSaved = writeStoredLibrary(shows);
    const songsSaved = writeStoredSongLibrary(songs);
    if (syncServer) {
      this.syncShowToServer();
      this.showsCtl.syncLibraryToServer(shows);
      this.showsCtl.syncSongLibraryToServer(songs);
    }
    if (showSaved && songsSaved) this.saveStatusCtl.saved();
    else {
      this.saveStatusCtl.failed();
      pushToast('Could not save locally. Free storage and try Save again.');
    }
  }

  // Show CRUD (new/open/save/save-as/rename/delete/close) + song-library refs (export/import/
  // detach/rename/delete/usedBy) live on {@link showsCtl} (R23); the store exposes them as thin
  // forwarders alongside its field. Document replacement and persistence commits stay here,
  // reached through the injected replaceDocument / saveNow host boundary.

  // --- engine link plumbing ------------------------------------------------

  /** Attach the WS callbacks (idempotent — start() may be called after a stop). */
  private wireClient(): void {
    this.client.on({
      onState: (project, model, _effects, _projects, output, showLibrary, songLibrary, tunnel, osc, showRevision = 0, activeSongId, activeSectionId, recallSequence = 0, sessionId = 'legacy') => {
        // Input lifetime follows the server boot, independently of recall/library adoption.
        if (this.trackInputSessionId !== sessionId) {
          this.clearTrackInputs();
          this.trackInputSessionId = sessionId;
        }
        // adopt the authoritative Project (routing/geometry/IO) AND the engine's real
        // kit model so its frames map 1:1 in the preview (the server runs its own kit
        // geometry/pixel count, not the lab kit).
        if (this.project?.inputMap.trackAudioInput !== project.inputMap.trackAudioInput) this.sim.setAudio(voice.ZERO_AUDIO_FRAME);
        this.project = project;
        if (project.inputMap.trackAudioInput) this.audio.stop();
        this.serverModel = model;
        // adopt the server's output truth (arming/packets/error) so the OutputPill AND the S03
        // output status panel are honest from the first handshake, before the first stats tick lands.
        this.output = output;
        // remote-access surface (share URL + PIN) for the host UI
        this.tunnel = tunnel;
        // where a third-party OSC sender should aim, and whether the socket is actually bound
        this.oscListen = osc;
        if (activeSongId !== undefined && activeSectionId !== undefined) {
          this.receiveAuthoritativeRecall({
            sessionId,
            showRevision,
            recallSequence,
            songId: activeSongId,
            sectionId: activeSectionId,
          }, 'state');
        }
        // Cold-load reconcile of BOTH server-authoritative libraries (show library + canonical song
        // pool): adopt server on first state / seed it from our cache / viewer live-follows. Role-
        // aware (S1) — presence arrives before this state on a (re)connect, so `isViewer` is settled.
        // Owned by {@link ShowsController} (R23).
        // An OLD-format server library (v1/v2) is never adopted by the v3 reconcile below — it is
        // offered for import instead. Stash it BEFORE the reconcile seeds the server with v3.
        this.noteServerLegacyLibrary(showLibrary, songLibrary);
        this.showsCtl.reconcileOnState(showLibrary, songLibrary);
        this.tryApplyPendingRecall();
      },
      onTrackInputs: (status) => {
        const active = status.status === 'listening' ? status.inputs.filter((input) => input.connected) : [];
        for (const id of this.trackOscKeys.keys()) {
          if (!active.some((input) => input.id === id)) this.clearTrackOscInput(id);
        }
        this.trackInputs = status;
        const id = this.project?.inputMap.trackAudioInput;
        if (id) this.sim.setAudio(active.find((input) => input.id === id && input.kind === 'audio')?.audio ?? voice.ZERO_AUDIO_FRAME);
      },
      onRecalled: (songId, sectionId, showRevision, recallSequence, sessionId = 'legacy') => {
        this.receiveAuthoritativeRecall({ sessionId, showRevision, recallSequence, songId, sectionId }, 'recalled');
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
        this.tryApplyPendingRecall();
      },
      onSongLibrary: (library) => {
        // Live SONG-library push from the editor, relayed by the server — the sibling of
        // onShowLibrary. Only a viewer follows it. Owned by {@link ShowsController}.
        this.showsCtl.followSongLibrary(library);
        this.tryApplyPendingRecall();
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
      onNetworkAdapters: (adapters) => {
        // The server enumerated its NICs — used to recommend which subnet/IP to set the PixLite to.
        this.monitor.ingestNetworkAdapters(adapters);
      },
      onBackups: (items) => {
        // Reply to listBackups (#123) — the local snapshot listing the Backups dialog renders.
        this.backups = items;
      },
      onAuthError: () => {
        // Server refused our room PIN (close 4401). Surface the PIN-entry gate; the reconnect
        // loop is paused in the client until submitPin() supplies one.
        this.authRequired = true;
        this.authFailCount += 1;
        this.link = 'offline';
        this.clearTrackInputs();
      },
      onConnection: (state: ConnectionState) => {
        // map the client's 'closed' to the lab's 'offline'; others pass through
        this.link = state === 'closed' ? 'offline' : state;
        if (state === 'open') {
          // A successful handshake means any PIN we sent was accepted — clear the gate.
          this.authRequired = false;
          // hand the server the authored content (with library refs resolved in), then transport
          const show = this.effectsShow;
          this.client.send({ t: 'setShow', show });
          this.engineSync.baselineShow(show); // baseline so the first sync tick is a no-op
          const cur = { bpm: this.bpm, playing: this.playing, beatsPerBar: this.beatsPerBar };
          this.engineSync.baselineTransport(cur);
          this.client.send({ t: 'setTransport', ...cur });
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
          // A dropped link cannot confirm the server's clock: forget it (offline the panel
          // reads the local reducer, or shows waiting for a native selection).
          this.serverClock = null;
          this.clearTrackInputs();
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
        // External clock truth rides the stats stream (100Hz). Only assign on a real change so
        // the derived panel state is not invalidated every tick.
        const clock = voice?.clock ?? null;
        const prev = this.serverClock;
        if (
          (clock === null) !== (prev === null) ||
          (clock && prev && (clock.status !== prev.status || clock.locked !== prev.locked || clock.playing !== prev.playing || Math.abs(clock.bpm - prev.bpm) >= 0.05))
        ) {
          this.serverClock = clock;
        }
      },
      onFrame: (frame) => {
        this.serverFrame = frame;
      },
      onInput: (input) => this.receiveInputEcho(input),
      // Server-side rejection (e.g. an invalid patch paste — S45): surface it as a dismissible
      // notice so the failure is user-visible rather than silent.
      onError: (message) => {
        this.serverError = message;
      },
      onMonitor: (event) => {
        this.addMonitor(event);
        // Connected, the server reports every Effect its engine fired (`effect:<id>`): flash it.
        // That is the only source for a Sequence / Random cell, whose step only the engine knows.
        const fired = serverFiredEffectId(event);
        if (fired) this.stampEffectFires([fired]);
      },
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
  private receiveInputEcho({ kind, label, value, note, controller, channel, drumId, modulationOnly, trackInputId }: InputEcho): void {
    const time = Date.now();
    // The echo's `value` is the RAW input, before the drum's sensitivity curve — exactly the
    // x a velocity-curve editor plots. Connected, this is the ONLY place hits are recorded
    // (the local fire paths stay quiet), so a stick hit plots once.
    this.recordVelocityHit(drumId, value);
    if (kind === 'midi' && note !== undefined) {
      const velocity = Math.round(Math.max(0, Math.min(1, value)) * 127);
      this.recordInputActivity({ kind: 'midi', note, channel, value: velocity, time });
      if (value > 0 && this.acceptsMidiChannel(channel)) {
        const learning = this.midiMapLearnArmed;
        this.midi.applyNoteLearn(note);
        this.performStoreOwnedInput({ midiNote: note }, value, { learning });
      }
    } else if (kind === 'midi' && controller !== undefined) {
      // A CC echo (value normalised 0..1): CC learn from any source, like notes above, and the
      // linked half of a CC bypass toggle. Re-learning a local CC the forward already bound is a
      // no-op (the arm cleared, or map mode re-binds the same source).
      if (this.acceptsMidiChannel(channel)) {
        const learning = this.midiMapLearnArmed;
        this.midi.applyCcLearn(controller);
        this.performStoreOwnedInput({ midiCc: controller }, value, { learning });
      }
    } else if (kind === 'osc') {
      // For OSC the wire `label` carries the address (see server broadcastJson). Named zero
      // values retire BOTH the signal and badge, rather than leaving zero-valued tombstones.
      if (trackInputId !== undefined) {
        if (value === 0) {
          // This is a new zero-valued event, not a local ownership sweep. Match the server's
          // last-event-wins table even if ordinary OSC last wrote this exact address.
          this.forgetTrackOscOwnership(label);
          this.clearOscMirror(label);
          return;
        }
        this.ownTrackOscKey(trackInputId, label);
      } else {
        // The most recent ordinary input owns its value, even at a formerly named address.
        this.forgetTrackOscOwnership(label);
      }
      this.recordInputActivity({ kind: 'osc', address: label, value, time });
      // Dedicated value/release echoes cannot author trigger bindings. Ordinary OSC keeps its
      // existing Learn contract, including a fader first heard at zero.
      if (!modulationOnly) {
        const learning = this.oscMapLearnArmed;
        this.osc.apply(label);
        this.performStoreOwnedInput({ oscAddress: label }, value, { learning });
      }
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
        return { type: 'graph', direction: 'out', source: 'web', destination: 'server', label: 'Set show', detail: `${countShowEffects(msg.show)} Effects` };
      default:
        return { type: 'system', direction: 'out', source: 'web', destination: 'server', label: msg.t };
    }
  }

  /** The engine's Show source with library references RESOLVED IN (S42): the sent Show carries the
      referenced songs' sections (namespaced, collision-free) so the engine can
      recallSection + fire a referenced section. Persistence (`toAuthored`) is untouched — it still
      stores refs, not copies — so canonical propagation survives a reload. `sections` already resolves
      via {@link activeSong}. */
  private get showSource(): EffectsShowSource {
    return {
      songs: this.songs.map(toEffectSong),
      songRefs: this.songRefs,
      canvasScenes: this.canvasScenes,
      mappings: this.mappings,
      songLibrary: this.songLibrary.songs,
    };
  }

  /** The runtime Show (core `buildRuntimeShow`), memoized on the authored document: a `$derived`
      re-runs only after an authored field it read changed, so a drag that republishes the same
      value, or a render frame, never rebuilds it. `buildEffectsShow` snapshots the source. */
  private effectsShowBuild = $derived.by(() => buildEffectsShow(this.showSource));
  private get effectsShow(): voice.Show {
    return this.effectsShowBuild.show;
  }

  private syncShowToServer(): void {
    if (this.link !== 'open' || this.isViewer) return; // a viewer follows the editor — never authors up
    const show = this.effectsShow;
    if (!this.engineSync.planShowPush(show)) return;
    this.client.send({ t: 'setShow', show });
  }

  /** The Show the offline Sim's Effect path last loaded (identity of the memoized build). */
  private simShow: voice.Show | null = null;
  /** Load the current Effect show into the offline Sim when it changed since the last load.
      Called before every offline input and each rendered frame, so edits coalesce to one load
      per frame and an input always meets the current show. The active section rides along so
      the engine recalls it (its Always Effects and Master chain). */
  private ensureSimShow(): void {
    const show = this.effectsShow;
    if (show === this.simShow) return;
    this.simShow = show;
    this.sim.setEffectShow(show, { songId: this.activeSongId || null, sectionId: this.activeSectionId });
  }

  private receiveAuthoritativeRecall(recall: AuthoritativeRecall, source: 'state' | 'recalled'): void {
    if (source === 'recalled' && this.recallSessionId !== null && this.recallSessionId !== recall.sessionId) return;
    if (this.recallSessionId !== recall.sessionId) {
      // A server restart invalidates every numeric revision and sequence from the old process.
      this.recallSessionId = recall.sessionId;
      this.appliedRecall = null;
      this.pendingRecall = null;
    }
    const newestKnown = this.pendingRecall ?? this.appliedRecall;
    if (newestKnown && compareRecallIdentity(recall, newestKnown) <= 0) return;
    this.pendingRecall = recall;
    // A state handshake is only staged here. Its library may replace the active document below;
    // applying it now would be immediately overwritten by adoptLibrary()/activateDocument().
    // Accepted recall messages can apply immediately because they arrive after the document is
    // already live. The state handler retries after both libraries have reconciled.
    if (source === 'recalled') this.tryApplyPendingRecall();
  }

  private tryApplyPendingRecall(): void {
    const recall = this.pendingRecall;
    if (!recall || recall.sessionId !== this.recallSessionId) return;
    const song = recall.songId === null ? null : this.resolvedSongs.find((candidate) => candidate.id === recall.songId);
    if (recall.songId !== null && !song) return;
    if (song && recall.sectionId === null && song.sections.length > 0) return;
    if (song && recall.sectionId !== null && !song.sections.some((section) => section.id === recall.sectionId)) return;

    // A null section is valid for a real zero-section song. A null song is the legacy top-level
    // section/no-selection identity and is represented by the store's empty id.
    this.activeSongId = song?.id ?? '';
    this.activeSectionId = recall.sectionId;
    this.appliedRecall = recall;
    this.pendingRecall = null;
  }

  // The server-authoritative library adopt + write-through (cold-load reconcile / viewer follow /
  // sig-guarded push, for BOTH the show library and the canonical song pool) lives on
  // {@link showsCtl} (R23) — driven from the `state`/`showLibrary`/`songLibrary` handlers above and
  // the autosave tick. Only the engine SHOW push ({@link syncShowToServer}, resolved-in refs) stays.

  /**
   * Adopt a server-side bpm change (tap tempo, global control 9).
   *
   * NOT WIRED — kept because tap tempo needs it and the wiring is one line, but WHERE it
   * hangs is an open product decision for Trent (see the PR notes).
   *
   * The problem: `bpm` is authored state. The active SHOW owns it — `showsCtl` adopts the
   * show's tempo on cold load and `syncTransport` pushes it up — so tap tempo's
   * server-side change is re-asserted away by a connected editor on the next state
   * broadcast. Calling this from the `state` handler closes the tap-tempo loop but makes
   * the server's project transport beat the show's tempo on EVERY broadcast, which breaks
   * per-show tempo (6 `store.server-library` tests pin that behaviour, and they are
   * right).
   *
   * The two coherent answers are "tap tempo sets the active show's tempo" (authored, needs
   * a server→client signal) or "the server transport is authoritative while connected"
   * (a real change to who owns tempo). That is Trent's call, not a default to guess.
   */
  private adoptServerBpm(bpm: number): void {
    if (!Number.isFinite(bpm) || bpm <= 0 || bpm === this.bpm) return;
    this.bpm = bpm;
    this.engineSync.baselineTransport({ bpm, playing: this.playing, beatsPerBar: this.beatsPerBar });
  }

  /** Send setTransport to the server iff bpm/playing/beatsPerBar changed. */
  private syncTransport(): void {
    if (this.link !== 'open' || this.isViewer) return; // a viewer follows the editor — never authors up
    const cur = { bpm: this.bpm, playing: this.playing, beatsPerBar: this.beatsPerBar };
    if (!this.engineSync.planTransportPush(cur)) return;
    this.client.send({ t: 'setTransport', ...cur });
  }

  private lastVoiceStatsAt = -Infinity;

  private snapshot(): void {
    if (this.link !== 'open') {
      const now = nowMs();
      if (now - this.lastVoiceStatsAt >= EFFECT_STATS_INTERVAL_MS) {
        this.lastVoiceStatsAt = now;
        this.effectVoices = this.sim.effectVoiceStats();
        // Bus meters follow the same authority rule as the voice list: the server owns them when
        // connected (streamed via onStats), so only publish the Sim's levels while offline.
        this.busLevels = busLevelsOf(this.effectVoices);
      }
      this.pollSimEffectFires();
    }
    this.log = this.sim.log.slice(0, 40);
    this.timeMs = this.sim.timeMs;
    this.beat = this.sim.beat;
  }

  private addMonitor(event: Omit<MonitorEvent, 'id' | 'time'> | MonitorEvent): void {
    const full: MonitorEvent = { id: this.monitorSeq++, time: Date.now(), ...event };
    this.monitorEvents = appendMonitorEvent(this.monitorEvents, full);
  }

  clearMonitor(): void {
    this.monitorEvents = [];
  }

  /** Surface a client-side editor fault on the Monitor as an `error` event, so a live-show
      failure is visible in the Monitor timeline instead of failing silently. `source` groups the
      fault, `label` names it, `detail` carries the message. */
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

  /**
   * Offline: a note-on a MIDI-map mapping takes. The Sim's core engine performs fires and
   * continuous targets (it consumes the note before zones, as the server does), so the zone
   * Effects the note would otherwise claim are never pre-resolved here. A section recall is the
   * store's (so the UI follows it), and so is a bypass toggle.
   */
  private fireMappedMidiLocal(mapping: effectChain.InputMapping, note: number, value: number): void {
    const target = mapping.target;
    if (target.kind === 'bypass') {
      this.performStoreOwnedInput({ midiNote: note }, 1);
      return;
    }
    if (target.kind === 'recallSection') {
      this.performDiscreteMapping(target);
      return;
    }
    this.ensureSimShow();
    this.sim.hitEffects({ note, velocity: Math.max(0, Math.min(1, value / 127)) });
    const fired = target.kind === 'fireEffect'
      ? [target.effectId]
      : target.kind === 'fireCell'
        ? this.effectsCtl.cellEffects(target.cell).map((e) => e.id)
        : [];
    if (fired.length > 0) this.stampEffectFires(fired);
    this.renderFrame();
    this.snapshot();
    this.markLocalPreview();
  }

  private fireRawMidiLocal(note: number, value: number): void {
    const claim = this.project?.inputMap.midiNotes.find((m) => m.note === note);
    const raw = Math.max(0, Math.min(1, value / 127));
    // Offline the local sim IS the engine, so this path is both the echo and the fire.
    this.recordVelocityHit(claim?.drumId, raw);
    const input = { drumId: claim?.drumId, slot: claim?.slot, midiNote: note };
    const fired = this.matchActiveEffects(input);
    if (fired.length === 0 && !this.isActiveCellReset(input)) return;
    this.stampLocalFires(fired);
    this.ensureSimShow();
    this.sim.hitEffects({
      ...(claim ? { drumId: claim.drumId, zone: String(claim.slot) } : {}),
      note,
      velocity: this.shapeVelocity(claim?.drumId, raw),
    });
    this.addMonitor({
      type: 'effect',
      direction: 'local',
      source: `midi:${note}`,
      label: fired.length > 0 ? fired.map((e) => e.name).join(', ') : 'Sequence reset',
      detail: fired.map((e) => `▶ ${e.name}`).join(' | '),
    });
    this.renderFrame();
    this.snapshot();
    this.markLocalPreview();
  }

  // --- play surface --------------------------------------------------------

  /** A pad hit on the Effect path: the active section's zone Effects on this drum + slot fire.
      Connected, the server resolves (the `key` intent); offline the Sim's core engine does. */
  hit(pad: Pad): void {
    // Live feedback for the velocity editor, before the routing checks below: a hit on a pad
    // that routes nowhere is still a hit worth plotting while tuning. Connected, the server's
    // `key` echo carries this same pair, so recording here too would double-plot it.
    if (this.link !== 'open') this.recordVelocityHit(pad.drumId, this.velocity);
    const input = { drumId: pad.drumId, slot: Number(pad.zone) };
    const fired = this.matchActiveEffects(input);
    if (fired.length === 0 && !this.isActiveCellReset(input)) return;
    // Fire flashes react to the local intent, online and offline (display-only).
    this.stampLocalFires(fired);
    if (this.link === 'open') {
      this.client.send({ t: 'key', drumId: pad.drumId, zone: String(pad.zone), velocity: this.velocity });
      return;
    }
    this.ensureSimShow();
    this.sim.hitEffects({ drumId: pad.drumId, zone: String(pad.zone), velocity: this.shapeVelocity(pad.drumId, this.velocity) });
    this.addMonitor({
      type: 'effect',
      direction: 'local',
      source: `${pad.drumId}:${pad.zone}`,
      label: fired.length > 0 ? fired.map((e) => e.name).join(', ') : 'Sequence reset',
      detail: fired.map((e) => `▶ ${e.name}`).join(' | '),
    });
    this.renderFrame();
    this.snapshot();
    this.markLocalPreview();
  }

  togglePlay(): void {
    this.playing = !this.playing;
  }

  /** Release every live voice — the Sim offline, the server's engine when linked. */
  panic(): void {
    this.sim.stopAll();
    if (this.link === 'open') this.client.send({ t: 'releaseBus' });
    this.snapshot();
  }

  // --- active section (U4: merged look-recall + arrange focus) -------------

  /**
   * Activate a section of the active song — it becomes the one you're PLAYING and the one you're
   * EDITING (U4 merged the old recall and arrange focus). Sets `activeSectionId` and recalls it:
   * the engine replaces the Always Effects and the Master chain.
   */
  setActiveSection(sectionId: string): void {
    if (!this.activeSongById?.sections.some((s) => s.id === sectionId)) return;
    this.activeSectionId = sectionId;
    // Offline preview only: when connected the server engine recalls the section itself, so
    // recalling the Sim too would double-spawn. Mirror the outbound authority gate (S12).
    if (this.link !== 'open') {
      // The show must already hold this section, so load the current one first.
      this.ensureSimShow();
      this.sim.recallSection(sectionId, this.activeSongId || null);
      this.snapshot();
    }
    if (this.link === 'open') {
      this.client.send({ t: 'recallSection', songId: this.activeSongId, sectionId });
    }
  }

  /**
   * Keep the Effects selection inside the section on show. Runs whenever the active section is
   * re-pointed (chip, arrows, recall, song switch, section add/paste/remove): the selected CELL is
   * a grid coordinate, valid in every section — keep it and re-select that cell's first Effect in
   * the new section (a Master selection stays).
   */
  private followActiveSection(): void {
    const cell = this.effectsCtl.selectedCell;
    if (cell !== null && cell !== MASTER_CELL) this.effectsCtl.selectCell(cell);
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
    if (this.project) {
      this.pushUndoSnapshot();
      this.project = routing.applyDrumTransform(this.project, drumId, partial);
    }
    this.client.send({ t: 'setKitTransform', drumId, ...partial });
  }

  /** Set the kit-global mirror (S11): a geometry-only world reflection (none/x/y). Kit-wide,
   * not per-drum — applies live to the whole model and persists with the project. */
  setKitMirror(mirror: 'none' | 'x' | 'y'): void {
    if (this.isViewer) return; // read-only viewer (S2): authoring no-op
    if (this.project) {
      this.pushUndoSnapshot();
      this.project = routing.applyKitGlobal(this.project, { mirror });
    }
    this.client.send({ t: 'setKitGlobal', mirror });
  }

  /** Edit any kit-global field (C1/C2): expanded output mode, LED density, hoop count, default
   * hoop spacing, max pixels/output — and mirror. Kit-wide; optimistic-writes kit.global and
   * forwards only the edited fields over WS. (setKitMirror is the mirror-only convenience form.) */
  setKitGlobal(partial: routing.KitGlobalPartial): void {
    if (this.isViewer) return; // read-only viewer (S2): authoring no-op
    if (this.project) {
      this.pushUndoSnapshot();
      this.project = routing.applyKitGlobal(this.project, partial);
    }
    this.client.send({ t: 'setKitGlobal', ...partial });
  }

  /** Edit one hoop's pixel count / reverse flag (C5, B4 first-class hoops[]). `hoopIndex` is
   * 1-based (A1). Optimistic-writes drum.hoops[hoopIndex-1] and forwards over WS; a no-op write
   * locally when the drum/hoop is unknown (the server-apply backstop rejects the same). */
  setHoopConfig(drumId: string, hoopIndex: number, partial: routing.HoopConfigPartial): void {
    if (this.isViewer) return; // read-only viewer (S2): authoring no-op
    if (this.project) {
      this.pushUndoSnapshot();
      this.project = routing.applyHoopConfig(this.project, drumId, hoopIndex, partial);
    }
    this.client.send({ t: 'setHoopConfig', drumId, hoopIndex, ...partial });
  }

  /** Replace the physical-output topology (a Patch graph rewire → PixLite patch order). */
  setRouting(outputs: OutputConfig[]): void {
    if (this.isViewer) return; // read-only viewer (S2): authoring no-op
    if (this.project) {
      this.pushUndoSnapshot();
      this.project = routing.applyRouting(this.project, outputs);
    }
    this.client.send({ t: 'setKitOutputs', outputs });
  }

  /** Persist the patch-graph canvas layout (D1: `kit.nodeLayout`) — a manual, server-authoritative
      per-node arrangement, synced across clients. Geometry-only (no DMX / render impact). */
  setNodeLayout(nodeLayout: NodeLayout): void {
    if (this.isViewer) return; // read-only viewer (S2): authoring no-op
    if (this.project) this.project = routing.applyNodeLayout(this.project, nodeLayout);
    this.client.send({ t: 'setKitNodeLayout', nodeLayout });
  }

  /** Who uses a drum zone (the zone-delete guard + the zones list): every Effect in that zone's
      cell, in any show (the live one, inactive ones) or library song — `"<Effect> · <section>"`. */
  zoneEffectUsers(drumId: string, slot: number): string[] {
    const songs: { sections: readonly { name: string; effects?: readonly effectChain.Effect[] }[] }[] = [
      ...this.songs,
      ...Object.values(this.showsCtl.showLibrary).filter((show) => show.id !== this.activeShowId).flatMap((show) => show.authored.songs ?? []),
      ...Object.values(this.songLibrary.songs),
    ];
    const users = new Set<string>();
    for (const song of songs) for (const section of song.sections) {
      for (const effect of section.effects ?? []) {
        if (effect.cell.row === drumId && effect.cell.column.kind === 'zone' && effect.cell.column.slot === slot) {
          users.add(`${effect.name || effect.generator.kind} · ${section.name}`);
        }
      }
    }
    return [...users];
  }

  /**
   * Replace the input map (zone-node MIDI note / OSC address routing).
   *
   * BINDING GUARD: the zone map and the global controls are both edited by replacing this
   * map, so this is the gate for both. A write that would put a note/CC/address where
   * another GROUP already has one is refused whole — see `binding-claims`. Refusing here
   * rather than in each editor is what keeps the rule identical for typed values, MIDI
   * Learn, and OSC Learn, all of which land on this one method.
   *
   * Returns whether the write was ACCEPTED. A refusal is TOTAL — no local write and no WS
   * message — because a guard that blocked the optimistic write but still sent would leave
   * the rig holding a binding the editor says it does not have.
   */
  setInputMap(inputMap: InputMap): boolean {
    if (this.isViewer) return false; // read-only viewer (S2): authoring no-op
    if (this.project) {
      for (const drum of this.project.kit.drums) {
        const remaining = zoneSlotsForDrum(inputMap, drum.id);
        for (const slot of zoneSlotsForDrum(this.project.inputMap, drum.id)) {
          if (remaining.includes(slot)) continue;
          const users = this.zoneEffectUsers(drum.id, slot);
          if (users.length) {
            pushToast(`Remove this zone’s Effects before deleting it: ${users.join(', ')}`, { tone: 'error' });
            return false;
          }
        }
      }
      if (this.refuseBindings(voice.inputMapBindingRejections(this.project.inputMap, inputMap, { mappings: this.mappings }))) {
        return false;
      }
      this.pushUndoSnapshot();
      this.project = routing.applyInputMap(this.project, inputMap);
    }
    this.client.send({ t: 'setInputMap', inputMap });
    return true;
  }

  /**
   * Toast the first rejection and report whether the caller must abort. Centralised so
   * every guarded path refuses in the same voice, and so the "no rejections" case is a
   * single cheap `false`.
   */
  private refuseBindings(rejections: readonly voice.BindingRejection[]): boolean {
    const first = rejections[0];
    if (!first) return false;
    pushToast(bindingRejectionMessage(first, this.drums), { tone: 'error' });
    return true;
  }

  setMidiChannel(channel: number | null): void {
    if (this.isViewer || !this.project) return;
    this.setInputMap({ ...this.project.inputMap, midiChannel: channel });
  }

  /** A beat-clock message from a WebMIDI port. The selected port owns the clock: its pulses feed
      the offline reducer (so the preview follows offline) and, when the link is open and we are
      the editor, ride the link as `midiClock` — never Monitor-logged, never persisted. Any other
      port's clock is dropped here so two clocks can never combine. */
  private receiveClock(ev: MidiClockEvent): void {
    const ctx = { source: this.timingSource, clockInput: this.clockInput, deviceId: this.clockDeviceId, isViewer: this.isViewer };
    if (!shouldForwardClock(ev, ctx)) return;
    this.localClock.apply(ev);
    this.localClockState = this.localClock.state;
    if (this.link === 'open') {
      this.client.send({ t: 'midiClock', command: ev.command, ...(ev.command === 'position' ? { position: ev.position } : {}) });
    }
  }

  /** Timing source (Manual / MIDI Clock). Persisted on the server project's transport (editor-
      only, like every setTransport). Switching to Manual leaves the authored bpm/playing exactly as
      they are — the manual transport controls remain the explicit way to set tempo. */
  setTimingSource(source: TransportSource): void {
    if (this.isViewer || !this.project) return;
    if (source === this.timingSource) return;
    this.localClock.reset(this.bpm);
    this.localClockState = this.localClock.state;
    this.client.send({ t: 'setTransport', source });
    // Optimistic: the state broadcast confirms it, but the panel should not lag a round trip.
    this.project = { ...this.project, composition: { ...this.project.composition, transport: { ...this.project.composition.transport, source } } };
  }

  /** Clock input from the picker value (`native` or `browser:<port>`): the route goes to the
      server, the port stays on this machine. */
  setClockInput(value: string): void {
    if (this.isViewer || !this.project) return;
    const { clockInput, deviceId } = parseClockInputValue(value);
    this.clockDeviceId = deviceId;
    writeStoredClockDevice(deviceId);
    this.localClock.reset(this.bpm);
    this.localClockState = this.localClock.state;
    if (clockInput !== this.clockInput) {
      this.client.send({ t: 'setTransport', clockInput });
      this.project = { ...this.project, composition: { ...this.project.composition, transport: { ...this.project.composition.transport, clockInput } } };
    }
  }

  /** Adopt the clock's last tempo as the authored manual tempo — the explicit recovery path
      after switching back to Manual (or to freeze the DAW's tempo into the show). Goes through the
      ordinary `bpm` field, so it syncs like any tempo edit. */
  adoptClockBpm(): void {
    const bpm = Math.round(this.clockStatus.bpm * 10) / 10;
    if (this.isViewer || !Number.isFinite(bpm) || bpm <= 0) return;
    this.bpm = bpm;
  }

  startMidiLearn(target: MidiLearnTarget): void {
    this.midi.startLearn(target);
  }

  cancelMidiLearn(): void {
    this.midi.cancelLearn();
  }

  startOscLearn(target: OscLearnTarget): void {
    this.osc.start(target);
  }

  cancelOscLearn(): void {
    this.osc.cancel();
  }

  /** The app-general control bindings, or an empty map before a project loads. */
  get globalControls(): GlobalControls {
    return this.project?.inputMap.globalControls ?? {};
  }

  /**
   * Write one global control's binding. Routes through {@link setInputMap} — the single
   * mutation path — so the viewer guard, the undo snapshot, and the WS resync all apply
   * exactly as they do for a zone's note. A field set to `undefined` clears it.
   */
  setGlobalControlBinding(action: GlobalControlAction, patch: GlobalControlBinding): boolean {
    if (this.isViewer || !this.project) return false;
    const inputMap = this.project.inputMap;
    return this.setInputMap({
      ...inputMap,
      globalControls: withGlobalControlBinding(inputMap.globalControls, action, patch),
    });
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
      // Newest OSC packet on any address — the transport-level "something is arriving" proof.
      this.lastOscHeard = activity;
    }
  }

  /** Last-heard badge for the OSC transport as a whole: whatever address arrived most recently,
      whether or not anything is bound to it. Null until the first OSC packet lands. */
  get oscHeardBadge(): InputBadgeView | null {
    const hit = this.lastOscHeard;
    if (!hit?.address) return null;
    return deriveInputBadge({ kind: 'osc', address: hit.address }, this.inputActivity, this.nowTick);
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
    if (this.project) {
      this.pushUndoSnapshot();
      this.project = routing.applyOutput(this.project, partial);
    }
    this.client.send({ t: 'setOutput', ...partial });
  }

  // --- PixLite controller monitor + test (S48/S49, group L) -----------------
  // Public API preserved as thin forwarders onto {@link monitor} (R20) and {@link controllerTest}
  // (R22) — the store split. The domain docs + gating live on those controllers; these keep the
  // store's call surface unchanged.

  watchController(watching: boolean): void {
    this.monitor.watch(watching);
  }

  /** The server machine's network adapters (NICs) + a recommended controller IP each. See
      {@link ControllerMonitor.adapters}. */
  get networkAdapters(): NetworkAdapter[] {
    return this.monitor.adapters;
  }

  // --- project backups (#123) ----------------------------------------------

  /** Ask the server for the current snapshot list (a pure read — a viewer may refresh too). No-op
      when the link is down; the reply lands on {@link backups} via the `onBackups` callback. */
  refreshBackups(): void {
    if (this.link !== 'open') return;
    this.client.send({ t: 'listBackups' });
  }

  /** Restore a local snapshot by id (#123). The server takes a pre-risk snapshot of current state,
      atomically replaces all three blobs, and cold-loads every client — so the whole app follows.
      Editor-only (an authoring mutation); a no-op for a viewer or an offline link. */
  restoreBackup(id: string): void {
    if (this.link !== 'open' || this.isViewer) return;
    this.client.send({ t: 'restoreBackup', id });
  }

  /** The featured adapter for the controller recommendation — the one the output `iface` is bound
      to, else the first NIC. Drives the panel's "set the A4 to …" guidance. null until known. */
  get controllerRecommendation(): NetworkAdapter | null {
    return this.monitor.recommendationFor(this.project?.output.iface);
  }

  /** Ask the server to (re)enumerate its NICs — called when the controller panel opens. */
  requestNetworkAdapters(): void {
    this.monitor.requestNetworkAdapters();
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

  /** Flash one hoop's LEDs full-on for `durationS` (E1 hoop identify) — the C5 Identify button.
   * `hoop` is 1-based (A1). Editor-gated (drives real hardware), like identifyController;
   * `durationS <= 0` clears any active identify. The WS protocol message + server handler
   * already exist — this is the missing client send. */
  identifyHoop(drumId: string, hoop: number, durationS = 5): void {
    if (this.isViewer) return; // read-only viewer (S2): device flash is editor-only
    this.client.send({ t: 'identifyHoop', drumId, hoop, durationS });
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

  // --- setlist arranging (songs → sections) ------------------------------------
  // Song CRUD (setActiveSong / createSong / renameSong / duplicateSong / removeSong) lives on
  // {@link showsCtl} (R23) — forwarded above. The section-arrangement edits (add/rename/remove/
  // reorder/copy/paste, R24) live on {@link sectionsCtl} — thin, API-preserving forwarders below.
  // They mutate the songs rune ShowsController owns, reached through the host.

  /** Every drum zone the kit declares (Settings › Drum trigger zones), in kit order then slot
      order, with its display title — the zones a new show's grid lays out. Empty offline (no
      input map). */
  get drumZones(): Array<{ drumId: string; slot: number; title: string }> {
    const map = this.project?.inputMap;
    if (!map) return [];
    return (this.project?.kit.drums ?? this.drums).flatMap((drum) =>
      zoneSlotsForDrum(map, drum.id).map((slot) => ({
        drumId: drum.id,
        slot,
        title: `${drum.label || drum.id} · ${zoneLabel(map, drum.id, slot)}`,
      })),
    );
  }

  /** Reorder a section in the active song by drag/drop. */
  moveSection(sectionId: string, toIndex: number): void {
    this.sectionsCtl.moveSection(sectionId, toIndex);
  }
  /** Append a new empty section to the active song and make it active. */
  addSongSection(name: string): void {
    this.sectionsCtl.addSongSection(name);
  }
  /** Rename a section of the active song (no-op-safe on an unknown id). */
  renameSection(sectionId: string, name: string): void {
    this.sectionsCtl.renameSection(sectionId, name);
  }
  /** Delete a section from the active song, re-pointing `activeSectionId` when it was active. */
  removeSection(sectionId: string): void {
    this.sectionsCtl.removeSection(sectionId);
  }
  /** Copy a section of the active song onto the in-app clipboard. */
  copySection(sectionId: string): boolean {
    return this.sectionsCtl.copySection(sectionId);
  }
  /** Paste the in-app clipboard as a NEW section appended to the active song, and make it active. */
  pasteSection(): void {
    this.sectionsCtl.pasteSection();
  }
  /** Duplicate a section in one step (copy + paste). */
  duplicateSection(sectionId: string): void {
    this.sectionsCtl.duplicateSection(sectionId);
  }

  // --- system clipboard copy / paste (S44, group K) ------------------------------
  // Copy lifts a section / song PLUS the canvas scenes its Effects play into a portable ClipDoc
  // (clipdoc.ts) and writes the JSON to the system clipboard, so it pastes across browser sessions
  // and servers. Sources are the RESOLVED view (S42) so a referenced library song copies its
  // materialized content, not a dangling ref. Paste parses defensively (foreign/malformed ⇒ a
  // friendly toast, never a crash), gives the section / song fresh ids, reuses content-equal
  // scenes (no duplicates on re-paste), then inserts it. The pure build/parse/remap lives in
  // clipdoc.ts; this region is the thin store adapter (clipboard IO + rune mutation + toasts).

  /** The show's authored scenes a copy carries — snapshotted so the serialized envelope carries
      plain data, never live rune proxies. */
  private clipSources(): { canvasScenes: CanvasScene[] } {
    return { canvasScenes: $state.snapshot(this.canvasScenes) as CanvasScene[] };
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
    const generation = this.documentGeneration;
    const wrote = await writeClipboardText(serialize(doc));
    if (generation !== this.documentGeneration) return;
    pushToast(wrote ? okMessage : 'Couldn’t reach the clipboard — copy blocked by the browser.', {
      tone: wrote ? 'success' : 'error',
    });
  }

  /** Copy a section + the scenes it plays to the system clipboard. Keeps the in-app section
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

  /** Copy a song + the scenes it plays to the system clipboard. */
  async copySongToClipboard(songId: string): Promise<void> {
    const song = this.resolvedView.songs.find((s) => s.id === songId);
    if (!song) return;
    await this.writeClip(buildSongClipDoc($state.snapshot(song), this.clipSources(), this.clipMeta()), 'Song copied.');
  }

  /** The local-show reconciliation context a paste remaps against: this show's scenes (for
      content-reuse) and its section ids. `mint` is injected only by tests; production uses the
      reservation-safe default. */
  private remapCtx(mint?: RemapMint): RemapContext {
    return {
      canvasScenes: $state.snapshot(this.canvasScenes) as CanvasScene[],
      sectionIds: this.resolvedView.songs.flatMap((song) => song.sections.map((section) => section.id)),
      mint,
    };
  }

  /** Union a materialized paste's fresh scenes into the show (reused ones are absent) and insert
      its section / song — mirrors {@link detachSongReference}. */
  private applyRemapResult(res: RemapResult): void {
    // Reserve the carried Effect ids / device uids FIRST, so a later mint into the pasted content
    // can't collide with an id that arrived verbatim from another machine.
    reserveIds(remapResultIds(res));
    this.unionCanvasScenes(res.canvasScenes);
    if (res.kind === 'section' && res.section) {
      this.sectionsCtl.insertSection(res.section);
    } else if (res.kind === 'song' && res.song) {
      const song = res.song;
      this.songs = [...this.songs, song];
      this.activeSongId = song.id;
    }
  }

  // --- save to a file (Effect / cell / device files; see the Files region above) ----------------

  private async writeFile(text: string, fileName: string, okMessage: string): Promise<SaveOutcome> {
    const generation = this.documentGeneration;
    const outcome = await saveTextFile(fileName, text);
    if (generation !== this.documentGeneration) return outcome;
    if (outcome === 'saved') pushToast(okMessage, { tone: 'success' });
    else if (outcome === 'failed') pushToast('Couldn’t save the file.', { tone: 'error' });
    return outcome;
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
    if (doc.kind === 'section' && !this.activeSongIsLocal) {
      return { ok: false, message: this.activeSongEditBlockReason ?? 'Library sections are read-only.' };
    }

    // Song → Library: extract a fresh, self-contained namespaced closure into the pool.
    if (doc.kind === 'song' && opts.songDest === 'library') {
      const libId = freshId('song', (id) => id in this.songLibrary.songs);
      const libSong = extractEffectSong(doc.payload.song, doc.deps.canvasScenes ?? [], libId);
      const songLibrary: SongLibraryV2 = { ...this.songLibrary, songs: { ...this.songLibrary.songs, [libId]: libSong } };
      this.songLibrary = songLibrary;
      // Reserve the new pool entry's raw Effect ids / device uids against later local mints.
      reserveIds(idsFromSongLibraryV2({ songs: { [libId]: libSong } }));
      return { ok: true, kind: 'song', message: `Pasted “${doc.payload.song.name || 'song'}” into the library.` };
    }

    const res = remapClipDoc(doc, this.remapCtx(opts.mint));
    if (isClipParseError(res)) return { ok: false, message: friendlyParseMessage(res.reason) };
    this.pushUndoSnapshot();
    this.batchIntoCurrentUndo(() => this.applyRemapResult(res));
    return { ok: true, kind: opts.context, message: pasteSuccessMessage(res) };
  }

  /** Toast the outcome of a paste. */
  private finishPaste(result: PasteResult): void {
    pushToast(result.message, { tone: result.ok ? 'success' : 'error' });
  }

  /** Paste a section from the system clipboard into the active song. When clipboard reads are
      blocked, fall back to the in-app section clipboard if present, else the paste-text dialog. */
  async pasteSectionFromClipboard(): Promise<void> {
    const generation = this.documentGeneration;
    const text = await readClipboardText();
    if (generation !== this.documentGeneration) return;
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

  /** Submit manually-pasted text from the section fallback dialog. */
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
      clipboard reads are unavailable so the dialog can reveal its manual paste-text field.
      A stale read returns `'cancelled'`, never `'blocked'`: the caller must not reveal an old
      manual fallback in the replacement document's dialog. */
  async pasteSong(dest: SongPasteDest): Promise<'ok' | 'blocked' | 'cancelled'> {
    const generation = this.documentGeneration;
    const text = await readClipboardText();
    if (generation !== this.documentGeneration || !this.songPasteOpen) return 'cancelled';
    if (text === null) return 'blocked';
    this.pasteSongText(dest, text);
    return 'ok';
  }

  /** Materialize a song from explicit text (manual fallback) into the chosen destination, then
      close the dialog. */
  pasteSongText(dest: SongPasteDest, text: string): void {
    if (!this.songPasteOpen) return; // a replaced/dismissed dialog has no pending manual submission
    this.finishPaste(this.materializePaste(text, { context: 'song', songDest: dest }));
    this.songPasteOpen = false;
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

  /** Delete an authored scene. A Scene Generator still naming it plays nothing until re-pointed. */
  deleteCanvasScene(id: string): boolean {
    if (this.isViewer) return false;
    if (!this.canvasScenes.some((scene) => scene.id === id)) return false;
    this.canvasScenes = this.canvasScenes.filter((scene) => scene.id !== id);
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

}
