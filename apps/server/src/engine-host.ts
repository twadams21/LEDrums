import { Engine, type InputEvent, type Project } from '@ledrums/core';
import { OutputManager } from './output-manager';
import { frameToRgbBytes, type OutputStatus } from './ws-protocol';

/** Stats reported to clients (the ServerMessage `stats` shape, sans `t`). */
export interface HostStats {
  engine: ReturnType<Engine['getStats']>;
  latencyMs: number;
  fps: number;
  output: OutputStatus;
}

/**
 * Partial input the host stamps with `timeMs = engineTimeMs` before enqueuing.
 * (The `kind` discriminant plus its payload, minus the time stamp.)
 */
export type PartialInput =
  | { kind: 'noteOn'; note: number; velocity: number }
  | { kind: 'noteOff'; note: number }
  | { kind: 'osc'; address: string; value: number };

const TICK_MS = 1000 / 60; // fixed-timestep target (~60fps)
const MAX_DT_MS = 100; // clamp to survive GC pauses / tab throttling
const PREVIEW_FPS = 30; // WS preview broadcast throttle

/**
 * Owns the {@link Engine} and an {@link OutputManager}, running a fixed-timestep
 * loop (U8). Recursive `setTimeout` + accumulator keeps the tick rate stable; the
 * transmit and preview streams are throttled independently of the engine rate (R13).
 * Hit→light latency is measured wall-clock from input ingress to the first frame
 * emitted afterwards (R14) and surfaced via {@link getStats}.
 */
export class EngineHost {
  readonly engine: Engine;
  private readonly output: OutputManager;

  /** Cumulative dt fed to `engine.tick` — the clock inputs are stamped against. */
  engineTimeMs = 0;

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

  constructor(project: Project, output: OutputManager = new OutputManager()) {
    this.engine = new Engine(project);
    this.output = output;
  }

  // --- input ---------------------------------------------------------------

  /**
   * Stamp a partial input with the current engine time and enqueue it. Records the
   * wall time of ingress so the next emitted frame can report hit→light latency.
   */
  applyInput(partial: PartialInput): void {
    this.pendingInputWall = performance.now();
    const event = { ...partial, timeMs: this.engineTimeMs } as InputEvent;
    this.engine.applyEvent(event);
  }

  /** Mark an input ingress without constructing the event here (used when the
   * reducer enqueues the event itself). Stamps wall time for latency. */
  markInput(): void {
    this.pendingInputWall = performance.now();
  }

  // --- output settings -----------------------------------------------------

  /** Re-apply the project's output settings to the OutputManager (call on start,
   * after any setOutput, and after a project load / setProject). */
  reloadOutputSettings(): void {
    this.output.applySettings(this.engine.getProject().output, this.engine.getDmxMap());
  }

  // --- lifecycle -----------------------------------------------------------

  start(): void {
    if (this.timer) return;
    this.reloadOutputSettings();
    this.lastWall = performance.now();
    this.fpsWindowStart = this.lastWall;
    this.accumulator = 0;
    this.scheduleNext();
  }

  stop(): void {
    if (this.timer) {
      clearTimeout(this.timer);
      this.timer = null;
    }
    this.output.blackout(this.engine.getDmxMap());
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
    const now = performance.now();
    let elapsed = now - this.lastWall;
    this.lastWall = now;
    if (elapsed > MAX_DT_MS) elapsed = MAX_DT_MS; // clamp to survive long pauses
    this.accumulator += elapsed;

    // Drain accumulated time in fixed steps (catch up at most a few frames).
    let steps = 0;
    while (this.accumulator >= TICK_MS && steps < 6) {
      this.step(TICK_MS);
      this.accumulator -= TICK_MS;
      steps++;
    }
    // Drop any backlog beyond the catch-up budget so we never spiral.
    if (this.accumulator >= TICK_MS) this.accumulator = 0;
  }

  /**
   * Advance the engine by `dt`, then service the throttled transmit and preview
   * streams. Public so tests can drive the loop deterministically without timers.
   */
  step(dt: number): void {
    this.engine.tick(dt);
    this.engineTimeMs += dt;

    // Loop-rate measurement (rolling 1s window).
    this.fpsTicks++;
    const sinceWindow = this.engineTimeMs - this.fpsWindowStart;
    if (sinceWindow >= 1000) {
      this.measuredFps = (this.fpsTicks * 1000) / sinceWindow;
      this.fpsTicks = 0;
      this.fpsWindowStart = this.engineTimeMs;
    }

    let emittedFrame = false;

    // --- transmit (throttled to project.output.fps) ---
    const txFps = this.engine.getProject().output.fps || 1;
    this.transmitAccum += dt;
    const txInterval = 1000 / txFps;
    if (this.transmitAccum >= txInterval) {
      this.transmitAccum -= txInterval;
      if (this.transmitAccum > txInterval) this.transmitAccum = 0; // clamp backlog
      this.output.sendFrame(this.engine.getFrame().rgba, this.engine.getDmxMap());
      emittedFrame = true;
    }

    // --- preview (throttled to ~30fps) ---
    this.previewAccum += dt;
    const pvInterval = 1000 / PREVIEW_FPS;
    if (this.previewAccum >= pvInterval) {
      this.previewAccum -= pvInterval;
      if (this.previewAccum > pvInterval) this.previewAccum = 0;
      if (this.onFrame) {
        const frame = this.engine.getFrame();
        this.onFrame(frameToRgbBytes(frame.rgba, frame.pixelCount));
      }
      emittedFrame = true;
    }

    // Hit→light latency: first frame emitted after an input closes the loop.
    if (emittedFrame && this.pendingInputWall !== null) {
      this.lastLatencyMs = performance.now() - this.pendingInputWall;
      this.pendingInputWall = null;
    }
  }

  // --- status --------------------------------------------------------------

  getStats(): HostStats {
    return {
      engine: this.engine.getStats(),
      latencyMs: this.lastLatencyMs,
      fps: this.measuredFps,
      output: this.output.status(),
    };
  }

  getOutputStatus(): OutputStatus {
    return this.output.status();
  }
}
