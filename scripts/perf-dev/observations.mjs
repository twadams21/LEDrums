/** Client-side samples are bounded too. No raw preview frames are retained. */
export class BoundedValues {
  constructor(capacity = 32768) {
    if (!Number.isInteger(capacity) || capacity < 1 || capacity > 65536) throw new Error('Invalid sample capacity');
    this.values = new Float64Array(capacity);
    this.total = 0;
  }
  add(value) {
    if (!Number.isFinite(value) || value < 0) return false;
    this.values[this.total % this.values.length] = value;
    this.total++;
    return true;
  }
  snapshot() {
    const count = Math.min(this.total, this.values.length);
    const sorted = this.values.slice(0, count).sort();
    const rank = (p) => count ? sorted[Math.ceil(count * p) - 1] : null;
    return {
      count, totalObserved: this.total, overwritten: this.total - count,
      min: count ? sorted[0] : null, max: count ? sorted[count - 1] : null,
      mean: count ? sorted.reduce((sum, n) => sum + n, 0) / count : null,
      p50: rank(0.5), p95: rank(0.95), p99: rank(0.99), quantileMethod: 'nearest-rank',
    };
  }
}

export const TIMING_METRICS = [
  'tickIntervalMs', 'renderDurationMs', 'loopIntervalMs', 'timerLatenessMs',
  'clampedElapsedMs', 'discardedBacklogMs', 'stepsPerLoop',
];

/** Fail closed on absent/unsupported telemetry rather than relabelling legacy fps/latency. */
export function assertTiming(timing) {
  if (timing?.version !== 1 || timing.clock !== 'performance.now' || timing.quantileMethod !== 'nearest-rank') {
    throw new Error('Need stats.timing v1 from VoiceEngineHost.getFrameTiming()');
  }
  for (const key of ['targetHz', 'capacityPerMetric', 'windowMs', 'warmupMs', 'recordingStartedAtMs',
    'windowStartMs', 'windowEndMs', 'warmupRemainingMs', 'ticksObserved', 'loopsObserved', 'rejectedTicks', 'rejectedLoops']) {
    if (!Number.isFinite(timing[key]) || timing[key] < 0) throw new Error(`Invalid timing.${key}`);
  }
  if (timing.targetHz <= 0 || timing.windowMs <= 0 || timing.windowStartMs > timing.windowEndMs) {
    throw new Error('Invalid timing window');
  }
  for (const key of TIMING_METRICS) {
    const value = timing[key];
    if (!value || !Number.isInteger(value.count) || value.count < 0 || typeof value.truncated !== 'boolean' ||
        !Number.isFinite(value.sum) || value.sum < 0) throw new Error(`Invalid timing.${key}`);
    for (const q of ['min', 'max', 'mean', 'p50', 'p95', 'p99']) {
      if (value.count === 0 ? value[q] !== null : !Number.isFinite(value[q]) || value[q] < 0) {
        throw new Error(`Invalid timing.${key}.${q}`);
      }
    }
  }
  if (!timing.host || ['os', 'osRelease', 'arch', 'node', 'cpu'].some((key) => typeof timing.host[key] !== 'string') ||
      !Number.isInteger(timing.host.logicalCpuCount) || timing.host.logicalCpuCount < 0) {
    throw new Error('Need actual server runtime metadata in timing.host');
  }
}

export class Observations {
  constructor({ warmupMs, durationMs, capacity = 32768, snapshotCapacity = 256 }) {
    if (!Number.isInteger(snapshotCapacity) || snapshotCapacity < 1 || snapshotCapacity > 1024) throw new Error('Invalid snapshot capacity');
    this.warmupMs = warmupMs;
    this.durationMs = durationMs;
    this.previewGaps = new BoundedValues(capacity);
    this.voiceCounts = new BoundedValues(capacity);
    this.reportedFps = new BoundedValues(capacity);
    this.previousPreview = null;
    this.previewFrames = 0;
    this.previewBytes = 0;
    this.snapshots = new Array(snapshotCapacity);
    this.snapshotCount = 0;
    this.lastWindowEnd = null;
  }
  measuring(elapsedMs) {
    return elapsedMs >= this.warmupMs && elapsedMs <= this.warmupMs + this.durationMs;
  }
  preview(elapsedMs, bytes) {
    if (!this.measuring(elapsedMs)) return;
    // The first measured preview starts the baseline; no warmup-crossing gap is invented.
    if (this.previousPreview !== null) this.previewGaps.add(elapsedMs - this.previousPreview);
    this.previousPreview = elapsedMs;
    this.previewFrames++;
    this.previewBytes += bytes;
  }
  stats(message, elapsedMs, epoch) {
    if (this.measuring(elapsedMs)) {
      this.voiceCounts.add(message.voice.voiceCount);
      this.reportedFps.add(message.fps);
    }
    const timing = message.timing;
    // Windows use the SERVER monotonic epoch after setShow. Preview uses the CLIENT clock.
    // They intentionally remain separate; no offset/RTT estimate is called light latency.
    if (!timing || timing.recordingStartedAtMs !== epoch || timing.warmupRemainingMs !== 0 ||
        timing.windowStartMs < epoch + this.warmupMs ||
        timing.windowEndMs > epoch + this.warmupMs + this.durationMs ||
        !timing.renderDurationMs.count ||
        (this.lastWindowEnd !== null && timing.windowStartMs < this.lastWindowEnd)) return;
    // Also rejects identical cached snapshots (their start is before the last end).
    this.snapshots[this.snapshotCount % this.snapshots.length] = {
      receivedAtClientElapsedMs: elapsedMs, voiceCount: message.voice.voiceCount,
      pixelCount: message.stats.pixelCount, fps: message.fps, timing,
    };
    this.snapshotCount++;
    this.lastWindowEnd = timing.windowEndMs;
  }
  snapshot() {
    const count = Math.min(this.snapshotCount, this.snapshots.length);
    const start = Math.max(0, this.snapshotCount - count);
    return {
      serverTiming: {
        interpretation: 'Actual returned, non-overlapping server windows; no run-wide quantile can be derived from their quantiles.',
        count, overwritten: this.snapshotCount - count,
        windows: Array.from({ length: count }, (_, i) => this.snapshots[(start + i) % this.snapshots.length]),
      },
      preview: {
        interpretation: 'Client WebSocket binary arrival gaps, not browser paint cadence or physical input-to-light latency.',
        frames: this.previewFrames, bytes: this.previewBytes, arrivalGapMs: this.previewGaps.snapshot(),
      },
      observedVoiceCount: this.voiceCounts.snapshot(),
      reportedServerFps: this.reportedFps.snapshot(),
    };
  }
}
