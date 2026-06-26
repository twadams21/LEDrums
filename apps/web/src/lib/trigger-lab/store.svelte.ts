/* Reactive bridge over the throwaway Sim. Owns editable config + the effect/preset
   registries as runes, drives the sim from a rAF loop, and snapshots transient
   voice/log state each frame. Throwaway — see ./NOTES.md. */

import {
  Sim,
  defaultParams,
  defaultEnvelope,
  adsrToPoints,
  type AdsrShape,
  type Block,
  type BlockKind,
  type Bus,
  type EffectDef,
  type Envelope,
  type EnvKind,
  type EnvPoint,
  type LogEntry,
  type ParamSpec,
  type ParamValue,
  type Pattern,
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
  treeToGraph,
  foldVelocitySwitches,
  makeNode,
  nodeHasOutput,
  nodeHasInput,
  sourceMatchesPad,
  triggerSourceOf,
} from './sim';
import { BUSES, DRUMS, EFFECTS, PADS, PRESETS, SECTIONS, play, type Pad } from './fixtures';
import { buildLabModel } from './kit';
import { renderFrame as compositeFrame } from './render';
import { WSClient, type ConnectionState } from '../ws/client';
import type { SerializedModel } from '../ws/protocol-types';
import type { InputMap, OutputConfig, Project } from '@ledrums/core';
import { buildShow } from './show-builder';
import * as setlist from '../app/setlist';
import type { SetlistSection, Song } from '../app/setlist';
import {
  STORAGE_KEY,
  deserializeAuthored,
  serializeAuthored,
  type AuthoredState,
  type PersistedAuthored,
} from './persistence';

/** How long after the last authored change we wait before writing to storage. */
const SAVE_DEBOUNCE_MS = 300;

/** Read + parse the persisted authored blob. Guards SSR / no-localStorage /
    quota / malformed JSON — any failure yields null (boot keeps the seed). */
function readStored(): unknown {
  if (typeof localStorage === 'undefined') return null;
  try {
    const s = localStorage.getItem(STORAGE_KEY);
    return s ? JSON.parse(s) : null;
  } catch {
    return null;
  }
}

/** Write the versioned envelope. Best-effort — quota / private-mode failures are
    swallowed (persistence must never throw into the render loop or lifecycle). */
function writeStored(payload: PersistedAuthored): void {
  if (typeof localStorage === 'undefined') return;
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(payload));
  } catch {
    /* ignore */
  }
}

let idSeq = 1000;
const nid = (k: string) => `${k}-${idSeq++}`;

const clamp01 = (x: number): number => (x < 0 ? 0 : x > 1 ? 1 : x);

/** Build a fresh block of a given kind (leaves use the effect's Default preset). */
export function makeBlock(kind: BlockKind, firstEffectId: string): Block {
  switch (kind) {
    case 'play':
      return play(firstEffectId, 'oneshot');
    case 'all':
      return { id: nid('all'), kind: 'all', children: [play(firstEffectId)] };
    case 'random':
      return { id: nid('random'), kind: 'random', noRepeat: true, children: [play(firstEffectId), play(firstEffectId)] };
    case 'sequence':
      return { id: nid('sequence'), kind: 'sequence', children: [play(firstEffectId), play(firstEffectId)] };
    case 'switch':
      // value+bands by default (canonical): 2 children → band-0 / band-1, one cutoff at 0.5.
      return {
        id: nid('switch'),
        kind: 'switch',
        on: 'value',
        valueMode: 'bands',
        bands: [0.5],
        children: [play(firstEffectId), play(firstEffectId)],
      };
    case 'chance':
      return { id: nid('chance'), kind: 'chance', p: 0.5, child: play(firstEffectId) };
    case 'toggle':
      return { id: nid('toggle'), kind: 'toggle', child: play(firstEffectId, 'loop') };
  }
}

const padKey = (p: Pad) => `${p.drumId}:${p.zone}`;

/** Seed one demo song from the fixture sections, each section being the FLAT list of every
    pad's graph key (U4). Each pad graph declares a `drum` source from its padKey (the
    constructor's unionTriggerSources back-fill), so a hit fires only the matching pad's
    graph — reproducing the pre-section per-zone behaviour exactly while every section is a
    real, editable, reusable graph list. References are by graph key, so the same key in two
    sections is the same graph, not a copy; layering a drum is now two graphs in the section
    that share a source (each pad appears once in the seed). */
function seedSongs(): Song[] {
  const padKeys = PADS.map(padKey);
  return [
    {
      id: 'set-1',
      name: 'Set 1',
      sections: SECTIONS.map((s) => setlist.makeSection(s.id, s.name, padKeys)),
    },
  ];
}

/** Union built-in effects with persisted USER-CREATED ones. Hydration must never
    drop new built-ins: a user's blob saved before the 41 generator effects existed
    would otherwise overwrite the fresh registry and hide them forever. So start from
    the fixture EFFECTS (every built-in, always current) and append only persisted
    effects whose id isn't a built-in — the user's own createEffect() additions.
    Built-ins are immutable from the UI, so re-taking the fresh def loses nothing. */
function unionEffects(persisted: readonly EffectDef[]): EffectDef[] {
  const builtinIds = new Set(EFFECTS.map((e) => e.id));
  return [...EFFECTS, ...persisted.filter((e) => !builtinIds.has(e.id))];
}

/** Union persisted presets with the built-ins (mirrors {@link unionEffects}). Keeps
    the user's persisted presets first — so edits to a built-in preset (linked mode)
    survive — then re-adds any built-in preset the stored slice LACKS. Without this a
    pre-generator localStorage blob silently drops the 41 generator `${id}:default`
    presets, so swapping a play node to a generator effect leaves `presetId` dangling:
    the node sub goes blank AND the engine can't resolve the effect (frozen preview). */
function unionPresets(persisted: readonly Preset[]): Preset[] {
  const persistedIds = new Set(persisted.map((p) => p.id));
  return [...persisted, ...PRESETS.filter((p) => !persistedIds.has(p.id))];
}

/** Back-fill an explicit `drum` trigger source on every PAD-BOUND graph that lacks one —
    the implicit padKey binding (`"drumId:zone"`) made explicit, so a graph now declares
    what fires it. Mirrors {@link unionEffects}/{@link unionPresets}: a blob saved before
    the trigger-source model has no `source`, and we fill the least-surprising default
    rather than dropping anything. Idempotent (a trigger node that already carries a
    `source` is left untouched) and immutable (only changed graphs are rebuilt). AUTHORED
    graphs (`graph:<n>`, listed in `authoredKeys`) have NO pad, so they keep `source`
    unset = behave exactly as today until the user binds a MIDI/OSC source. */
function unionTriggerSources(
  graphs: Record<string, TriggerGraph>,
  authoredKeys: ReadonlySet<string>,
): Record<string, TriggerGraph> {
  const out: Record<string, TriggerGraph> = {};
  for (const [key, graph] of Object.entries(graphs)) {
    out[key] = authoredKeys.has(key) ? graph : withDrumSource(graph, key);
  }
  return out;
}

/** Ensure a pad graph's trigger node carries a `drum` source derived from its padKey
    `"drumId:zone"`. Returns the SAME graph reference when nothing changes (idempotent +
    alias-stable), so an already-sourced or non-pad-keyed graph is untouched. */
function withDrumSource(graph: TriggerGraph, key: string): TriggerGraph {
  const i = graph.nodes.findIndex((n) => n.kind === 'trigger');
  if (i < 0 || graph.nodes[i]!.source) return graph; // no trigger node, or already explicit
  const sep = key.indexOf(':');
  if (sep < 0) return graph; // not a "drumId:zone" key → leave unset
  const source: TriggerSource = { kind: 'drum', drumId: key.slice(0, sep), zone: key.slice(sep + 1) };
  const nodes = graph.nodes.slice();
  nodes[i] = { ...nodes[i]!, source };
  return { nodes, edges: graph.edges };
}

export class TriggerLab {
  // editable config (shared by reference with the sim)
  buses = $state<Bus[]>(BUSES.map((b) => ({ ...b })));
  pads = $state<Pad[]>(structuredClone(PADS));
  /** per-pad freeform trigger graphs (keyed by padKey) — the editable model.
      Authored (non-pad) graphs created via createGraph() live here too, keyed
      `graph:<n>`, with their display labels in `graphNames`. */
  graphs = $state<Record<string, TriggerGraph>>(Object.fromEntries(PADS.map((p) => [padKey(p), treeToGraph(p.tree)])));
  /** display labels for AUTHORED graph keys (pad graphs label from the kit). */
  graphNames = $state<Record<string, string>>({});
  sections = $state<Section[]>(structuredClone(SECTIONS));
  /** mutable presets — linked instances read these live. */
  presets = $state<Preset[]>(structuredClone(PRESETS));

  bpm = $state(120);
  velocity = $state(0.85);
  /** transport — playing gates the sim clock; beatsPerBar drives the readout. */
  playing = $state(true);
  beatsPerBar = $state(4);

  selectedPadKey = $state<string | null>(padKey(PADS[2]!));

  // popups (targets are play nodes from the active graph)
  galleryBlock = $state<GraphNode | null>(null); // effect swap
  settingsBlock = $state<GraphNode | null>(null); // preset + params + envelopes
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
  /** last transport tuple we sent the server — guards against re-sending every
      frame (we only push setTransport when one of these actually changes). */
  private lastSent: { bpm: number; playing: boolean; beatsPerBar: number } | null = null;

  /** disposes the autosave $effect.root (null while persistence is not running). */
  private persistDispose: (() => void) | null = null;
  /** pending debounced-save timer (plain field — must NOT be reactive). */
  private saveTimer: ReturnType<typeof setTimeout> | null = null;

  constructor(makeClient: () => WSClient = () => new WSClient()) {
    // Hydrate AUTHORED state from storage BEFORE the sim is built and the engine
    // link opens, so the sim's bus/preset/effect registries and the first
    // setShow/recallSection all reflect the restored content. A missing / stale /
    // corrupt blob is ignored by deserializeAuthored, so the seed stands.
    this.hydrate();
    // Make every pad-bound graph's trigger source EXPLICIT (a `drum` source from its
    // padKey) — seed or restored, idempotent, authored graphs left unset. See
    // unionTriggerSources: this is the trigger-source back-compat default.
    this.graphs = unionTriggerSources(this.graphs, new Set(Object.keys(this.graphNames)));
    // Fold any legacy `on:'velocity'` switch (seed or a returning user's persisted graph)
    // into the canonical `value`+`bands` form, preserving routing exactly. Idempotent —
    // a no-op once migrated — so it runs unconditionally, like unionTriggerSources.
    this.graphs = foldVelocitySwitches(this.graphs);
    // Build the sim from the (possibly restored) arrays — it snapshots `buses` by
    // reference and indexes `effects`/`presets` into maps at construction, so it
    // must see the hydrated arrays, not the fixture defaults.
    this.sim = new Sim(this.buses, this.effects, this.presets);
    this.client = makeClient();
  }

  selectedPad = $derived(this.pads.find((p) => padKey(p) === this.selectedPadKey) ?? null);
  selectedGraph = $derived(this.selectedPadKey ? this.graphs[this.selectedPadKey] ?? null : null);
  beatPhase = $derived((this.beat % 4) / 4);

  // setlist derived
  activeSong = $derived(this.songs.find((s) => s.id === this.activeSongId) ?? this.songs[0] ?? null);
  /** The active section (SetlistSection) in the active song — the section you play + edit.
      Its flat `graphs` list drives hit-resolution + the Sections/Trigger views. */
  activeSection = $derived(this.activeSong?.sections.find((s) => s.id === this.activeSectionId) ?? null);
  /** The reusable graph library: every per-pad graph ("Drum · zone") plus every
      authored graph (its user/auto label), so the picker + slot labels see both. */
  graphLibrary = $derived([
    ...this.pads.map((p) => ({ key: padKey(p), label: `${p.drumLabel} · ${p.zoneLabel}` })),
    ...Object.keys(this.graphNames).map((key) => ({ key, label: this.graphNames[key]! })),
  ]);

  /** Human label for a graph key (for the section lists + picker); falls back to the raw key. */
  graphLabel(key: string): string {
    return this.graphLibrary.find((g) => g.key === key)?.label ?? key;
  }

  // --- lifecycle -----------------------------------------------------------

  start(): void {
    if (this.raf) return;
    this.startAutosave();
    this.wireClient();
    this.client.connect();
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
    this.client.close();
    this.lastSent = null;
    this.stopAutosave();
  }

  // --- live persistence (authored state ⇄ localStorage) --------------------

  /** Apply a persisted blob over the seed defaults. Runs in the constructor,
      before the sim exists — touches runes only. */
  private hydrate(): void {
    const slice = deserializeAuthored(readStored());
    if (slice) this.applyAuthored(slice);
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

  /** Begin reactively autosaving authored changes (debounced). Idempotent; a
      no-op without localStorage (SSR / node tests). The $effect deep-reads the
      whole authored slice via toAuthored(), so any nested edit re-schedules. */
  private startAutosave(): void {
    if (this.persistDispose || typeof localStorage === 'undefined') return;
    this.persistDispose = $effect.root(() => {
      $effect(() => {
        const snap = this.toAuthored();
        this.scheduleSave(snap);
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
    writeStored(serializeAuthored(this.toAuthored()));
    this.persistDispose();
    this.persistDispose = null;
  }

  private scheduleSave(snap: AuthoredState): void {
    if (this.saveTimer) clearTimeout(this.saveTimer);
    this.saveTimer = setTimeout(() => {
      this.saveTimer = null;
      writeStored(serializeAuthored(snap));
      // Same debounced tick re-syncs the authored Show to the engine (guarded so it
      // only sends on a real change) — so live edits actually reach the server.
      this.syncShowToServer();
    }, SAVE_DEBOUNCE_MS);
  }

  // --- engine link plumbing ------------------------------------------------

  /** Attach the WS callbacks (idempotent — start() may be called after a stop). */
  private wireClient(): void {
    this.client.on({
      onState: (project, model) => {
        // adopt the authoritative Project (routing/geometry/IO) AND the engine's real
        // kit model so its frames map 1:1 in the preview (the server runs its own kit
        // geometry/pixel count, not the lab kit).
        this.project = project;
        this.serverModel = model;
      },
      onConnection: (state: ConnectionState) => {
        // map the client's 'closed' to the lab's 'offline'; others pass through
        this.link = state === 'closed' ? 'offline' : state;
        if (state === 'open') {
          // hand the server the authored content, then the current transport
          const show = buildShow(this);
          this.client.send({ t: 'setShow', show });
          this.lastShowSig = this.showSig(show); // baseline so the first sync tick is a no-op
          this.lastSent = { bpm: this.bpm, playing: this.playing, beatsPerBar: this.beatsPerBar };
          this.client.send({ t: 'setTransport', ...this.lastSent });
          // align the engine's active section with the store's current active section
          if (this.activeSectionId) {
            this.client.send({ t: 'recallSection', songId: this.activeSongId, sectionId: this.activeSectionId });
          }
        } else {
          // a drop means our next open must re-send the transport + Show
          this.lastSent = null;
          this.lastShowSig = null;
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
      tick. A signature guard skips no-op fires AND pure node-position (x/y) drags,
      so dragging the graph doesn't needlessly reset engine voices; transport lives
      on a separate message so tempo edits never resend the Show. NOTE: setShow
      reseeds the engine (voices clear) — acceptable for authoring; a finer-grained
      live-update message is a future refinement. */
  private lastShowSig: string | null = null;
  private showSig(show: ReturnType<typeof buildShow>): string {
    return JSON.stringify(show, (k, v) => (k === 'x' || k === 'y' ? 0 : v));
  }
  private syncShowToServer(): void {
    if (this.link !== 'open') return;
    const show = buildShow(this);
    const sig = this.showSig(show);
    if (sig === this.lastShowSig) return;
    this.lastShowSig = sig;
    this.client.send({ t: 'setShow', show });
    // setShow reseeds the active section to the first song/section — restore focus.
    if (this.activeSectionId) {
      this.client.send({ t: 'recallSection', songId: this.activeSongId, sectionId: this.activeSectionId });
    }
  }

  /** Send setTransport to the server iff bpm/playing/beatsPerBar changed. */
  private syncTransport(): void {
    if (this.link !== 'open') return;
    const cur = { bpm: this.bpm, playing: this.playing, beatsPerBar: this.beatsPerBar };
    const prev = this.lastSent;
    if (prev && prev.bpm === cur.bpm && prev.playing === cur.playing && prev.beatsPerBar === cur.beatsPerBar) {
      return;
    }
    this.lastSent = cur;
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

  /** Edit a drum's transform (origin/rotation/spin/start-angle/literal pixel count). */
  setDrumTransform(
    drumId: string,
    partial: {
      origin?: { x: number; y: number; z: number };
      rotation?: { x: number; y: number; z: number };
      localSpinDeg?: number;
      startAngleDeg?: number;
      pixelsPerHoop?: number;
      hoopSpacingMm?: number;
      diameterIn?: number;
    },
  ): void {
    const p = this.project;
    if (p) {
      this.project = {
        ...p,
        kit: { ...p.kit, drums: p.kit.drums.map((d) => (d.id === drumId ? { ...d, ...partial } : d)) },
      };
    }
    this.client.send({ t: 'setKitTransform', drumId, ...partial });
  }

  /** Replace the physical-output topology (a Patch graph rewire → PixLite patch order). */
  setRouting(outputs: OutputConfig[]): void {
    const p = this.project;
    if (p) this.project = { ...p, kit: { ...p.kit, outputs } };
    this.client.send({ t: 'setKitOutputs', outputs });
  }

  /** Replace the input map (zone-node MIDI note / OSC address routing). */
  setInputMap(inputMap: InputMap): void {
    const p = this.project;
    if (p) this.project = { ...p, inputMap };
    this.client.send({ t: 'setInputMap', inputMap });
  }

  /** Apply a partial output-settings change (controller node: protocol/host/rgb/fps/…). */
  setOutput(partial: {
    state?: Project['output']['state'];
    protocol?: Project['output']['protocol'];
    host?: string;
    rgbOrder?: Project['output']['rgbOrder'];
    fps?: number;
    broadcast?: boolean;
    priority?: number;
    port?: number;
    iface?: string;
  }): void {
    const p = this.project;
    if (p) this.project = { ...p, output: { ...p.output, ...partial } };
    this.client.send({ t: 'setOutput', ...partial });
  }

  /** Set or clear a Patch node's display-label override (the Inspector's rename field).
      A blank label clears the override (back to the derived title). Purely local + UI-only
      — the device topology ids aren't server state — so this persists via the authored
      autosave, never over WS. */
  setPatchLabel(nodeId: string, label: string): void {
    const trimmed = label.trim();
    const next = { ...this.patchLabels };
    if (trimmed) next[nodeId] = trimmed;
    else delete next[nodeId];
    this.patchLabels = next;
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
    let key = nid('graph');
    while (this.graphs[key]) key = nid('graph'); // global uniqueness (survives reload)
    const graph: TriggerGraph = { nodes: [makeNode('trigger', 'trigger')], edges: [] };
    const label = name?.trim() || this.nextGraphName();
    this.graphs = { ...this.graphs, [key]: graph };
    this.graphNames = { ...this.graphNames, [key]: label };
    this.selectedPadKey = key;
    return key;
  }

  /** Smallest unused "New graph N" label, so auto-named graphs stay distinct. */
  private nextGraphName(): string {
    const used = new Set(Object.values(this.graphNames));
    let n = 1;
    while (used.has(`New graph ${n}`)) n++;
    return `New graph ${n}`;
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

  private firstEffectId(): string {
    return this.effects.find((e) => e.scope === 'drum')?.id ?? this.effects[0]!.id;
  }
  effectsForScope(scope: Scope): typeof EFFECTS {
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
  liveParams(node: GraphNode) {
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
      const effId = this.firstEffectId();
      const eff = this.effects.find((e) => e.id === effId)!;
      node = makeNode('play', nid('n'), x, y, {
        scope: eff.scope,
        effectId: effId,
        presetId: `${effId}:default`,
        params: { ...(this.presetById(`${effId}:default`)?.params ?? defaultParams(eff)) },
      });
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
    if (!g || fromId === toId) return;
    const from = g.nodes.find((n) => n.id === fromId);
    const to = g.nodes.find((n) => n.id === toId);
    if (!from || !to || !nodeHasOutput(from.kind) || !nodeHasInput(to.kind)) return;
    // dup is per source-port: two different bands MAY route to the same child, but the
    // same (source-port → target) wire is rejected.
    if (g.edges.some((e) => e.from === fromId && e.to === toId && (e.fromPort ?? null) === (fromPort ?? null))) return;
    if (this.reaches(g, toId, fromId)) return; // would form a cycle
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
    if (!g || fromId === toId) return;
    const edge = g.edges.find((e) => e.id === edgeId);
    if (!edge) return;
    const from = g.nodes.find((n) => n.id === fromId);
    const to = g.nodes.find((n) => n.id === toId);
    if (!from || !to || !nodeHasOutput(from.kind) || !nodeHasInput(to.kind)) return;
    if (g.edges.some((e) => e.id !== edgeId && e.from === fromId && e.to === toId && (e.fromPort ?? null) === (fromPort ?? null))) return; // dup
    // cycle check over the graph WITHOUT the edge being moved
    if (this.reaches({ nodes: g.nodes, edges: g.edges.filter((e) => e.id !== edgeId) }, toId, fromId)) return;
    edge.from = fromId;
    edge.to = toId;
    edge.fromPort = fromPort;
  }
  private reaches(g: TriggerGraph, startId: string, targetId: string): boolean {
    const seen = new Set<string>();
    const stack = [startId];
    while (stack.length) {
      const cur = stack.pop()!;
      if (cur === targetId) return true;
      if (seen.has(cur)) continue;
      seen.add(cur);
      for (const e of g.edges) if (e.from === cur) stack.push(e.to);
    }
    return false;
  }

  /** Change a node's kind, seeding play fields and dropping outgoing wires for sinks. */
  changeKind(node: GraphNode, kind: NodeKind): void {
    if (node.kind === 'trigger' || kind === 'trigger') return;
    node.kind = kind;
    if (kind === 'play') {
      if (!node.effectId) {
        const effId = this.firstEffectId();
        const eff = this.effects.find((e) => e.id === effId)!;
        node.effectId = effId;
        node.scope = eff.scope;
        node.presetId = `${effId}:default`;
        node.params = { ...(this.presetById(`${effId}:default`)?.params ?? defaultParams(eff)) };
      }
      const g = this.selectedGraph;
      if (g) g.edges = g.edges.filter((e) => e.from !== node.id);
    }
  }

  setMode(node: GraphNode, mode: PlayMode): void {
    if (node.kind === 'play') node.mode = mode;
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
    node.valueMode = node.valueMode ?? 'gate';
    node.threshold = node.threshold ?? 0.5;
    node.invert = node.invert ?? false;
    node.bands = Array.isArray(node.bands) && node.bands.length > 0 ? node.bands : [0.5];
  }

  /** Drop per-band source ports from a node's outgoing edges, collapsing them to the
      default output — so leaving bands mode never strands a wire on a handle the node
      no longer renders (which xyflow can't draw). */
  private stripBandPorts(node: GraphNode): void {
    const g = this.selectedGraph;
    if (!g) return;
    for (const e of g.edges) if (e.from === node.id && e.fromPort !== undefined) e.fromPort = undefined;
  }

  setValueMode(node: GraphNode, mode: ValueMode): void {
    if (node.kind !== 'switch' || node.on !== 'value') return;
    node.valueMode = mode;
    // gate has a single output; collapse any band wires so they fire as default children.
    if (mode === 'gate') this.stripBandPorts(node);
  }
  setThreshold(node: GraphNode, threshold: number): void {
    if (node.kind !== 'switch' || node.on !== 'value') return;
    node.threshold = clamp01(threshold);
  }
  setInvert(node: GraphNode, invert: boolean): void {
    if (node.kind !== 'switch' || node.on !== 'value') return;
    node.invert = invert;
  }
  /** Append a band by splitting the final "rest" band (a new cutoff between the last
      cutoff and 1). Appending never disturbs existing band ports. */
  addBand(node: GraphNode): void {
    if (node.kind !== 'switch' || node.on !== 'value') return;
    const bands = Array.isArray(node.bands) && node.bands.length ? node.bands : [0.5];
    const last = bands[bands.length - 1] ?? 0.5;
    node.bands = [...bands, clamp01((last + 1) / 2)];
  }
  /** Remove cutoff `cutoffIndex` (merging band cutoffIndex+1 down into it), keeping at
      least one cutoff (≥2 bands). Remaps the outgoing band ports to match. */
  removeBand(node: GraphNode, cutoffIndex: number): void {
    if (node.kind !== 'switch' || node.on !== 'value') return;
    const bands = node.bands ?? [0.5];
    if (bands.length <= 1 || cutoffIndex < 0 || cutoffIndex >= bands.length) return;
    node.bands = bands.filter((_, i) => i !== cutoffIndex);
    this.remapBandPorts(node, cutoffIndex);
  }
  /** Set cutoff `cutoffIndex`, clamped WITHIN its neighbours so cutoffs stay ascending
      without reordering — reordering would scramble which band each port maps to. */
  setBandCutoff(node: GraphNode, cutoffIndex: number, value: number): void {
    if (node.kind !== 'switch' || node.on !== 'value') return;
    const bands = [...(node.bands ?? [0.5])];
    if (cutoffIndex < 0 || cutoffIndex >= bands.length) return;
    const lo = cutoffIndex > 0 ? bands[cutoffIndex - 1]! : 0;
    const hi = cutoffIndex < bands.length - 1 ? bands[cutoffIndex + 1]! : 1;
    bands[cutoffIndex] = Math.min(hi, Math.max(lo, clamp01(value)));
    node.bands = bands;
  }
  /** After cutoff `removed` is dropped, band (removed+1) merges into `removed` and every
      higher band shifts down one — remap edge ports to match, then drop any duplicate
      (target, port) wires the merge collided. */
  private remapBandPorts(node: GraphNode, removed: number): void {
    const g = this.selectedGraph;
    if (!g) return;
    const seen = new Set<string>();
    const kept: typeof g.edges = [];
    for (const e of g.edges) {
      if (e.from === node.id && e.fromPort?.startsWith('band-')) {
        const b = Number(e.fromPort.slice('band-'.length));
        if (Number.isFinite(b) && b > removed) e.fromPort = `band-${b - 1}`;
        const key = `${e.to}|${e.fromPort}`;
        if (seen.has(key)) continue; // merge collided two wires onto the same band+target
        seen.add(key);
      }
      kept.push(e);
    }
    g.edges = kept;
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
  createEffect(input: {
    name: string;
    pattern: Pattern;
    scope: Scope;
    busId: string;
    attackMs: number;
    sustainMs: number;
    releaseMs: number;
    params: ParamSpec[];
  }): string {
    const base = input.name.trim().toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '') || 'effect';
    let id = base;
    let n = 2;
    while (this.effects.some((e) => e.id === id)) id = `${base}-${n++}`;
    const eff: EffectDef = {
      id,
      name: input.name.trim() || 'Untitled',
      pattern: input.pattern,
      busId: input.busId,
      scope: input.scope,
      attackMs: input.attackMs,
      sustainMs: input.sustainMs,
      releaseMs: input.releaseMs,
      params: input.params,
    };
    this.effects.push(eff);
    this.sim.registerEffect(eff);
    const preset: Preset = { id: `${id}:default`, name: 'Default', effectId: id, params: defaultParams(eff) };
    this.presets.push(preset);
    this.sim.registerPreset(preset);
    return id;
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
