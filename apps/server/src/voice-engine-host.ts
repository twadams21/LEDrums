import {
  advanceTransport,
  blockingRoutingIssues,
  buildDmxMap,
  buildPixelModel,
  checkRoutingIntegrity,
  getHoopPixelRange,
  SLOT_LABELS,
  voice,
  type DmxMap,
  type DrumConfig,
  type InputMap,
  type KitConfig,
  type KitGlobalConfig,
  type OutputConfig,
  type OutputSettings,
  type Project,
  type ProjectPatch,
  type Transport,
  type TransportState,
} from '@ledrums/core';
import { OutputManager, type OutputMonitorSink } from './output-manager';
import { zoneForNote, zoneForOsc } from './input-router';
import { frameToRgbBytes, type OutputStatus } from './ws-protocol';
import type { MonitorDraft } from './monitor';

/**
 * Partial input the voice host stamps with `timeMs = engineTimeMs` before applying.
 * Mirrors {@link voice.InputEvent} minus the time stamp — `key` is the voice-mode
 * native pad hit (drum + zone), `noteOn`/`noteOff`/`osc` carry the legacy wire shapes
 * and are resolved to a (drum, zone) pad via the project's inputMap.
 */
export type VoicePartialInput =
  | { kind: 'noteOn'; note: number; velocity: number; channel?: number }
  | { kind: 'noteOff'; note: number; channel?: number }
  | { kind: 'osc'; address: string; value: number }
  | { kind: 'key'; drumId: string; zone?: string; velocity?: number }
  | { kind: 'fireGraph'; graphKey: string; velocity?: number }
  | { kind: 'recallSection'; songId?: string; sectionId: string }
  | { kind: 'cc'; controller: number; value: number; channel?: number }; // S37

/** Stats reported to clients for the voice path (the voice extension of `stats`). */
export interface VoiceHostStats {
  engine: voice.EngineStats;
  latencyMs: number;
  fps: number;
  output: OutputStatus;
}

const TICK_MS = 1000 / 120; // fixed-timestep target (~120fps) — the voice path runs hot
const MAX_DT_MS = 100; // clamp to survive GC pauses / tab throttling
const PREVIEW_FPS = 30; // WS preview broadcast throttle

/**
 * Voice-mode host: owns a {@link voice.RenderEngine} (the trigger-graph / voice-bus
 * brain) and an {@link OutputManager}, running the SAME fixed-timestep discipline as
 * the legacy {@link EngineHost} (recursive `setTimeout` + accumulator + catch-up
 * clamp) but at 120fps. Transmit + preview streams are throttled independently of the
 * tick rate, exactly like the legacy host.
 *
 * This is a deliberately separate class (not a mode bolted onto EngineHost) so the
 * legacy layer/clip/binding path stays untouched and this is easy to rip out.
 */
export class VoiceEngineHost {
  readonly engine: voice.RenderEngine;
  private project: Project;
  /** Live kit geometry (shares the reference held by `project.kit`); mutated in place
   * by the runtime-mutable setters below so the active render reflects edits at once. */
  private kit: KitConfig;
  private model: ReturnType<typeof buildPixelModel>;
  private dmxMap: DmxMap;
  private readonly output: OutputManager;

  /** Cumulative dt fed to `engine.tick` — the clock inputs are stamped against. */
  engineTimeMs = 0;
  /** Running beat clock (advanced by `advanceTransport`). */
  private beat = 0;

  private timer: ReturnType<typeof setTimeout> | null = null;
  private lastWall = 0;
  private accumulator = 0;

  /** Time owed before the next output transmit (1000/output.fps). */
  private transmitAccum = 0;
  /** Time owed before the next preview broadcast (1000/PREVIEW_FPS). */
  private previewAccum = 0;

  /** Wall time of the most recent input still awaiting its first emitted frame. */
  private pendingInputWall: number | null = null;
  lastLatencyMs = 0;

  /** Measured loop rate (frames ticked per second), updated ~1/s. */
  private measuredFps = 0;
  private fpsTicks = 0;
  private fpsWindowStart = 0;

  /** Preview frame sink (wired by `main` to broadcast over WS). */
  onFrame?: (rgb: Uint8Array) => void;

  /** The live Show (retained so the global transport-recall handler can map a
   * Program Change / CC#0 / OSC index → song & section ids). null until first setShow. */
  private currentShow: voice.Show | null = null;
  /** The active song id for index-relative recalls (CC#0). Seeded from the first song on
   * setShow, updated whenever a recallSection names a song (web- or transport-driven). */
  private activeSongId: string | null = null;
  private monitorSink: ((event: MonitorDraft) => void) | null = null;

  /** The offending-reference detail from the most recent routing degradation, buffered until a
   * monitor sink can carry it (a degradation at construction happens before {@link setMonitor}
   * wires the sink). null once reported or once routing rebuilds cleanly. */
  private pendingRoutingDegradation: string | null = null;

  constructor(
    project: Project,
    engine: voice.RenderEngine | null = null,
    output: OutputManager = new OutputManager(),
  ) {
    this.project = project;
    this.kit = project.kit;
    this.engine = engine ?? voice.createVoiceBusEngine({ onDiagnostic: (d) => this.monitorVoiceDiagnostic(d) });
    this.output = output;
    this.model = buildPixelModel(this.kit);
    this.dmxMap = this.buildMapSafe(this.kit);
    this.engine.setModel(this.model);
  }

  // --- geometry ------------------------------------------------------------

  /** Build a DMX map, falling back to a flat single-output map on invalid topology
   * (mirrors the legacy Engine.buildMapSafe so preview/output never wedge). The fallback is
   * no longer silent (S07): the offending reference is named and reported as a Monitor `error`
   * event before degrading, so a corrupt routing surfaces loudly instead of going dark. */
  private buildMapSafe(kit: KitConfig): DmxMap {
    try {
      const map = buildDmxMap(kit, this.model);
      this.pendingRoutingDegradation = null; // routing is healthy again
      return map;
    } catch (err) {
      // Name WHICH reference broke routing (dangling drum ref / out-of-range hoop — exactly what
      // buildDmxMap throws on) before falling back. checkRoutingIntegrity re-derives it structurally;
      // fall back to the raw throw text only if it somehow finds nothing. Only BLOCKING (error) issues
      // caused this throw — filter out `hoop-uncovered` warnings so they don't pollute the degradation
      // message (an uncovered hoop never degrades the map; buildDmxMap only threw on a real corruption).
      const issues = blockingRoutingIssues(checkRoutingIntegrity(kit));
      this.pendingRoutingDegradation = issues.length
        ? issues.map((i) => i.message).join('; ')
        : err instanceof Error
          ? err.message
          : String(err);
      this.reportRoutingDegradation();
      const flat: KitConfig = {
        ...kit,
        outputs: [],
        global: { ...kit.global, maxPixelsPerOutput: Number.MAX_SAFE_INTEGER },
      };
      return buildDmxMap(flat, this.model);
    }
  }

  /** Emit the buffered routing-degradation diagnostic once a sink can carry it, then clear it.
   * A no-op when nothing degraded or no sink is wired yet (the buffer survives until one is). */
  private reportRoutingDegradation(): void {
    if (this.pendingRoutingDegradation === null || !this.monitorSink) return;
    this.monitorSink({
      type: 'error',
      direction: 'local',
      source: 'server/voice',
      destination: 'routing',
      label: 'Routing topology invalid — degraded to flat map',
      detail: this.pendingRoutingDegradation,
    });
    this.pendingRoutingDegradation = null;
  }

  getProject(): Project {
    return this.project;
  }

  getModel(): ReturnType<typeof buildPixelModel> {
    return this.model;
  }

  getDmxMap(): DmxMap {
    return this.dmxMap;
  }

  // --- runtime-mutable geometry / routing ----------------------------------

  /** Rebuild every model-derived structure from the current kit and re-apply output.
   * Call after any geometry edit so the live render + transmit reflect it at once. */
  reloadKit(): void {
    this.model = buildPixelModel(this.kit);
    this.engine.setModel(this.model);
    this.dmxMap = this.buildMapSafe(this.kit);
    this.reloadOutputSettings();
  }

  /** Edit a drum's transform (origin/rotation/spin/start-angle/literal pixel count) and
   * rebuild geometry live. Unknown drum id is a no-op. */
  setKitTransform(
    drumId: string,
    partial: Partial<
      Pick<DrumConfig, 'origin' | 'rotation' | 'localSpinDeg' | 'startAngleDeg' | 'pixelsPerHoop' | 'hoopSpacingMm' | 'diameterIn' | 'flip'>
    >,
  ): void {
    const drum = this.kit.drums.find((d) => d.id === drumId);
    if (!drum) return;
    Object.assign(drum, partial);
    this.reloadKit();
  }

  /** Edit a KIT-GLOBAL geometry field (e.g. mirror) and rebuild geometry live. Kit-global,
   * not per-drum — the whole model reflects. Rebuilds the model (not just dmxMap). */
  setKitGlobal(partial: Partial<Pick<KitGlobalConfig, 'mirror'>>): void {
    Object.assign(this.kit.global, partial);
    this.reloadKit();
  }

  /** Replace the physical-output topology (PixLite patch order). Outputs change the DMX
   * patch only, not geometry — rebuild the dmxMap and re-apply output, skip the model. */
  setKitOutputs(outputs: OutputConfig[]): void {
    this.kit.outputs = outputs;
    this.dmxMap = this.buildMapSafe(this.kit);
    this.reloadOutputSettings();
  }

  /** Bulk-adopt a validated project PATCH (kit incl. outputs, input map, output settings) in ONE
   * step — the live end of the S45 `setProject` message. Swaps the three device slices wholesale
   * and rebuilds geometry ONCE ({@link reloadKit} → model + dmxMap + output re-apply), never a
   * granular replay. Authored composition/setlist are untouched. The caller has already
   * schema-validated `patch`, so this only touches state once acceptance is guaranteed. */
  adoptPatch(patch: ProjectPatch): void {
    this.project = {
      ...this.project,
      name: patch.name ?? this.project.name,
      kit: patch.kit,
      inputMap: patch.inputMap,
      output: patch.output,
    };
    this.kit = this.project.kit;
    this.reloadKit();
  }

  /** Replace the show the engine runs (authored voice-bus content). Retains it + reseeds
   * the active song so transport recall maps indices against the current arrangement. */
  setShow(show: voice.Show): void {
    this.currentShow = show;
    this.activeSongId = show.songs?.[0]?.id ?? null;
    this.engine.setShow(show);
  }

  /** The live Show, for the global transport-recall index→id mapping (null before setShow). */
  getShow(): voice.Show | null {
    return this.currentShow;
  }

  /** The active song id CC#0 section recalls resolve against (null before setShow). */
  getActiveSongId(): string | null {
    return this.activeSongId;
  }

  // --- input ---------------------------------------------------------------

  /**
   * Resolve a partial input to a {@link voice.InputEvent} and apply it. `key` is native
   * (drum + zone). `noteOn`/`osc` route through the PINNED precedence: the patch inputMap
   * zone-map first ({@link zoneForNote}/{@link zoneForOsc} → a `(drumId, zone)` pad, the
   * pad-bound graph path). On a zone-map MISS the raw note/address is forwarded WITHOUT a
   * pad, so the engine fires any graph bound DIRECTLY to it by its trigger source (and an
   * event never fires both — exactly one of the two paths runs). `noteOff` passes through
   * (the engine decays voices on their own envelopes).
   */
  applyInput(partial: VoicePartialInput): void {
    this.pendingInputWall = nowWall();
    // Track the active song so index-relative recalls (CC#0) resolve against whatever was
    // last recalled — whether by the UI or by a global transport recall.
    if (partial.kind === 'recallSection' && partial.songId) this.activeSongId = partial.songId;
    const ev = this.toInputEvent(partial);
    if (ev) this.engine.applyInput(ev);
  }

  private toInputEvent(partial: VoicePartialInput): voice.InputEvent | null {
    const timeMs = this.engineTimeMs;
    switch (partial.kind) {
      case 'recallSection':
        return {
          kind: 'recallSection',
          songId: partial.songId,
          sectionId: partial.sectionId,
          timeMs,
        };
      case 'key':
        return {
          kind: 'key',
          drumId: partial.drumId,
          zone: partial.zone ?? SLOT_LABELS[0],
          velocity: partial.velocity ?? 1,
          timeMs,
        };
      case 'fireGraph':
        // Authoritative graph intent (keyboard performance): the engine plays this exact
        // graph key — no zone-map, no source re-resolution. Velocity defaults to full.
        return {
          kind: 'fireGraph',
          graphKey: partial.graphKey,
          velocity: partial.velocity ?? 1,
          timeMs,
        };
      case 'noteOn': {
        // Zone-map first; a miss forwards the raw note (no pad) for direct binding.
        const pad = zoneForNote(this.project.inputMap, partial.note);
        return {
          kind: 'noteOn',
          ...(pad ? { drumId: pad.drumId, zone: pad.zone } : {}),
          note: partial.note,
          velocity: partial.velocity,
          channel: partial.channel,
          timeMs,
        };
      }
      case 'noteOff':
        // No engine effect today; forward the raw note so the seam stays honest.
        return { kind: 'noteOff', note: partial.note, channel: partial.channel, timeMs };
      case 'osc': {
        // Always forward; attach a pad when the zone-map claims it, else direct binding.
        const pad = zoneForOsc(this.project.inputMap, partial.address);
        return {
          kind: 'osc',
          ...(pad ? { drumId: pad.drumId, zone: pad.zone } : {}),
          address: partial.address,
          value: partial.value,
          timeMs,
        };
      }
      case 'cc':
        // S37: raw MIDI CC → the engine's CC value table. Value stays raw 0..127 (the engine
        // normalizes to 0..1); channel is forwarded for the per-node channel filter.
        return {
          kind: 'cc',
          controller: partial.controller,
          value: partial.value,
          ...(partial.channel !== undefined ? { channel: partial.channel } : {}),
          timeMs,
        };
    }
  }

  /** Mark an input ingress for the latency loop without constructing an event here. */
  markInput(): void {
    this.pendingInputWall = nowWall();
  }

  /** Replace the input map the note/OSC resolvers read (zone-node MIDI/OSC editing). */
  setInputMap(map: InputMap): void {
    this.project.inputMap = map;
  }

  // --- hoop identify (E1) --------------------------------------------------

  /**
   * Fire-and-forget hoop identify (E1): drive one hoop's pixels full-on for `durationMs`,
   * composited over the live frame by the OutputManager (never blocks the render loop). `hoop`
   * is 1-based (A1). Unknown drum/hoop or `durationMs <= 0` clears any active identify.
   */
  identifyHoop(drumId: string, hoop: number, durationMs: number): void {
    const range = getHoopPixelRange(this.model, drumId, hoop);
    this.output.setIdentify(range, durationMs);
  }

  /** The active hoop-identify pixel range, or `null` when none is armed (E1 observability). */
  getIdentifyRange(): { start: number; end: number } | null {
    return this.output.identifyRange();
  }

  // --- output settings -----------------------------------------------------

  /** Re-apply the project's output settings to the OutputManager. */
  reloadOutputSettings(): void {
    this.output.applySettings(this.project.output, this.dmxMap);
  }

  /** Apply a partial output-settings change (state/protocol/host/rgbOrder/fps/...) and
   * re-apply it to the transport live. */
  setOutput(partial: Partial<OutputSettings>): void {
    Object.assign(this.project.output, partial);
    this.reloadOutputSettings();
  }

  // --- lifecycle -----------------------------------------------------------

  start(): void {
    if (this.timer) return;
    this.reloadOutputSettings();
    this.lastWall = nowWall();
    this.fpsWindowStart = this.lastWall;
    this.accumulator = 0;
    this.scheduleNext();
  }

  stop(): void {
    if (this.timer) {
      clearTimeout(this.timer);
      this.timer = null;
    }
    this.output.blackout(this.dmxMap);
    this.output.close();
  }

  private scheduleNext(): void {
    this.timer = setTimeout(() => {
      this.loop();
      if (this.timer) this.scheduleNext();
    }, TICK_MS);
  }

  /** One wall-clock loop iteration: catch the accumulator up in fixed steps. */
  private loop(): void {
    const now = nowWall();
    let elapsed = now - this.lastWall;
    this.lastWall = now;
    if (elapsed > MAX_DT_MS) elapsed = MAX_DT_MS; // clamp to survive long pauses
    this.accumulator += elapsed;

    // Drain accumulated time in fixed steps. At 120fps a 100ms pause is 12 steps,
    // so the catch-up budget is double the legacy host's to keep wall-clock honest.
    let steps = 0;
    while (this.accumulator >= TICK_MS && steps < 12) {
      this.step(TICK_MS);
      this.accumulator -= TICK_MS;
      steps++;
    }
    if (this.accumulator >= TICK_MS) this.accumulator = 0; // drop backlog; never spiral
  }

  /** Compute the transport snapshot for the current engine time + dt. */
  private transport(dt: number): TransportState {
    const config: Transport = this.project.composition.transport;
    const { beat, state } = advanceTransport(config, this.beat, this.engineTimeMs, dt);
    this.beat = beat;
    return state;
  }

  /**
   * Advance the engine by `dt`, then service the throttled transmit and preview
   * streams. Public so tests can drive the loop deterministically without timers.
   */
  step(dt: number): void {
    this.engineTimeMs += dt;
    const transport = this.transport(dt);
    this.engine.tick(this.engineTimeMs, dt, transport);

    // Loop-rate measurement (rolling 1s window).
    this.fpsTicks++;
    const sinceWindow = this.engineTimeMs - this.fpsWindowStart;
    if (sinceWindow >= 1000) {
      this.measuredFps = (this.fpsTicks * 1000) / sinceWindow;
      this.fpsTicks = 0;
      this.fpsWindowStart = this.engineTimeMs;
    }

    let emittedFrame = false;

    // --- transmit (throttled to project.output.fps, NOT the 120fps tick) ---
    const txFps = this.project.output.fps || 1;
    this.transmitAccum += dt;
    const txInterval = 1000 / txFps;
    if (this.transmitAccum >= txInterval) {
      this.transmitAccum -= txInterval;
      if (this.transmitAccum > txInterval) this.transmitAccum = 0; // clamp backlog
      this.output.sendFrame(this.engine.frame() as Float32Array, this.dmxMap);
      emittedFrame = true;
    }

    // --- preview (throttled to ~30fps) ---
    this.previewAccum += dt;
    const pvInterval = 1000 / PREVIEW_FPS;
    if (this.previewAccum >= pvInterval) {
      this.previewAccum -= pvInterval;
      if (this.previewAccum > pvInterval) this.previewAccum = 0;
      if (this.onFrame) {
        this.onFrame(frameToRgbBytes(this.engine.frame() as Float32Array, this.model.pixelCount));
      }
      emittedFrame = true;
    }

    // Hit→light latency: first frame emitted after an input closes the loop.
    if (emittedFrame && this.pendingInputWall !== null) {
      this.lastLatencyMs = nowWall() - this.pendingInputWall;
      this.pendingInputWall = null;
    }
  }

  // --- status --------------------------------------------------------------

  getStats(): VoiceHostStats {
    return {
      engine: this.engine.stats(),
      latencyMs: this.lastLatencyMs,
      fps: this.measuredFps,
      output: this.output.status(),
    };
  }

  getOutputStatus(): OutputStatus {
    return this.output.status();
  }

  setOutputMonitor(sink: OutputMonitorSink): void {
    this.output.onMonitor = sink;
  }

  setMonitor(sink: (event: MonitorDraft) => void): void {
    this.monitorSink = sink;
    // A routing degradation at construction (before any sink) is buffered — flush it now so a
    // corrupt persisted project loaded at boot still surfaces its named diagnostic.
    this.reportRoutingDegradation();
  }

  private monitorVoiceDiagnostic(d: voice.VoiceDiagnostic): void {
    if (d.kind === 'input-resolved') {
      this.monitorSink?.({
        type: 'graph',
        direction: 'local',
        source: 'server/voice',
        destination: `graph:${d.graphKey}`,
        label: `Graph resolved ${d.graphKey}`,
        detail: `input=${describeVoiceInput(d.input)}; path=${d.path}; state=${d.statePrefix}`,
      });
      return;
    }

    if (d.kind === 'graph-fired') {
      const effectLabels = this.effectLabels(d.playEffects);
      this.monitorSink?.({
        type: 'graph',
        direction: 'local',
        source: 'server/voice',
        destination: `graph:${d.graphKey}`,
        label: `Graph fired ${d.graphKey}`,
        detail: `input=${describeVoiceInput(d.input)}; path=${d.path}; state=${d.statePrefix}; actions=${d.actionCount}; effects=${effectLabels.join(', ') || 'none'}`,
      });
      return;
    }

    if (d.kind === 'graph-missed') {
      this.monitorSink?.({
        type: 'graph',
        direction: 'local',
        source: 'server/voice',
        label: 'No graph resolved',
        detail: `input=${describeVoiceInput(d.input)}; reason=${d.reason}`,
      });
      return;
    }

    if (d.kind === 'input-unrouted') {
      this.monitorSink?.({
        type: 'graph',
        direction: 'local',
        source: 'server/voice',
        label: 'Unrouted input',
        detail: `input=${describeVoiceInput(d.input)}; matched no zone or graph`,
      });
      return;
    }

    this.monitorSink?.({
      type: 'graph',
      direction: 'local',
      source: 'server/voice',
      destination: d.sectionId ? `section:${d.sectionId}` : undefined,
      label: 'Section recalled',
      detail: `song=${d.songId ?? 'none'}; section=${d.sectionId ?? 'none'}`,
    });
  }

  private effectLabels(ids: string[]): string[] {
    const effectsById = new Map(this.currentShow?.effects.map((e) => [e.id, e.name]) ?? []);
    return ids.map((id) => {
      const name = effectsById.get(id);
      return name && name !== id ? `${name} (${id})` : id;
    });
  }
}

function describeVoiceInput(input: voice.VoiceInputDescriptor): string {
  const parts: string[] = [input.kind];
  if (input.note !== undefined) parts.push(`note=${input.note}`);
  if (input.address !== undefined) parts.push(`address=${input.address}`);
  if (input.drumId !== undefined) parts.push(`pad=${input.drumId}:${input.zone ?? ''}`);
  if (input.velocity !== undefined) parts.push(`velocity=${input.velocity}`);
  if (input.value !== undefined) parts.push(`value=${input.value}`);
  if (input.songId !== undefined) parts.push(`song=${input.songId}`);
  if (input.sectionId !== undefined) parts.push(`section=${input.sectionId}`);
  if (input.graphKey !== undefined) parts.push(`graph=${input.graphKey}`);
  return parts.join('; ');
}

/** Wall clock (ms). Indirected so the host has no direct `performance` coupling. */
function nowWall(): number {
  return performance.now();
}
