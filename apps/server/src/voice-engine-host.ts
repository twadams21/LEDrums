import {
  advanceTransport,
  buildDmxMap,
  buildPixelModel,
  SLOT_LABELS,
  voice,
  type DmxMap,
  type DrumConfig,
  type InputMap,
  type KitConfig,
  type OutputConfig,
  type OutputSettings,
  type Project,
  type Transport,
  type TransportState,
} from '@ledrums/core';
import { OutputManager } from './output-manager';
import { frameToRgbBytes, type OutputStatus } from './ws-protocol';

/**
 * Partial input the voice host stamps with `timeMs = engineTimeMs` before applying.
 * Mirrors {@link voice.InputEvent} minus the time stamp — `key` is the voice-mode
 * native pad hit (drum + zone), `noteOn`/`noteOff`/`osc` carry the legacy wire shapes
 * and are resolved to a (drum, zone) pad via the project's inputMap.
 */
export type VoicePartialInput =
  | { kind: 'noteOn'; note: number; velocity: number }
  | { kind: 'noteOff'; note: number }
  | { kind: 'osc'; address: string; value: number }
  | { kind: 'key'; drumId: string; zone?: string; velocity?: number }
  | { kind: 'recallSection'; songId?: string; sectionId: string };

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

  constructor(
    project: Project,
    engine: voice.RenderEngine = voice.createVoiceBusEngine(),
    output: OutputManager = new OutputManager(),
  ) {
    this.project = project;
    this.kit = project.kit;
    this.engine = engine;
    this.output = output;
    this.model = buildPixelModel(this.kit);
    this.dmxMap = this.buildMapSafe(this.kit);
    this.engine.setModel(this.model);
  }

  // --- geometry ------------------------------------------------------------

  /** Build a DMX map, falling back to a flat single-output map on invalid topology
   * (mirrors the legacy Engine.buildMapSafe so preview/output never wedge). */
  private buildMapSafe(kit: KitConfig): DmxMap {
    try {
      return buildDmxMap(kit, this.model);
    } catch {
      const flat: KitConfig = {
        ...kit,
        outputs: [],
        global: { ...kit.global, maxPixelsPerOutput: Number.MAX_SAFE_INTEGER },
      };
      return buildDmxMap(flat, this.model);
    }
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
      Pick<DrumConfig, 'origin' | 'rotation' | 'localSpinDeg' | 'startAngleDeg' | 'pixelsPerHoop'>
    >,
  ): void {
    const drum = this.kit.drums.find((d) => d.id === drumId);
    if (!drum) return;
    Object.assign(drum, partial);
    this.reloadKit();
  }

  /** Replace the physical-output topology (PixLite patch order). Outputs change the DMX
   * patch only, not geometry — rebuild the dmxMap and re-apply output, skip the model. */
  setKitOutputs(outputs: OutputConfig[]): void {
    this.kit.outputs = outputs;
    this.dmxMap = this.buildMapSafe(this.kit);
    this.reloadOutputSettings();
  }

  /** Replace the show the engine runs (authored voice-bus content). */
  setShow(show: voice.Show): void {
    this.engine.setShow(show);
  }

  // --- input ---------------------------------------------------------------

  /**
   * Resolve a partial input to a {@link voice.InputEvent} and apply it. `key` is
   * native (drum + zone). `noteOn`/`osc` are resolved to a pad via the project's
   * inputMap: a MIDI note → (drumId, slot) and an OSC address → (drumId, slot), with
   * the slot index mapped to a zone label via {@link SLOT_LABELS}. `noteOff` is passed
   * through (the engine decays voices on their own envelopes).
   */
  applyInput(partial: VoicePartialInput): void {
    this.pendingInputWall = nowWall();
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
      case 'noteOn': {
        const pad = this.resolveNote(partial.note);
        if (!pad) return null;
        return { kind: 'noteOn', drumId: pad.drumId, zone: pad.zone, note: partial.note, velocity: partial.velocity, timeMs };
      }
      case 'noteOff':
        // No engine effect today; forward the raw note so the seam stays honest.
        return { kind: 'noteOff', note: partial.note, timeMs };
      case 'osc': {
        const pad = this.resolveOsc(partial.address);
        // Always forward so address-driven shows can react; attach a pad when mapped.
        return {
          kind: 'osc',
          ...(pad ? { drumId: pad.drumId, zone: pad.zone } : {}),
          address: partial.address,
          value: partial.value,
          timeMs,
        };
      }
    }
  }

  /** Resolve a MIDI note to a (drumId, zone) pad via the project inputMap. */
  private resolveNote(note: number): { drumId: string; zone: string } | null {
    const m = this.project.inputMap.midiNotes.find((x) => x.note === note);
    if (!m) return null;
    return { drumId: m.drumId, zone: slotToZone(m.slot) };
  }

  /** Resolve an OSC address to a (drumId, zone) pad via the project inputMap. */
  private resolveOsc(address: string): { drumId: string; zone: string } | null {
    const m = this.project.inputMap.oscMap.find((x) => x.address === address);
    if (!m) return null;
    return { drumId: m.drumId, zone: slotToZone(m.slot) };
  }

  /** Mark an input ingress for the latency loop without constructing an event here. */
  markInput(): void {
    this.pendingInputWall = nowWall();
  }

  /** Replace the input map the note/OSC resolvers read (zone-node MIDI/OSC editing). */
  setInputMap(map: InputMap): void {
    this.project.inputMap = map;
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
    this.output.blackout(this.dmxMap, this.project.output.rgbOrder);
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
}

/** Map a trigger slot index to a voice zone label (clamped into range). */
function slotToZone(slot: number): string {
  return SLOT_LABELS[Math.max(0, Math.min(SLOT_LABELS.length - 1, slot))] ?? SLOT_LABELS[0];
}

/** Wall clock (ms). Indirected so the host has no direct `performance` coupling. */
function nowWall(): number {
  return performance.now();
}
