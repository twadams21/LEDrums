/** Server-side observations only. All monotonic timestamps are supplied by the host; this
 * module never reads a clock and never feeds timing back into the engine/scheduler. */
export interface FrameTimingOptions {
  targetHz: number;
  capacity?: number;
  windowMs?: number;
  warmupMs?: number;
}

/** Bounded column storage. Warmup excludes observations STARTED before readiness. Rolling
 * windows select by COMPLETION, retaining an entire long stall even when it exceeds windowMs. */
class Samples {
  private readonly values: Float64Array;
  private readonly from: Float64Array;
  private readonly until: Float64Array;
  private next = 0;
  private size = 0;
  private evictedUntil = -Infinity;

  constructor(private readonly capacity: number) {
    this.values = new Float64Array(capacity);
    this.from = new Float64Array(capacity);
    this.until = new Float64Array(capacity);
  }

  clear(): void {
    this.next = this.size = 0;
    this.evictedUntil = -Infinity;
  }

  add(value: number, from: number, until = from): void {
    if (this.size === this.capacity) this.evictedUntil = this.until[this.next]!;
    this.values[this.next] = value;
    this.from[this.next] = from;
    this.until[this.next] = until;
    this.next = (this.next + 1) % this.capacity;
    this.size = Math.min(this.size + 1, this.capacity);
  }

  snapshot(start: number, end: number, scratch: Float64Array, readyAt: number) {
    let count = 0;
    let sum = 0;
    for (let i = 0; i < this.size; i++) {
      // (start, end], except the initial ready boundary itself is included. Adjacent windows
      // therefore don't double-count a sample at their shared edge. Never clip a long sample.
      const until = this.until[i]!;
      if (this.from[i]! < readyAt || until < start || (until === start && start > readyAt) || until > end) continue;
      const v = this.values[i]!;
      scratch[count++] = v;
      sum += v;
    }
    // Sorting and subarray allocation happen ONLY on snapshot, never on record.
    const sorted = scratch.subarray(0, count).sort();
    const rank = (p: number): number | null => count ? sorted[Math.ceil(p * count) - 1]! : null;
    return {
      count,
      sum,
      min: count ? sorted[0]! : null,
      max: count ? sorted[count - 1]! : null,
      mean: count ? sum / count : null,
      p50: rank(0.50),
      p95: rank(0.95),
      p99: rank(0.99),
      // True means even this requested time window lost samples to the capacity bound.
      // Evicting an observation straddling the boundary conservatively flags truncation.
      truncated: this.evictedUntil >= start,
    };
  }
}

const finiteNonnegative = (n: number): boolean => Number.isFinite(n) && n >= 0;

/** One recorder per host. Seven rings and one sort scratch, all fixed at construction.
 * Quantiles use nearest rank: sorted[ceil(p * n) - 1], with NO interpolation. Empty summaries
 * have null extrema/mean/quantiles (zero is a real observation, not "missing"). */
export class FrameTiming {
  private readonly capacity: number;
  private readonly windowMs: number;
  private readonly warmupMs: number;
  private readonly targetHz: number;
  private readonly scratch: Float64Array;
  private readonly tickIntervals: Samples;
  private readonly renderDurations: Samples;
  private readonly loopIntervals: Samples;
  private readonly timerLateness: Samples;
  private readonly clampedElapsed: Samples;
  private readonly discardedBacklog: Samples;
  private readonly stepsPerLoop: Samples;
  private startedAtMs = 0;
  private previousTick: number | null = null;
  private previousLoop: number | null = null;
  private ticks = 0;
  private loops = 0;
  private rejectedTicks = 0;
  private rejectedLoops = 0;

  constructor({ targetHz, capacity = 2048, windowMs = 1000, warmupMs = 2000 }: FrameTimingOptions) {
    if (!Number.isFinite(targetHz) || targetHz <= 0) throw new RangeError('targetHz must be positive and finite');
    if (!Number.isInteger(capacity) || capacity < 1 || capacity > 65_536) throw new RangeError('capacity must be 1..65536');
    if (!Number.isFinite(windowMs) || windowMs <= 0) throw new RangeError('windowMs must be positive and finite');
    if (!finiteNonnegative(warmupMs)) throw new RangeError('warmupMs must be finite and nonnegative');
    this.targetHz = targetHz;
    this.capacity = capacity;
    this.windowMs = windowMs;
    this.warmupMs = warmupMs;
    this.scratch = new Float64Array(capacity);
    this.tickIntervals = new Samples(capacity);
    this.renderDurations = new Samples(capacity);
    this.loopIntervals = new Samples(capacity);
    this.timerLateness = new Samples(capacity);
    this.clampedElapsed = new Samples(capacity);
    this.discardedBacklog = new Samples(capacity);
    this.stepsPerLoop = new Samples(capacity);
  }

  /** New host run/show/project: warmup starts here; no interval bridges the replacement. */
  reset(atMs: number): void {
    if (!finiteNonnegative(atMs)) throw new RangeError('reset timestamp must be finite and nonnegative');
    this.startedAtMs = atMs;
    this.previousTick = this.previousLoop = null;
    this.ticks = this.loops = this.rejectedTicks = this.rejectedLoops = 0;
    this.tickIntervals.clear();
    this.renderDurations.clear();
    this.loopIntervals.clear();
    this.timerLateness.clear();
    this.clampedElapsed.clear();
    this.discardedBacklog.clear();
    this.stepsPerLoop.clear();
  }

  /** Actual engine.tick start → start gaps (including tightly spaced catch-up ticks), and
   * synchronous engine.tick duration. Excludes host transport, output packing/send and preview. */
  recordTick(startMs: number, endMs: number): void {
    if (!finiteNonnegative(startMs) || !Number.isFinite(endMs) || endMs < startMs ||
        startMs < this.startedAtMs || (this.previousTick !== null && startMs < this.previousTick)) {
      this.rejectedTicks++;
      return;
    }
    if (this.previousTick !== null) this.tickIntervals.add(startMs - this.previousTick, this.previousTick, startMs);
    this.renderDurations.add(endMs - startMs, startMs, endMs);
    this.previousTick = startMs;
    this.ticks++;
  }

  /** Called once per timer callback, even when it executes no tick. `elapsedMs` is the RAW
   * accumulator input before its clamp. Lateness is relative to when setTimeout was requested
   * plus its requested delay, NOT a hypothetical ideal 120Hz deadline. The two discarded-time
   * fields are exact host branches, measured in ms; neither is a count of dropped light frames. */
  recordLoop(startMs: number, elapsedMs: number, requestedDueMs: number,
    clampedElapsedMs: number, discardedBacklogMs: number, steps: number): void {
    if (!finiteNonnegative(startMs) || !finiteNonnegative(elapsedMs) ||
        !finiteNonnegative(requestedDueMs) || !finiteNonnegative(clampedElapsedMs) ||
        !finiteNonnegative(discardedBacklogMs) || !Number.isInteger(steps) || steps < 0 ||
        startMs < this.startedAtMs || (this.previousLoop !== null && startMs < this.previousLoop)) {
      this.rejectedLoops++;
      return;
    }
    this.loopIntervals.add(elapsedMs, startMs - elapsedMs, startMs);
    this.timerLateness.add(Math.max(0, startMs - requestedDueMs), startMs);
    this.clampedElapsed.add(clampedElapsedMs, startMs);
    this.discardedBacklog.add(discardedBacklogMs, startMs);
    this.stepsPerLoop.add(steps, startMs);
    this.previousLoop = startMs;
    this.loops++;
  }

  /** Rolling wall-time window. Independent snapshots may overlap: NEVER average their
   * quantiles into run-wide quantiles. Take at ~1Hz, not the 100Hz legacy stats cadence. */
  snapshot(atMs: number) {
    if (!finiteNonnegative(atMs) || atMs < this.startedAtMs) throw new RangeError('invalid snapshot timestamp');
    const readyAt = this.startedAtMs + this.warmupMs;
    const start = Math.max(readyAt, atMs - this.windowMs);
    const summarize = (samples: Samples) => samples.snapshot(start, atMs, this.scratch, readyAt);
    return {
      version: 1 as const,
      clock: 'performance.now' as const,
      quantileMethod: 'nearest-rank' as const,
      targetHz: this.targetHz,
      capacityPerMetric: this.capacity,
      windowMs: this.windowMs,
      warmupMs: this.warmupMs,
      recordingStartedAtMs: this.startedAtMs,
      windowStartMs: Math.min(atMs, start),
      windowEndMs: atMs,
      warmupRemainingMs: Math.max(0, readyAt - atMs),
      ticksObserved: this.ticks,
      loopsObserved: this.loops,
      rejectedTicks: this.rejectedTicks,
      rejectedLoops: this.rejectedLoops,
      tickIntervalMs: summarize(this.tickIntervals),
      renderDurationMs: summarize(this.renderDurations),
      loopIntervalMs: summarize(this.loopIntervals),
      timerLatenessMs: summarize(this.timerLateness),
      clampedElapsedMs: summarize(this.clampedElapsed),
      discardedBacklogMs: summarize(this.discardedBacklog),
      stepsPerLoop: summarize(this.stepsPerLoop),
    };
  }
}

export type FrameTimingSnapshot = ReturnType<FrameTiming['snapshot']>;
