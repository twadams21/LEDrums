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
  adsrToPoints,
  type AdsrShape,
  type Bus,
  type EffectDef,
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
  sourceMatchesPad,
  triggerSourceOf,
} from './sim';
import { BUSES, DRUMS, EFFECTS, PADS, PRESETS, SECTIONS, type Pad } from './fixtures';
import { buildLabModel } from './kit';
import { renderFrame as compositeFrame } from './render';
import { WSClient, type ConnectionState } from '../ws/client';
import { initMidi, type MidiEvent, type MidiInitResult } from '../midi/webmidi';
import type { SerializedModel } from '../ws/protocol-types';
import type { InputMap, OutputConfig, Project, voice } from '@ledrums/core';
import { buildShow } from './show-builder';
import * as setlist from '../app/setlist';
import type { SetlistSection, Song } from '../app/setlist';
import {
  STORAGE_KEY,
  SHOWS_STORAGE_KEY,
  loadShowLibrary,
  serializeShowLibrary,
  type AuthoredState,
  type Show,
  type ShowLibrary,
  type PersistedShowLibrary,
} from './persistence';
import { SaveStatusController, type SaveStatus } from './save-status';

// --- pure domain slices (S3.2) --------------------------------------------------
import { nid, freshId } from './store/ids';
import { padKey, seedGraphs, seedSongs, seedAuthored, seedLookSections } from './store/seed';
import { normalizeGraphs as hydrateGraphs, unionEffects, unionPresets } from './store/hydrate';
import * as graphsLib from './store/graphs';
import { canConnect, canReconnect } from './store/graph-wiring';
import * as vsw from './store/value-switch';
import * as objects from './store/objects';
import * as routing from './store/trigger-routing';
import * as showsLib from './store/shows';
import { ShowLibrarySync } from './store/show-library-sync';
import { EngineLinkSync } from './store/transport';

/** How long after the last authored change we wait before writing to storage. */
const SAVE_DEBOUNCE_MS = 300;

/** Read + JSON-parse a localStorage key. Guards SSR / no-localStorage / quota /
    malformed JSON — any failure yields null (boot keeps the seed). */
function readStoredKey(key: string): unknown {
  if (typeof localStorage === 'undefined') return null;
  try {
    const s = localStorage.getItem(key);
    return s ? JSON.parse(s) : null;
  } catch {
    return null;
  }
}

/** The persisted show library (the live document store). */
function readStoredLibrary(): unknown {
  return readStoredKey(SHOWS_STORAGE_KEY);
}

/** The legacy single-blob authored state — read once at boot to migrate a returning user's
    implicit work into the library (see {@link loadShowLibrary}). */
function readLegacyAuthored(): unknown {
  return readStoredKey(STORAGE_KEY);
}

/** Write the versioned library envelope. Best-effort — quota / private-mode failures are
    swallowed (persistence must never throw into the render loop or lifecycle). */
function writeStoredLibrary(payload: PersistedShowLibrary): void {
  if (typeof localStorage === 'undefined') return;
  try {
    localStorage.setItem(SHOWS_STORAGE_KEY, JSON.stringify(payload));
  } catch {
    /* ignore */
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
  sections = $state<Section[]>(seedLookSections());
  /** mutable presets — linked instances read these live. */
  presets = $state<Preset[]>(structuredClone(PRESETS));

  bpm = $state(120);
  velocity = $state(0.85);
  /** transport — playing gates the sim clock; beatsPerBar drives the readout. */
  playing = $state(true);
  beatsPerBar = $state(4);

  selectedPadKey = $state<string | null>(padKey(PADS[2]!));

  // popups (targets are play nodes from the active graph)
  galleryBlock = $state<voice.GraphNode | null>(null); // effect swap
  settingsBlock = $state<voice.GraphNode | null>(null); // preset + params + envelopes
  envTarget = $state<{ block: GraphNode; key: string } | null>(null); // envelope editor
  creatorOpen = $state(false); // effect creator

  // --- setlist (songs → sections → flat ordered graph lists) ---------------
  /** authored arrangement: songs, each with sections that hold a FLAT ordered list of
      graph KEYS (reuse-by-reference; layering = two graphs sharing a source). */
  songs = $state<Song[]>(seedSongs());
  /** which song the Sections view + Songs rail show. */
  activeSongId = $state<string>('set-1');
  /** The ONE active section (U4 merged the old `activeSectionId` look-recall +
      `arrangeSectionId` arrange focus): the section you're playing IS the one you're
      editing. Drives hit-resolution (its graphs fire), the look-morph recall, and the
      Sections / Trigger views' highlight. Defaults to the first fixture section. */
  activeSectionId = $state<string | null>(SECTIONS[0]?.id ?? null);
  /** Section copy/paste scratch — a deep copy of the last-copied section (id+name+graph
      list), or null when nothing is on the clipboard. Transient (NOT persisted): a fresh
      session starts with an empty clipboard. `pasteSection` clones this under a new id. */
  sectionClipboard = $state<SetlistSection | null>(null);

  /** persisted shell pane sizes in px, keyed by a stable pane id (set by the
      resizable docks — step 3). Empty until the user drags a splitter. */
  paneSizes = $state<Record<string, number>>({});

  /** Patch-graph per-node display-label overrides, keyed by flow-node id (the Inspector's
      rename field). UI-only — the device topology node ids aren't part of the server
      Project — so it persists via the authored-state autosave, not over WS. Empty until a
      node is renamed. */
  patchLabels = $state<Record<string, string>>({});

  // --- shows (the authored document as a named, multi-show library) ---------
  /** Every show by id — the persisted library. The ACTIVE show's `authored` is a stale cache
      (the authored runes above are the live source of truth while it's active); INACTIVE shows
      hold their last-saved authored verbatim. Seeded in the constructor from storage. */
  private showLibrary = $state<Record<string, Show>>({});
  /** Which show is live — its `authored` is what the authored runes above mirror. */
  activeShowId = $state<string>('');

  // transient snapshot
  voices = $state<Voice[]>([]);
  log = $state<LogEntry[]>([]);
  timeMs = $state(0);
  beat = $state(0);
  busLevels = $state<Record<string, number>>({});
  /** measured output frame rate — local rAF rate when offline, the server's real
      LED output rate when the WS link is open (the server's number wins). */
  fps = $state(0);
  /** engine link state for the status bar — 'offline' when no server, else the
      live WS handshake state ('connecting' while dialing, 'open' once handshook). */
  link = $state<'offline' | 'connecting' | 'open'>('offline');
  /** engine round-trip latency (ms) — 0 until the WS link reports it. */
  latencyMs = $state(0);
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

  /** mutable effect registry — the effect creator appends here (synced to the sim). */
  effects = $state<EffectDef[]>([...EFFECTS]);
  drums = DRUMS;

  labModel = buildLabModel();
  frameBuf = new Uint8Array(this.labModel.model.count * 3);
  /** Safe to preview server geometry only once the link is up AND we have BOTH the
      server's model and a frame — model.count and frame length must agree, so they
      switch together (never a server frame on the lab model, or vice versa). */
  useServer = $derived(this.link === 'open' && !!this.serverModel && !!this.serverFrame);
  /** Preview model: the engine's real kit when connected, else the local lab kit. */
  model = $derived<SerializedModel>(this.useServer ? this.serverModel! : this.labModel.model);
  /** Preview frame: the engine's composited output when connected, else local sim. */
  previewFrame = $derived<Uint8Array>(this.useServer ? this.serverFrame! : this.frameBuf);

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
  /** WebMIDI access handle (real hardware → WS). Browser-only, opened in start(),
      released in stop(); null when MIDI is unavailable or not yet requested. */
  private midiHandle: MidiInitResult | null = null;

  /** disposes the autosave $effect.root (null while persistence is not running). */
  private persistDispose: (() => void) | null = null;
  /** pending debounced-save timer (plain field — must NOT be reactive). */
  private saveTimer: ReturnType<typeof setTimeout> | null = null;
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
  /** Server-authoritative show-library controller (cold-load adopt + write-through). */
  private readonly libSync = new ShowLibrarySync();

  constructor(makeClient: () => WSClient = () => new WSClient()) {
    // Load the show library from storage BEFORE the sim is built and the engine link opens,
    // so the sim's registries and the first setShow/recallSection reflect the ACTIVE show's
    // restored content. loadShowLibrary never throws: a valid library wins; else a legacy
    // single blob is migrated to one "Default Show"; else a fresh "Untitled Show" is seeded.
    const lib = loadShowLibrary(readStoredLibrary(), readLegacyAuthored(), () => nid('show'));
    this.showLibrary = lib.shows;
    this.activeShowId = lib.activeShowId;
    // Mirror the active show's authored over the seed defaults — exactly as the old single-blob
    // hydrate did, but sourced from the active show. A migrated/fresh slice is partial, so the
    // seed fills any absent field.
    this.applyAuthored($state.snapshot(this.showLibrary[this.activeShowId]!.authored));
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
  selectedGraph: voice.TriggerGraph | null = $derived(this.selectedPadKey ? this.graphs[this.selectedPadKey] ?? null : null);
  beatPhase = $derived((this.beat % 4) / 4);

  // show derived
  /** The show list for the browser UI — `{ id, name }` in insertion order. */
  shows = $derived(Object.values(this.showLibrary).map((s) => ({ id: s.id, name: s.name })));
  /** The active show (id + name + its cached authored). null only before construction completes. */
  activeShow = $derived(this.showLibrary[this.activeShowId] ?? null);

  // setlist derived
  activeSong = $derived(this.songs.find((s) => s.id === this.activeSongId) ?? this.songs[0] ?? null);
  /** The active section (SetlistSection) in the active song — the section you play + edit.
      Its flat `graphs` list drives hit-resolution + the Sections/Trigger views. */
  activeSection = $derived(this.activeSong?.sections.find((s) => s.id === this.activeSectionId) ?? null);
  /** The reusable graph library: every EXISTING graph key with its display label — pad graphs
      and authored graphs alike, no distinction — in graph insertion order (pads first, then
      created/duplicated graphs). Drives the section picker + slot labels. A deleted graph drops
      out (it's no longer in `graphs`). */
  graphLibrary = $derived(Object.keys(this.graphs).map((key) => ({ key, label: this.graphLabel(key) })));

  /** Human label for a graph key (for the section lists + picker): the stored display name
      (`graphNames`, populated for every graph incl. pad keys at hydrate), else a kit-derived pad
      label, else the raw key. */
  graphLabel(key: string): string {
    return graphsLib.graphLabelOf(this.graphNames, key, this.pads);
  }

  // --- lifecycle -----------------------------------------------------------

  start(): void {
    if (this.raf) return;
    this.startAutosave();
    this.wireClient();
    this.client.connect();
    // Request hardware MIDI and forward it to the server (notes + transport recall).
    // Fire-and-forget: degrades to a no-op when the browser has no WebMIDI / in tests.
    void this.initMidiInput();
    this.last = performance.now();
    this.fpsLast = this.last;
    this.fpsFrames = 0;
    const loop = (now: number): void => {
      const dt = Math.min(64, now - this.last);
      this.last = now;
      this.sim.bpm = this.bpm;
      if (this.playing) this.sim.tick(dt);
      this.renderFrame();
      this.snapshot();
      // measure local output rate — but only publish it when offline; when the
      // link is open the server reports the real LED output rate via onStats.
      this.fpsFrames++;
      const elapsed = now - this.fpsLast;
      if (elapsed >= 500) {
        if (this.link !== 'open') this.fps = Math.round((this.fpsFrames * 1000) / elapsed);
        this.fpsFrames = 0;
        this.fpsLast = now;
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
    this.midiHandle?.stop();
    this.midiHandle = null;
    this.client.close();
    this.engineSync.reset();
    this.stopAutosave();
  }

  /** Open WebMIDI (browser-only) and forward every parsed event to the server. Never
      throws: an absent API / denied access resolves to an unavailable handle. */
  private async initMidiInput(): Promise<void> {
    try {
      this.midiHandle = await initMidi((ev) => this.forwardMidi(ev));
    } catch {
      this.midiHandle = null;
    }
  }

  /** Forward a parsed MIDI event over the engine link: notes as `midi`, Control Change as
      `cc`, Program Change as `programChange` (the latter two drive global transport recall —
      the server maps them to song/section recall before the per-trigger zone-map). */
  private forwardMidi(ev: MidiEvent): void {
    switch (ev.kind) {
      case 'note':
        this.client.send({ t: 'midi', note: ev.note, velocity: ev.velocity, on: ev.on });
        return;
      case 'cc':
        this.client.send({ t: 'cc', controller: ev.controller, value: ev.value });
        return;
      case 'programChange':
        this.client.send({ t: 'programChange', value: ev.value });
        return;
    }
  }

  // --- live persistence (show library ⇄ localStorage) ----------------------

  /** Make every pad-bound graph's trigger source explicit, fold legacy velocity switches, and
      hydrate a friendly display name onto every pad-keyed graph — the graph back-compat the
      constructor and every show load run (idempotent). Delegates to the pure hydrate slice. */
  private normalizeGraphs(): void {
    const { graphs, graphNames } = hydrateGraphs(this.graphs, this.graphNames, this.pads);
    this.graphs = graphs;
    this.graphNames = graphNames;
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

  /** Write the live authored runes back into the active show's library slot, so its edits are
      captured before we switch away (or persist). No-op if the active id is unknown. */
  private flushActiveToLibrary(): void {
    const active = this.showLibrary[this.activeShowId];
    if (!active) return;
    this.showLibrary = {
      ...this.showLibrary,
      [this.activeShowId]: { ...active, authored: this.toAuthored() },
    };
  }

  /** The library to persist: every show, with the ACTIVE show's `authored` refreshed from the
      live runes (inactive shows carried verbatim). Built fresh each autosave tick so the
      written blob is always current without churning the showLibrary rune on every edit. */
  private currentLibrary(): ShowLibrary {
    const lib = $state.snapshot(this.showLibrary) as Record<string, Show>;
    const active = lib[this.activeShowId];
    const name = active?.name ?? 'Untitled Show';
    return {
      shows: { ...lib, [this.activeShowId]: { id: this.activeShowId, name, authored: this.toAuthored() } },
      activeShowId: this.activeShowId,
    };
  }

  /** Read the authored runes into a plain, JSON-safe slice (proxies stripped). */
  private toAuthored(): AuthoredState {
    return $state.snapshot({
      graphs: this.graphs,
      graphNames: this.graphNames,
      songs: this.songs,
      buses: this.buses,
      presets: this.presets,
      effects: this.effects,
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
    if (a.buses) this.buses = a.buses;
    // Union, never replace (mirrors effects below): a stale localStorage slice must
    // not drop the built-in generator `:default` presets, or play nodes that point at
    // a generator effect can't resolve their preset (blank sub + frozen live preview).
    if (a.presets) this.presets = unionPresets(a.presets);
    // Union, never replace: keep every current built-in (so new generator effects
    // always appear) and re-add only the user's own created effects.
    if (a.effects) this.effects = unionEffects(a.effects);
    if (a.selectedPadKey !== undefined) this.selectedPadKey = a.selectedPadKey;
    if (a.activeSongId !== undefined) this.activeSongId = a.activeSongId;
    if (a.activeSectionId !== undefined) this.activeSectionId = a.activeSectionId;
    if (typeof a.bpm === 'number') this.bpm = a.bpm;
    if (typeof a.velocity === 'number') this.velocity = a.velocity;
    if (typeof a.beatsPerBar === 'number') this.beatsPerBar = a.beatsPerBar;
    if (a.paneSizes) this.paneSizes = a.paneSizes;
    if (a.patchLabels) this.patchLabels = a.patchLabels;
  }

  /** Begin reactively autosaving the show library (debounced). Idempotent; a no-op without
      localStorage (SSR / node tests). The $effect deep-reads the active show's authored runes
      AND the showLibrary + activeShowId (via currentLibrary), so any authored edit, show
      add/rename/delete, or switch re-schedules a save. */
  private startAutosave(): void {
    if (this.persistDispose || typeof localStorage === 'undefined') return;
    this.persistDispose = $effect.root(() => {
      $effect(() => {
        const lib = this.currentLibrary();
        this.scheduleSave(lib);
      });
    });
  }

  /** Flush any pending write and tear down the autosave effect (on stop/unmount),
      so edits in the last debounce window are not lost. */
  private stopAutosave(): void {
    if (!this.persistDispose) return;
    if (this.saveTimer) {
      clearTimeout(this.saveTimer);
      this.saveTimer = null;
    }
    writeStoredLibrary(serializeShowLibrary(this.currentLibrary()));
    this.persistDispose();
    this.persistDispose = null;
    // Cancel any pending indicator transition and re-arm the mount guard for a future start().
    this.saveStatusCtl.dispose();
    this.autosaveArmed = false;
  }

  private scheduleSave(lib: ShowLibrary): void {
    // Show "Saving…" the moment an edit schedules a write — but skip the autosave $effect's
    // first (mount) run, which fires with no user edit and shouldn't blip the indicator.
    if (this.autosaveArmed) this.saveStatusCtl.saving();
    else this.autosaveArmed = true;
    if (this.saveTimer) clearTimeout(this.saveTimer);
    this.saveTimer = setTimeout(() => {
      this.saveTimer = null;
      writeStoredLibrary(serializeShowLibrary(lib)); // localStorage cache (write-through)
      // Same debounced tick re-syncs the active show's authored Show to the engine (guarded so
      // it only sends on a real change) — so live edits AND show switches reach the server.
      this.syncShowToServer();
      // …and pushes the authored show library to the server (the source of truth), so a
      // browser-storage clear no longer loses shows. Sig-guarded; no-op until the first state.
      this.syncLibraryToServer();
      // The write (local cache + server push) has flushed → settle to "Saved" (held at
      // "Saving…" for the min-visible window first). A no-op for the skipped mount save.
      this.saveStatusCtl.saved();
    }, SAVE_DEBOUNCE_MS);
  }

  // --- show document lifecycle (new / open / save / save-as / rename / delete / close) ---
  // A show is the authored content given identity; the live authored runes mirror the ACTIVE
  // show. Every switch flushes the outgoing show's edits into its library slot, then fully
  // swaps the runes via applyShow (no cross-show bleed). The new active content reaches the
  // engine through the same debounced autosave path as any other authored edit (the swap
  // mutates the authored runes, so syncShowToServer fires on the next tick). The server
  // `Project` (routing/geometry/output) is orthogonal and never touched here.

  /** Create a blank show (seed content) and switch to it. Name defaults to the first unused
      "Untitled Show [N]". The previous show's edits are flushed to its slot first. Returns the
      new id. */
  newShow(name?: string): string {
    this.flushActiveToLibrary();
    const id = this.freshShowId();
    const label = name?.trim() || showsLib.nextShowName(this.showLibrary);
    this.resetAuthoredToSeed();
    this.normalizeGraphs();
    this.showLibrary = showsLib.withShow(this.showLibrary, { id, name: label, authored: this.toAuthored() });
    this.activeShowId = id;
    return id;
  }

  /** Switch to a saved show: flush the current show's edits, then load the target's authored
      into the runes (full swap). No-op for an unknown id or the already-active show. */
  openShow(id: string): void {
    if (id === this.activeShowId || !this.showLibrary[id]) return;
    this.flushActiveToLibrary();
    this.activeShowId = id;
    this.applyShow(this.showLibrary[id]!);
  }

  /** Deliberately persist the active show NOW (flush runes → slot → storage). Autosave already
      covers this on a debounce; saveShow is the explicit, immediate write/confirmation. */
  saveShow(): void {
    this.flushActiveToLibrary();
    writeStoredLibrary(serializeShowLibrary(this.currentLibrary()));
  }

  /** Clone the current authored content under a new id + name and switch to the clone — the
      source show keeps its content. Name defaults to the first unused "Untitled Show [N]".
      Returns the new id. */
  saveShowAs(name: string): string {
    this.flushActiveToLibrary();
    const id = this.freshShowId();
    const label = name.trim() || showsLib.nextShowName(this.showLibrary);
    // The clone's content == the current live runes, so no reload is needed after the switch.
    this.showLibrary = showsLib.withShow(this.showLibrary, { id, name: label, authored: this.toAuthored() });
    this.activeShowId = id;
    return id;
  }

  /** Rename a show. No-op on an unknown id or a blank name (keeps the old name, mirrors
      {@link renameSong}). */
  renameShow(id: string, name: string): void {
    this.showLibrary = showsLib.renameShowIn(this.showLibrary, id, name);
  }

  /** Delete a show. Never leaves zero shows — deleting the last one seeds a fresh "Untitled
      Show". When the ACTIVE show is deleted, re-points to its left neighbour (else the new
      first) and swaps that show's authored into the runes. No-op on an unknown id. */
  deleteShow(id: string): void {
    const plan = showsLib.planDeleteShow(this.showLibrary, this.activeShowId, id);
    if (plan.kind === 'noop') return;
    if (plan.kind === 'reseed') {
      // deleted the only show → start over from a blank Untitled (mirrors closeShow's reset).
      const freshShowId = this.freshShowId();
      this.resetAuthoredToSeed();
      this.normalizeGraphs();
      this.showLibrary = { [freshShowId]: { id: freshShowId, name: 'Untitled Show', authored: this.toAuthored() } };
      this.activeShowId = freshShowId;
      return;
    }
    this.showLibrary = plan.library;
    this.activeShowId = plan.activeShowId;
    if (plan.reload) this.applyShow(plan.reload);
  }

  /** Close the active show: it's already saved in the library, so just switch to a fresh blank
      "Untitled Show" (a clean slate to start over). */
  closeShow(): void {
    this.newShow();
  }

  /** Smallest unused show id (survives reload — the global nid counter + the live library). */
  private freshShowId(): string {
    return freshId('show', (id) => id in this.showLibrary);
  }

  // --- engine link plumbing ------------------------------------------------

  /** Attach the WS callbacks (idempotent — start() may be called after a stop). */
  private wireClient(): void {
    this.client.on({
      onState: (project, model, _effects, _projects, _output, showLibrary) => {
        // adopt the authoritative Project (routing/geometry/IO) AND the engine's real
        // kit model so its frames map 1:1 in the preview (the server runs its own kit
        // geometry/pixel count, not the lab kit).
        this.project = project;
        this.serverModel = model;
        // Cold-load adopt of the server-authoritative show library (server wins on first state;
        // seeds the server from our cache when it has none). markServerStateSeen first so the
        // seed-push isn't gated off. See the ShowLibrarySync controller.
        this.libSync.markServerStateSeen();
        const plan = this.libSync.planReconcile(showLibrary);
        if (plan.kind === 'adopt') {
          this.adoptLibrary(plan.library);
          // The server already holds this library, so mark synced WITHOUT echoing it back. A
          // later authored edit diverges the signature and pushes normally.
          this.libSync.noteSynced(this.libSync.librarySig(this.currentLibrary()));
        } else if (plan.kind === 'seed') {
          // Server has no library yet → seed it from our localStorage cache.
          this.syncLibraryToServer();
        }
      },
      onConnection: (state: ConnectionState) => {
        // map the client's 'closed' to the lab's 'offline'; others pass through
        this.link = state === 'closed' ? 'offline' : state;
        if (state === 'open') {
          // hand the server the authored content, then the current transport
          const show = buildShow(this);
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
        }
      },
      onStats: (stats, latencyMs, fps) => {
        this.latencyMs = latencyMs;
        this.fps = fps; // the server's measured LED output rate wins while connected
        // The protocol's stats message carries optional voice telemetry
        // ({ voiceCount, busLevels }) as a sibling `voice` field, but the read-only
        // WSClient only forwards `msg.stats` (typed core EngineStats, no `voice`) —
        // it drops `msg.voice`. So server bus levels are not reachable here without
        // editing the client; the lab keeps showing the LOCAL sim's bus levels (set
        // each frame in snapshot()). Narrow defensively in case a future client
        // forwards the field on the stats object.
        const vs = (stats as { voice?: { busLevels?: Record<string, number> } }).voice;
        if (vs?.busLevels) this.busLevels = vs.busLevels;
      },
      onFrame: (frame) => {
        this.serverFrame = frame;
      },
    });
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
  private syncShowToServer(): void {
    if (this.link !== 'open') return;
    const show = buildShow(this);
    if (!this.engineSync.planShowPush(show)) return;
    this.client.send({ t: 'setShow', show });
    // setShow reseeds the active section to the first song/section — restore focus.
    if (this.activeSectionId) {
      this.client.send({ t: 'recallSection', songId: this.activeSongId, sectionId: this.activeSectionId });
    }
  }

  // --- server-authoritative show library (cold-load adopt + write-through) -----------
  // The server owns the authored show library (like the routing Project): it persists the
  // library and broadcasts it on the `state` message. The web ADOPTS it once, on the first
  // state of a cold load (server wins); thereafter the web is the source and pushes every
  // authored change up via setShowLibrary. localStorage is a fast cache (offline / first paint).
  // The once-per-session gate + echo suppression live in the ShowLibrarySync controller.

  /** Swap the live runes to the adopted server library (mirrors the constructor's hydrate, but
      as a runtime switch): replace the library + active pointer, then load the active show's
      authored over the blank seed and re-normalize. A FULL swap — no field of the prior library
      bleeds through. */
  private adoptLibrary(lib: ShowLibrary): void {
    this.showLibrary = lib.shows;
    this.activeShowId = lib.activeShowId;
    this.applyShow(lib.shows[lib.activeShowId]!);
  }

  /** Push the current library to the server when it actually changed (sig-guarded so an
      unchanged library isn't re-sent every autosave tick). Gated on the first `state` having
      been seen, so the cold-load adopt always wins the race against the debounced autosave. */
  private syncLibraryToServer(): void {
    if (this.link !== 'open') return;
    const envelope = serializeShowLibrary(this.currentLibrary());
    if (!this.libSync.planPush(envelope)) return;
    this.client.send({ t: 'setShowLibrary', library: envelope });
  }

  /** Send setTransport to the server iff bpm/playing/beatsPerBar changed. */
  private syncTransport(): void {
    if (this.link !== 'open') return;
    const cur = { bpm: this.bpm, playing: this.playing, beatsPerBar: this.beatsPerBar };
    if (!this.engineSync.planTransportPush(cur)) return;
    this.client.send({ t: 'setTransport', ...cur });
  }

  private snapshot(): void {
    this.voices = this.sim.voices.slice();
    this.log = this.sim.log.slice(0, 40);
    this.timeMs = this.sim.timeMs;
    this.beat = this.sim.beat;
    const levels: Record<string, number> = {};
    for (const b of this.buses) levels[b.id] = this.sim.busLevel(b.id);
    this.busLevels = levels;
  }

  private renderFrame(): void {
    compositeFrame(this.frameBuf, this.sim, this.labModel);
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
  private resolveHitGraphsLocal(pad: Pad): Array<{ graph: TriggerGraph; label: string }> {
    const section = this.activeSection;
    if (section) {
      const resolved: Array<{ graph: TriggerGraph; label: string }> = [];
      for (const key of section.graphs) {
        const g = this.graphs[key];
        if (g && sourceMatchesPad(triggerSourceOf(g), pad.drumId, String(pad.zone))) {
          resolved.push({ graph: g, label: this.graphLabel(key) });
        }
      }
      return resolved;
    }
    const g = this.graphs[padKey(pad)];
    return g ? [{ graph: g, label: `${pad.drumLabel} · ${pad.zoneLabel}` }] : [];
  }

  hit(pad: Pad): void {
    const toFire = this.resolveHitGraphsLocal(pad);
    if (toFire.length === 0) return;
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
      this.sim.triggerGraph(label, graph, ctx);
    }
    this.renderFrame();
    this.snapshot();
    // forward the hit so the server fires the REAL output (local sim stays intact
    // above — it still drives the lab's voice lanes + resolution log). send() is a
    // no-op unless the socket is open, so the guard is just to avoid a needless call.
    if (this.link === 'open') {
      this.client.send({ t: 'key', drumId: pad.drumId, zone: String(pad.zone), velocity: this.velocity });
    }
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
    const idx = this.sections.findIndex((s) => s.id === this.activeSectionId);
    const src = triggerSourceOf(graph);
    const drumSrc = src?.kind === 'drum' ? src : null;
    const ctx = {
      velocity: this.velocity,
      sectionIndex: idx < 0 ? 0 : idx,
      sectionCount: this.sections.length,
      beatPhase: this.beatPhase,
      sourceDrumId: drumSrc?.drumId ?? this.pads[0]?.drumId ?? '',
      bpm: this.bpm,
    };
    this.sim.triggerGraph(this.graphLabel(key), graph, ctx);
    this.renderFrame();
    this.snapshot();
    // forward to the server so the real output fires too, when the graph is drum-sourced
    // (MIDI/OSC-sourced graphs need their actual input upstream — fired locally only here).
    if (this.link === 'open' && drumSrc) {
      this.client.send({ t: 'key', drumId: drumSrc.drumId, zone: String(drumSrc.zone), velocity: this.velocity });
    }
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
    const b = this.buses.find((x) => x.id === busId);
    if (b) b.polyphony = poly;
  }
  setCrossfade(busId: string, ms: number): void {
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
    if (look) {
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
    if (this.graphs[graphKey]) this.selectedPadKey = graphKey;
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
    if (this.project) this.project = routing.applyDrumTransform(this.project, drumId, partial);
    this.client.send({ t: 'setKitTransform', drumId, ...partial });
  }

  /** Replace the physical-output topology (a Patch graph rewire → PixLite patch order). */
  setRouting(outputs: OutputConfig[]): void {
    if (this.project) this.project = routing.applyRouting(this.project, outputs);
    this.client.send({ t: 'setKitOutputs', outputs });
  }

  /** Replace the input map (zone-node MIDI note / OSC address routing). */
  setInputMap(inputMap: InputMap): void {
    if (this.project) this.project = routing.applyInputMap(this.project, inputMap);
    this.client.send({ t: 'setInputMap', inputMap });
  }

  /** Apply a partial output-settings change (controller node: protocol/host/rgb/fps/…). */
  setOutput(partial: routing.OutputPartial): void {
    if (this.project) this.project = routing.applyOutput(this.project, partial);
    this.client.send({ t: 'setOutput', ...partial });
  }

  /** Set or clear a Patch node's display-label override (the Inspector's rename field).
      A blank label clears the override (back to the derived title). Purely local + UI-only
      — the device topology ids aren't server state — so this persists via the authored
      autosave, never over WS. */
  setPatchLabel(nodeId: string, label: string): void {
    this.patchLabels = routing.setPatchLabel(this.patchLabels, nodeId, label);
  }

  // --- setlist arranging (songs → sections → per-drum graph slots) ----------
  // Authoring only today: edits the arrangement + links to graph editing. Firing a
  // section's slot graphs on a hit is the deeper engine change (see redesign plan).

  setActiveSong(songId: string): void {
    if (!this.songs.some((s) => s.id === songId)) return;
    this.activeSongId = songId;
    const firstSectionId = this.songs.find((s) => s.id === songId)?.sections[0]?.id ?? null;
    this.activeSectionId = firstSectionId;
    if (this.link === 'open' && firstSectionId) {
      this.client.send({ t: 'recallSection', songId, sectionId: firstSectionId });
    }
  }

  /** Create a new, empty song (one empty section), append it to `songs`, make it the
      active song, and return its id. Name defaults to "New song N" (first unused). Persists
      via the authored-state autosave (`songs` is part of the snapshot). */
  createSong(name?: string): string {
    const id = freshId('song', (k) => this.songs.some((s) => s.id === k)); // global uniqueness (survives reload)
    const label = name?.trim() || this.nextSongName();
    this.songs = [...this.songs, setlist.makeSong(id, label)];
    this.setActiveSong(id); // points activeSectionId at the new song's first section
    return id;
  }

  /** Smallest unused "New song N" label, so auto-named songs stay distinct. */
  private nextSongName(): string {
    const used = new Set(this.songs.map((s) => s.name));
    let n = 1;
    while (used.has(`New song ${n}`)) n++;
    return `New song ${n}`;
  }

  /** Rename a song. No-op if the id is unknown or the trimmed name is empty (a blank rename
      keeps the old name rather than clearing it). Persists via autosave. */
  renameSong(id: string, name: string): void {
    const trimmed = name.trim();
    if (!trimmed) return;
    this.songs = this.songs.map((s) => (s.id === id ? { ...s, name: trimmed } : s));
  }

  /** Duplicate a song: append an independent "<name> copy" (every section deep-copied under
      a fresh id, so the clone's arrangement edits without touching the source — graph KEYS
      stay shared, i.e. reuse) and make it active. Returns the new id, or null if `id` is
      unknown. */
  duplicateSong(id: string): string | null {
    const src = this.songs.find((s) => s.id === id);
    if (!src) return null;
    const newId = freshId('song', (k) => this.songs.some((s) => s.id === k));
    const sections = src.sections.map((sec) => setlist.cloneSection(sec, nid('section'), sec.name));
    this.songs = [...this.songs, setlist.makeSong(newId, `${src.name} copy`, sections)];
    this.setActiveSong(newId);
    return newId;
  }

  /** Remove a song. When the removed song was active, re-points `activeSongId` to a sensible
      neighbour (the next song, else the new last). Guards the LAST song: removing the only
      song is a no-op, so the app always has a song to show + edit. Persists via autosave. */
  removeSong(id: string): void {
    if (this.songs.length <= 1) return; // never delete the last song (activeSong would go null)
    const idx = this.songs.findIndex((s) => s.id === id);
    if (idx === -1) return;
    const wasActive = this.activeSongId === id;
    this.songs = this.songs.filter((s) => s.id !== id);
    if (wasActive) {
      const next = this.songs[idx] ?? this.songs[this.songs.length - 1]!;
      this.setActiveSong(next.id);
    }
  }

  /** Mutate the active song immutably via the pure setlist ops, then store it back. */
  private updateActiveSong(fn: (song: Song) => Song): void {
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
  addSongSection(name: string): void {
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

  /** Author a brand-new, empty trigger graph (just the implicit trigger input) and
      select it for editing. Returns its key. The label defaults to "New graph N"
      (first unused N). Persisted via the authored-state autosave. */
  createGraph(name?: string): string {
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
    const g = this.graphs[graphKey];
    if (!g) return;
    const trig = g.nodes.find((n) => n.kind === 'trigger');
    if (trig) trig.source = source;
  }

  /** The explicit trigger source for a graph (what the Inspector reads). undefined when
      the graph/trigger is missing, or an authored graph has no source bound yet. */
  triggerSource(graphKey: string): TriggerSource | undefined {
    return this.graphs[graphKey]?.nodes.find((n) => n.kind === 'trigger')?.source;
  }

  // --- registries / lookups ------------------------------------------------

  effectsForScope(scope: Scope): EffectDef[] {
    return this.effects.filter((e) => e.scope === scope);
  }
  effectOf(node: GraphNode) {
    return node.kind === 'play' ? this.effects.find((e) => e.id === node.effectId) : undefined;
  }
  presetsForEffect(effectId: string): Preset[] {
    return this.presets.filter((p) => p.effectId === effectId);
  }
  presetById(id: string): Preset | undefined {
    return this.presets.find((p) => p.id === id);
  }
  /** Live params shown for a play node (linked → shared preset, else instance). */
  liveParams(node: GraphNode): voice.ParamValues {
    if (node.kind !== 'play') return {};
    return node.linked ? this.presetById(node.presetId)?.params ?? node.params : node.params;
  }

  // --- graph editing (freeform node wiring) --------------------------------

  /** Add a node of a kind at a canvas position. Play nodes seed the first effect. */
  addNode(kind: NodeKind, x: number, y: number): GraphNode | null {
    const g = this.selectedGraph;
    if (!g || kind === 'trigger') return null;
    let node: GraphNode;
    if (kind === 'play') {
      node = makeNode('play', nid('n'), x, y, graphsLib.playNodeInit(this.effects, (id) => this.presetById(id)));
    } else {
      node = makeNode(kind, nid('n'), x, y);
    }
    g.nodes.push(node);
    return node;
  }

  moveNode(node: GraphNode, x: number, y: number): void {
    node.x = x;
    node.y = y;
  }

  removeNode(node: GraphNode): void {
    const g = this.selectedGraph;
    if (!g || node.kind === 'trigger') return;
    g.nodes = g.nodes.filter((n) => n.id !== node.id);
    g.edges = g.edges.filter((e) => e.from !== node.id && e.to !== node.id);
    if (this.settingsBlock?.id === node.id) this.settingsBlock = null;
    if (this.galleryBlock?.id === node.id) this.galleryBlock = null;
    if (this.envTarget?.block.id === node.id) this.envTarget = null;
  }

  /** Wire a node's output to another's input (rejects dup / cycle / bad direction).
      `fromPort` is the source handle the wire leaves (a value+bands switch's `band-${i}`);
      undefined = the node's default single output. */
  connect(fromId: string, toId: string, fromPort?: string): void {
    const g = this.selectedGraph;
    if (!g || !canConnect(g, fromId, toId, fromPort)) return;
    g.edges.push({ id: nid('e'), from: fromId, to: toId, fromPort });
  }
  disconnect(edgeId: string): void {
    const g = this.selectedGraph;
    if (g) g.edges = g.edges.filter((e) => e.id !== edgeId);
  }
  /** Re-point an existing edge to a new source/target (an edge-end drag). Validates
      exactly as connect() does — but ignoring the edge being moved — and leaves the
      wire untouched if the move would be a dup / wrong-direction / cycle, so a bad
      reconnect drag snaps back instead of deleting the wire. */
  reconnect(edgeId: string, fromId: string, toId: string, fromPort?: string): void {
    const g = this.selectedGraph;
    if (!g || !canReconnect(g, edgeId, fromId, toId, fromPort)) return;
    const edge = g.edges.find((e) => e.id === edgeId)!;
    edge.from = fromId;
    edge.to = toId;
    edge.fromPort = fromPort;
  }

  /** Change a node's kind, seeding play fields and dropping outgoing wires for sinks. */
  changeKind(node: GraphNode, kind: NodeKind): void {
    if (node.kind === 'trigger' || kind === 'trigger') return;
    node.kind = kind;
    if (kind === 'play') {
      if (!node.effectId) {
        const init = graphsLib.playNodeInit(this.effects, (id) => this.presetById(id));
        node.effectId = init.effectId;
        node.scope = init.scope;
        node.presetId = init.presetId;
        node.params = init.params;
      }
      const g = this.selectedGraph;
      if (g) g.edges = g.edges.filter((e) => e.from !== node.id);
    }
  }

  /** Drum info for the current kit, used by the Inspector's scope-target dropdowns. */
  get kitDrumInfos(): { id: string; label: string; hoopCount: number }[] {
    return this.labModel.pm.drums.map((d) => ({ id: d.drumId, label: d.label, hoopCount: d.hoopCount }));
  }

  setMode(node: GraphNode, mode: PlayMode): void {
    if (node.kind === 'play') node.mode = mode;
  }

  /** Set the render scope on a play node (kit / drum / hoop). Clearing targetId on
      scope change prevents a stale targetId from a previous scope from leaking. */
  setScope(node: GraphNode, scope: Scope): void {
    if (node.kind !== 'play') return;
    node.scope = scope;
    node.targetId = undefined;
  }

  /** Set (or clear) the per-play-node target id: drum = drumId, hoop = "drumId#hoopIndex".
      Pass undefined or empty string to clear (auto = firing/source drum). */
  setTargetId(node: GraphNode, targetId: string | undefined): void {
    if (node.kind !== 'play') return;
    node.targetId = targetId || undefined;
  }
  setNoRepeat(node: GraphNode, v: boolean): void {
    if (node.kind === 'random') node.noRepeat = v;
  }
  setChance(node: GraphNode, p: number): void {
    if (node.kind === 'chance') node.p = p;
  }
  setSwitchOn(node: GraphNode, on: SwitchOn): void {
    if (node.kind !== 'switch') return;
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
    if (node.kind !== 'switch' || node.on !== 'value') return;
    node.valueMode = mode;
    // gate has a single output; collapse any band wires so they fire as default children.
    if (mode === 'gate') this.stripBandPorts(node);
  }
  setThreshold(node: GraphNode, threshold: number): void {
    if (node.kind !== 'switch' || node.on !== 'value') return;
    node.threshold = vsw.clamp01(threshold);
  }
  setInvert(node: GraphNode, invert: boolean): void {
    if (node.kind !== 'switch' || node.on !== 'value') return;
    node.invert = invert;
  }

  // --- delay node mutators -------------------------------------------------

  /** Switch a delay node between absolute-time (`'time'`) and musical-division
      (`'beats'`) modes. Guards `node.kind === 'delay'`. */
  setDelayMode(node: GraphNode, mode: 'time' | 'beats'): void {
    if (node.kind !== 'delay') return;
    node.delayMode = mode;
  }

  /** Set the absolute delay time in milliseconds. Guards `node.kind === 'delay'`. */
  setDelayMs(node: GraphNode, ms: number): void {
    if (node.kind !== 'delay') return;
    node.ms = Math.max(0, ms);
  }

  /** Set the musical division string (e.g. `'1/8'`, `'dotted-1/4'`). Guards
      `node.kind === 'delay'`. */
  setDivision(node: GraphNode, division: string): void {
    if (node.kind !== 'delay') return;
    node.division = division;
  }

  /** Append a band by splitting the final "rest" band (a new cutoff between the last
      cutoff and 1). Appending never disturbs existing band ports. */
  addBand(node: GraphNode): void {
    if (node.kind !== 'switch' || node.on !== 'value') return;
    node.bands = vsw.addBand(node.bands);
  }
  /** Remove cutoff `cutoffIndex` (merging band cutoffIndex+1 down into it), keeping at
      least one cutoff (≥2 bands). Remaps the outgoing band ports to match. */
  removeBand(node: GraphNode, cutoffIndex: number): void {
    if (node.kind !== 'switch' || node.on !== 'value') return;
    if (!vsw.canRemoveBand(node.bands, cutoffIndex)) return;
    node.bands = vsw.removeBandAt(node.bands, cutoffIndex);
    this.remapBandPorts(node, cutoffIndex);
  }
  /** Set cutoff `cutoffIndex`, clamped WITHIN its neighbours so cutoffs stay ascending
      without reordering — reordering would scramble which band each port maps to. */
  setBandCutoff(node: GraphNode, cutoffIndex: number, value: number): void {
    if (node.kind !== 'switch' || node.on !== 'value') return;
    const bands = node.bands ?? [0.5];
    if (cutoffIndex < 0 || cutoffIndex >= bands.length) return;
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
    if (node.kind === 'play') this.galleryBlock = node;
  }
  closeGallery(): void {
    this.galleryBlock = null;
  }
  openSettings(node: GraphNode): void {
    if (node.kind === 'play') this.settingsBlock = node;
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
  openCreator(): void {
    this.creatorOpen = true;
  }
  closeCreator(): void {
    this.creatorOpen = false;
  }

  /** Author a new effect at runtime: register it + seed a Default preset. Returns its id. */
  createEffect(input: objects.NewEffectInput): string {
    const id = objects.freshEffectId(this.effects, input.name);
    const eff = objects.buildEffect(input, id);
    this.effects.push(eff);
    this.sim.registerEffect(eff);
    const preset = objects.defaultPresetFor(eff);
    this.presets.push(preset);
    this.sim.registerPreset(preset);
    return id;
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
    const trimmed = name.trim();
    if (!trimmed) return;
    const cur = this.effects.find((e) => e.id === id);
    if (!cur) return;
    const renamed: EffectDef = { ...cur, name: trimmed };
    this.effects = this.effects.map((e) => (e.id === id ? renamed : e));
    this.sim.registerEffect(renamed);
  }

  /** Duplicate an effect: clone its definition under a fresh id named "<name> copy", register
      it with the sim, and seed its `${newId}:default` preset (mirrors {@link createEffect}).
      Returns the new id, or null for an unknown id. The clone is independent (its own id +
      Default preset); a generator-backed effect keeps its `generatorId` so it renders
      identically. Persists via the authored autosave. */
  duplicateEffect(id: string): string | null {
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
      reference) and re-points the sim's id-map, so linked play instances (which resolve by id)
      see the new name. Persists via the autosave ({@link unionPresets} keeps a renamed built-in
      preset on reload). */
  renamePreset(id: string, name: string): void {
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
    const src = this.presetById(id);
    if (!src) return null;
    const newId = freshId('preset', (k) => this.presets.some((p) => p.id === k)); // global uniqueness (survives reload)
    const preset = objects.clonePreset(src, newId);
    this.presets.push(preset);
    this.sim.registerPreset(preset);
    return newId;
  }

  /** How many play nodes — across EVERY graph (pad + authored) — reference this preset, whether
      linked (reads the shared preset live) or instance-origin (forked its own params from it,
      keeping `presetId` as the origin). Pure read: gates {@link deletePreset} and is shown in
      the Objects view. */
  presetUsageCount(id: string): number {
    return objects.presetUsageCount(this.graphs, id);
  }

  /** Delete a preset — ONLY when it is used nowhere ({@link presetUsageCount} === 0) and it is
      not a live effect's foundational `:default` (an effect's seeded baseline is never
      deletable while the effect exists). Removes it from `presets` + the sim registry and
      returns true; returns false (a no-op) when the id is unknown, the preset is in use, or it
      is a live effect's `:default`. Persists via the authored autosave. */
  deletePreset(id: string): boolean {
    const pr = this.presetById(id);
    const usage = pr ? objects.presetUsageCount(this.graphs, id) : 0;
    if (!objects.canDeletePreset(pr, usage, this.effects)) return false;
    this.presets = this.presets.filter((p) => p.id !== id);
    this.sim.unregisterPreset(id);
    return true;
  }

  /** Swap the effect: reset to that effect's Default preset (own instance). */
  pickEffect(node: GraphNode, effectId: string): void {
    if (node.kind !== 'play') return;
    const eff = this.effects.find((e) => e.id === effectId);
    if (!eff) return;
    const pr = this.presetById(`${effectId}:default`);
    node.effectId = effectId;
    node.scope = eff.scope;
    node.presetId = `${effectId}:default`;
    node.busId = ''; // follow the new effect's default layer
    node.params = { ...(pr?.params ?? defaultParams(eff)) };
    node.env = {};
  }

  /** Route a play node to a layer/bus ('' → the effect's default). */
  setBus(node: GraphNode, busId: string): void {
    if (node.kind === 'play') node.busId = busId;
  }
  /** The effective layer for a play node (its override, or the effect's default). */
  busOf(node: GraphNode): string {
    if (node.kind !== 'play') return '';
    return node.busId || this.effectOf(node)?.busId || '';
  }

  /** Select a preset for this instance. Forks its params (or rebinds if linked). */
  selectPreset(node: GraphNode, presetId: string): void {
    if (node.kind !== 'play') return;
    const pr = this.presetById(presetId);
    if (!pr) return;
    node.presetId = presetId;
    if (!node.linked) node.params = { ...pr.params };
  }

  toggleLink(node: GraphNode): void {
    if (node.kind !== 'play') return;
    if (node.linked) {
      // unlink → fork the shared preset into a private copy
      const pr = this.presetById(node.presetId);
      if (pr) node.params = { ...pr.params };
      node.linked = false;
    } else {
      node.linked = true;
    }
  }

  setParam(node: GraphNode, key: string, value: ParamValue): void {
    if (node.kind !== 'play') return;
    if (node.linked) {
      const pr = this.presetById(node.presetId);
      if (pr) pr.params[key] = value;
    } else {
      node.params[key] = value;
    }
  }

  getEnvelope(node: GraphNode, key: string): Envelope | null {
    return node.kind === 'play' ? node.env[key] ?? null : null;
  }
  envKind(node: GraphNode, key: string): EnvKind {
    return node.kind === 'play' ? node.env[key]?.kind ?? 'none' : 'none';
  }
  isEnveloped(node: GraphNode, key: string): boolean {
    return node.kind === 'play' && !!node.env[key] && node.env[key]!.kind !== 'none';
  }
  /** Set or clear the envelope on a param (seeds a preset curve; 'none' removes it). */
  setEnvKind(node: GraphNode, key: string, kind: EnvKind): void {
    if (node.kind !== 'play') return;
    if (kind === 'none') delete node.env[key];
    else node.env[key] = defaultEnvelope(kind);
  }
  setEnvAmount(node: GraphNode, key: string, amount: number): void {
    if (node.kind !== 'play') return;
    const e = node.env[key];
    if (e) e.amount = amount;
  }
  /** Replace the curve breakpoints (marks the envelope as hand-edited / custom). */
  setEnvPoints(node: GraphNode, key: string, points: EnvPoint[]): void {
    if (node.kind !== 'play') return;
    const e = node.env[key];
    if (!e) return;
    e.points = points;
    e.kind = 'custom';
  }
  /** Set the ADSR shape on a param's envelope (regenerates the render curve). */
  setEnvAdsr(node: GraphNode, key: string, adsr: AdsrShape): void {
    if (node.kind !== 'play') return;
    let e = node.env[key];
    if (!e) {
      e = { kind: 'custom', amount: 1, points: [] };
      node.env[key] = e;
    }
    e.adsr = { ...adsr };
    e.points = adsrToPoints(adsr);
    e.kind = 'custom';
  }
}
