import { EventEmitter } from 'node:events';
import { TIMING_METRICS } from './observations.mjs';

export function stateFixture() {
  return {
    t: 'state', sessionId: 'test-session', showRevision: 0,
    output: { state: 'disabled' }, model: { count: 12 },
    project: {
      output: { state: 'disabled' }, kit: { drums: [{ id: 'kick' }, { id: 'snare' }] },
      inputMap: { midiChannel: null, midiNotes: [
        { note: 36, drumId: 'kick', slot: 0 }, { note: 38, drumId: 'snare', slot: 0 },
      ], globalControls: {} },
      composition: { transport: { source: 'manual', bpm: 120, playing: true, beatsPerBar: 4 } },
    },
    effects: [{ id: 'spatial-field', paramSpec: Object.entries({
      brightness: 1, hue: 205, saturation: 0.85, hueSpread: 70, scale: 1.4, twist: 2.2,
      speed: 0.22, disturbance: 0.85, waveSpeed: 1100, waveWidth: 240, lifeMs: 1500,
    }).map(([key, value]) => ({ key, type: 'number', label: key, default: value, min: 0, max: 6000 })) }],
    showLibrary: null, songLibrary: null, tunnel: { status: 'off' }, osc: { port: 9399 },
  };
}

export function timingFixture(end = 100, epoch = 0) {
  const summary = { count: 1, sum: 1, min: 1, max: 1, mean: 1, p50: 1, p95: 1, p99: 1, truncated: false };
  return {
    version: 1, clock: 'performance.now', quantileMethod: 'nearest-rank', targetHz: 120,
    capacityPerMetric: 2048, windowMs: 1000, warmupMs: 2000,
    recordingStartedAtMs: epoch, windowStartMs: Math.min(end, Math.max(epoch + 2000, end - 1000)),
    windowEndMs: end, warmupRemainingMs: Math.max(0, epoch + 2000 - end),
    ticksObserved: 1, loopsObserved: 1, rejectedTicks: 0, rejectedLoops: 0,
    ...Object.fromEntries(TIMING_METRICS.map((key) => [key, { ...summary }])),
    host: { os: 'test', osRelease: 'test', arch: 'x64', node: 'test', cpu: 'synthetic test CPU', logicalCpuCount: 1 },
  };
}

export function statsFixture(end = 100, epoch = 0) {
  return {
    t: 'stats', output: { state: 'disabled' }, stats: { pixelCount: 12 }, fps: 120,
    voice: { voiceCount: 8, voices: Array.from({ length: 8 }, (_, i) => ({ effectId: `perf-dev-${i}` })) },
    timing: timingFixture(end, epoch),
  };
}

export const optionsFixture = () => ({
  url: 'ws://127.0.0.1:4399/ws', allowMutations: true, voices: 8,
  warmupMs: 3000, durationMs: 2000, timeoutMs: 10_000,
});

export class FakeClock {
  at = 100;
  serial = 0;
  tasks = new Map();
  now = () => this.at;
  add(fn, ms, repeat) {
    const id = ++this.serial;
    this.tasks.set(id, { fn, at: this.at + ms, repeat });
    return id;
  }
  timers = {
    setTimeout: (fn, ms) => this.add(fn, ms, 0),
    setInterval: (fn, ms) => this.add(fn, ms, ms),
    clearTimeout: (id) => this.tasks.delete(id),
    clearInterval: (id) => this.tasks.delete(id),
  };
  async advance(ms) {
    const end = this.at + ms;
    for (;;) {
      const next = [...this.tasks].filter(([, task]) => task.at <= end).sort((a, b) => a[1].at - b[1].at)[0];
      if (!next) break;
      const [id, task] = next;
      this.at = task.at;
      if (task.repeat) task.at += task.repeat;
      else this.tasks.delete(id);
      task.fn();
      await Promise.resolve();
      await Promise.resolve();
    }
    this.at = end;
    await Promise.resolve();
    await Promise.resolve();
  }
}

export function fakeSocketClass(onSend = () => {}) {
  return class FakeSocket extends EventEmitter {
    static OPEN = 1;
    static CLOSED = 3;
    static instance;
    readyState = 1;
    bufferedAmount = 0;
    sent = [];
    closed = false;
    constructor(url) { super(); this.url = url; this.constructor.instance = this; }
    message(message) { this.emit('message', Buffer.from(JSON.stringify(message)), false); }
    preview() { this.emit('message', Buffer.alloc(36), true); }
    send(raw, callback) {
      const message = JSON.parse(raw);
      this.sent.push(message);
      onSend(this, message);
      callback?.();
    }
    close() { this.readyState = 3; this.closed = true; this.emit('close'); }
    terminate() { this.close(); }
  };
}
