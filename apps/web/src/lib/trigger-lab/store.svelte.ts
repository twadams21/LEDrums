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
  type Voice,
  type GraphNode,
  type NodeKind,
  type TriggerGraph,
  treeToGraph,
  makeNode,
  nodeHasOutput,
  nodeHasInput,
} from './sim';
import { BUSES, DRUMS, EFFECTS, PADS, PRESETS, SECTIONS, play, type Pad } from './fixtures';
import { buildLabModel } from './kit';
import { renderFrame as compositeFrame } from './render';
import { WSClient, type ConnectionState } from '../ws/client';
import type { SerializedModel } from '../ws/protocol-types';
import { buildShow } from './show-builder';

let idSeq = 1000;
const nid = (k: string) => `${k}-${idSeq++}`;

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
      return { id: nid('switch'), kind: 'switch', on: 'velocity', children: [play(firstEffectId), play(firstEffectId)] };
    case 'chance':
      return { id: nid('chance'), kind: 'chance', p: 0.5, child: play(firstEffectId) };
    case 'toggle':
      return { id: nid('toggle'), kind: 'toggle', child: play(firstEffectId, 'loop') };
  }
}

const padKey = (p: Pad) => `${p.drumId}:${p.zone}`;

export class TriggerLab {
  // editable config (shared by reference with the sim)
  buses = $state<Bus[]>(BUSES.map((b) => ({ ...b })));
  pads = $state<Pad[]>(structuredClone(PADS));
  /** per-pad freeform trigger graphs (keyed by padKey) — the editable model. */
  graphs = $state<Record<string, TriggerGraph>>(Object.fromEntries(PADS.map((p) => [padKey(p), treeToGraph(p.tree)])));
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

  // section recall (timed morph only)
  activeSectionId = $state<string | null>(null);

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

  constructor(makeClient: () => WSClient = () => new WSClient()) {
    this.sim = new Sim(this.buses, EFFECTS, this.presets);
    this.client = makeClient();
  }

  selectedPad = $derived(this.pads.find((p) => padKey(p) === this.selectedPadKey) ?? null);
  selectedGraph = $derived(this.selectedPadKey ? this.graphs[this.selectedPadKey] ?? null : null);
  activeSection = $derived(this.sections.find((s) => s.id === this.activeSectionId) ?? null);
  beatPhase = $derived((this.beat % 4) / 4);

  // --- lifecycle -----------------------------------------------------------

  start(): void {
    if (this.raf) return;
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
  }

  // --- engine link plumbing ------------------------------------------------

  /** Attach the WS callbacks (idempotent — start() may be called after a stop). */
  private wireClient(): void {
    this.client.on({
      onState: (_project, model) => {
        // adopt the engine's real kit model so its frames map 1:1 in the preview
        // (the server runs its own kit geometry/pixel count, not the lab kit).
        this.serverModel = model;
      },
      onConnection: (state: ConnectionState) => {
        // map the client's 'closed' to the lab's 'offline'; others pass through
        this.link = state === 'closed' ? 'offline' : state;
        if (state === 'open') {
          // hand the server the authored content, then the current transport
          this.client.send({ t: 'setShow', show: buildShow(this) });
          this.lastSent = { bpm: this.bpm, playing: this.playing, beatsPerBar: this.beatsPerBar };
          this.client.send({ t: 'setTransport', ...this.lastSent });
        } else {
          // a drop means our next open must re-send the transport
          this.lastSent = null;
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

  hit(pad: Pad): void {
    const g = this.graphs[padKey(pad)];
    if (!g) return;
    const idx = this.sections.findIndex((s) => s.id === this.activeSectionId);
    this.sim.triggerGraph(`${pad.drumLabel} · ${pad.zoneLabel}`, g, {
      velocity: this.velocity,
      sectionIndex: idx < 0 ? 0 : idx,
      sectionCount: this.sections.length,
      beatPhase: this.beatPhase,
      sourceDrumId: pad.drumId,
    });
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

  // --- section recall (branch 3 — timed morph) -----------------------------

  recall(sectionId: string): void {
    const s = this.sections.find((x) => x.id === sectionId);
    if (!s) return;
    this.activeSectionId = sectionId;
    this.sim.recallSection(s);
    this.snapshot();
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

  /** Wire a node's output to another's input (rejects dup / cycle / bad direction). */
  connect(fromId: string, toId: string): void {
    const g = this.selectedGraph;
    if (!g || fromId === toId) return;
    const from = g.nodes.find((n) => n.id === fromId);
    const to = g.nodes.find((n) => n.id === toId);
    if (!from || !to || !nodeHasOutput(from.kind) || !nodeHasInput(to.kind)) return;
    if (g.edges.some((e) => e.from === fromId && e.to === toId)) return;
    if (this.reaches(g, toId, fromId)) return; // would form a cycle
    g.edges.push({ id: nid('e'), from: fromId, to: toId });
  }
  disconnect(edgeId: string): void {
    const g = this.selectedGraph;
    if (g) g.edges = g.edges.filter((e) => e.id !== edgeId);
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
    if (node.kind === 'switch') node.on = on;
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
