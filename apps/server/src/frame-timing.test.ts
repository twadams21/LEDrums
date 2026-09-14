import { afterEach, describe, expect, it, vi } from 'vitest';
import { defaultProject, voice } from '@ledrums/core';
import { FrameTiming } from './frame-timing';
import { VoiceEngineHost } from './voice-engine-host';
import { OutputManager } from './output-manager';

const recorder = (options: Partial<ConstructorParameters<typeof FrameTiming>[0]> = {}) =>
  new FrameTiming({ targetHz: 120, warmupMs: 0, windowMs: 10_000, ...options });

const empty = {
  count: 0, sum: 0, min: null, max: null, mean: null,
  p50: null, p95: null, p99: null, truncated: false,
};

describe('FrameTiming', () => {
  it('has no invented samples before the first tick, including at wall zero', () => {
    const r = recorder();
    const s = r.snapshot(0);
    expect(s.renderDurationMs).toEqual(empty);
    expect(s.tickIntervalMs).toEqual(empty);
    expect(s.loopIntervalMs).toEqual(empty);
    expect(s.ticksObserved).toBe(0);
  });

  it('accepts zero timestamps, durations, gaps, elapsed time and early timers', () => {
    const r = recorder();
    r.recordTick(0, 0);
    r.recordTick(0, 0);
    r.recordLoop(0, 0, 8, 0, 0, 0);
    const s = r.snapshot(0);
    expect(s.renderDurationMs).toMatchObject({ count: 2, p50: 0, mean: 0 });
    expect(s.tickIntervalMs).toMatchObject({ count: 1, p99: 0 });
    expect(s.timerLatenessMs).toMatchObject({ count: 1, p99: 0 });
    expect(s.stepsPerLoop).toMatchObject({ count: 1, p50: 0 });
  });

  it('uses exact nearest-rank p50/p95/p99, not interpolation', () => {
    const r = recorder();
    for (let i = 1; i <= 100; i++) r.recordTick(i * 100, i * 100 + 101 - i);
    const s = r.snapshot(10_001);
    expect(s.renderDurationMs).toEqual({
      count: 100, sum: 5050, min: 1, max: 100, mean: 50.5,
      p50: 50, p95: 95, p99: 99, truncated: false,
    });
    expect(s.tickIntervalMs).toMatchObject({ count: 99, p50: 100 });
    const tiny = recorder();
    tiny.recordTick(0, 1);
    tiny.recordTick(10, 19);
    expect(tiny.snapshot(20).renderDurationMs).toMatchObject({ p50: 1, p95: 9, p99: 9 });
  });

  it('excludes warmup and crossing intervals; the exact ready boundary is included', () => {
    const r = recorder({ warmupMs: 10 });
    r.recordTick(0, 0);
    expect(r.snapshot(0).renderDurationMs).toEqual(empty);
    r.recordTick(9, 11);
    expect(r.snapshot(9).renderDurationMs).toEqual(empty);
    r.recordTick(10, 10);
    r.recordTick(12, 14);
    const s = r.snapshot(14);
    expect(s.warmupRemainingMs).toBe(0);
    expect(s.windowStartMs).toBe(10);
    expect(s.renderDurationMs).toMatchObject({ count: 2, p50: 0, p99: 2 });
    expect(s.tickIntervalMs).toMatchObject({ count: 1, p50: 2 });
  });

  it('ages completed observations by wall time and excludes incomplete durations', () => {
    const r = recorder({ windowMs: 10 });
    r.recordTick(5, 6);
    r.recordTick(10, 11);
    r.recordTick(14, 16);
    expect(r.snapshot(15).renderDurationMs).toMatchObject({ count: 2 });
    expect(r.snapshot(20).tickIntervalMs).toMatchObject({ count: 1, p50: 4 });
    expect(r.snapshot(30).renderDurationMs).toEqual(empty);
  });

  it('retains full post-warmup stalls longer than the rolling window, without shared-edge duplicates', () => {
    const r = recorder({ windowMs: 100 });
    r.recordTick(10, 11);
    r.recordTick(500, 750);
    const stalled = r.snapshot(750);
    expect(stalled.tickIntervalMs.count).toBe(0); // gap completed at 500, already outside the window
    expect(stalled.renderDurationMs).toMatchObject({ count: 1, p99: 250 });
    expect(r.snapshot(500).tickIntervalMs).toMatchObject({ count: 1, p99: 490 });
    expect(r.snapshot(850).renderDurationMs.count).toBe(0); // completion at shared edge excluded
  });

  it('wraps bounded rings, flags capacity truncation, and does not corrupt old snapshots', () => {
    const r = recorder({ capacity: 3 });
    for (let i = 0; i < 3; i++) r.recordTick(i * 10, i * 10 + i);
    const before = r.snapshot(30);
    for (let i = 3; i < 20; i++) r.recordTick(i * 10, i * 10 + i);
    const after = r.snapshot(210);
    expect(before.renderDurationMs).toMatchObject({ count: 3, p50: 1, truncated: false });
    expect(after.renderDurationMs).toMatchObject({ count: 3, min: 17, max: 19, p50: 18, truncated: true });
    expect(after.ticksObserved).toBe(20);
    expect(r.snapshot(20_000).renderDurationMs).toEqual(empty);
  });

  it('records loop cadence, requested timer lateness and exact discarded milliseconds separately', () => {
    const r = recorder();
    r.recordLoop(8, 8, 8.33, 0, 0, 0);
    r.recordLoop(258, 250, 18, 150, 4.5, 12);
    const s = r.snapshot(258);
    expect(s.loopIntervalMs).toMatchObject({ count: 2, p50: 8, p99: 250 });
    expect(s.timerLatenessMs).toMatchObject({ p50: 0, p99: 240 });
    expect(s.clampedElapsedMs.sum).toBe(150);
    expect(s.discardedBacklogMs.sum).toBe(4.5);
    expect(s.stepsPerLoop).toMatchObject({ min: 0, max: 12 });
  });

  it('rejects non-finite/negative/reversed timestamps without poisoning the previous tick', () => {
    const r = recorder();
    r.recordTick(0, 1);
    for (const bad of [NaN, Infinity, -Infinity, -1]) {
      r.recordTick(bad, 10);
      r.recordTick(10, bad);
      r.recordLoop(10, bad, 1, 0, 0, 1);
    }
    r.recordTick(10, 9);
    r.recordTick(5, 6);
    r.recordTick(4, 6);
    r.recordLoop(10, 10, 8, 0, 0, 1.5);
    const s = r.snapshot(20);
    expect(s.rejectedTicks).toBe(10);
    expect(s.rejectedLoops).toBe(5);
    expect(s.renderDurationMs).toMatchObject({ count: 2, p99: 1 });
    expect(s.tickIntervalMs).toMatchObject({ count: 1, p50: 5 });
    expect(() => r.snapshot(NaN)).toThrow(RangeError);
  });

  it('resets counts, baselines, capacity flags and warmup without bridging runs', () => {
    const r = recorder({ capacity: 1, warmupMs: 10 });
    r.recordTick(10, 11);
    r.recordTick(20, 21);
    r.reset(100);
    expect(r.snapshot(105)).toMatchObject({ ticksObserved: 0, warmupRemainingMs: 5, renderDurationMs: empty });
    r.recordTick(110, 111);
    expect(r.snapshot(111).tickIntervalMs).toEqual(empty);
    expect(r.snapshot(111).renderDurationMs.truncated).toBe(false);
  });

  it.each([
    { targetHz: 0 }, { targetHz: NaN }, { capacity: 0 }, { capacity: 65_537 },
    { capacity: 1.5 }, { windowMs: 0 }, { windowMs: Infinity }, { warmupMs: -1 }, { warmupMs: NaN },
  ])('refuses invalid bounds %j', (options) => {
    expect(() => recorder(options)).toThrow(RangeError);
  });
});

afterEach(() => { vi.useRealTimers(); vi.restoreAllMocks(); });

function testHost() {
  let wall = 0;
  vi.spyOn(performance, 'now').mockImplementation(() => wall);
  const project = defaultProject();
  project.output.state = 'disabled';
  const engine = voice.createNullEngine();
  const tick = vi.spyOn(engine, 'tick').mockImplementation(() => { wall += 0.25; });
  const output = new OutputManager(() => { throw new Error('Must never open a physical output'); });
  const host = new VoiceEngineHost(project, engine, output);
  return { host, tick, project, wall: (n: number) => { wall = n; } };
}

describe('VoiceEngineHost frame timing boundary', () => {
  it('measures actual starts/durations without changing dt or existing stats shape', async () => {
    const { host, tick, wall } = testHost();
    wall(2000);
    host.step(7);
    wall(2020);
    host.step(9);
    expect(tick.mock.calls.map((args) => args.slice(0, 2))).toEqual([[7, 7], [16, 9]]);
    const s = host.getFrameTiming();
    expect(s.tickIntervalMs).toMatchObject({ count: 1, p50: 20 });
    expect(s.renderDurationMs).toMatchObject({ count: 2, p99: 0.25 });
    expect(s.loopsObserved).toBe(0); // direct step is NOT a timer callback
    expect(s.host.node).toBe(process.version);
    expect(host.getStats()).not.toHaveProperty('timing');
    expect(host.getOutputStatus().state).toBe('disabled');
    await host.stop();
  });

  it('observes a stalled real timer callback while preserving the 100ms/12-step clamp', async () => {
    vi.useFakeTimers();
    const { host, tick, wall } = testHost();
    host.start();
    wall(2500);
    vi.advanceTimersToNextTimer();
    expect(tick).toHaveBeenCalledTimes(12);
    expect(tick.mock.calls.every((args) => args[1] === 1000 / 120)).toBe(true);
    expect(host.engineTimeMs).toBeCloseTo(100);
    const s = host.getFrameTiming();
    expect(s.stepsPerLoop).toMatchObject({ count: 1, max: 12 });
    expect(s.clampedElapsedMs.sum).toBe(2400);
    expect(s.discardedBacklogMs.sum).toBe(0);
    expect(s.renderDurationMs).toMatchObject({ count: 12, p50: 0.25 });
    expect(s.timerLatenessMs.p99).toBeCloseTo(2500 - 1000 / 120);
    await host.stop();
    expect(vi.getTimerCount()).toBe(0);
  });

  it('isolates hosts and starts new observation epochs on show/project replacement', async () => {
    const { host, project, wall } = testHost();
    wall(2000);
    host.step(8);
    const other = new VoiceEngineHost(project, voice.createNullEngine());
    expect(other.getFrameTiming().ticksObserved).toBe(0);
    wall(2100);
    host.setShow(voice.emptyShow());
    expect(host.getFrameTiming()).toMatchObject({ ticksObserved: 0, warmupRemainingMs: 2000, recordingStartedAtMs: 2100 });
    wall(2200);
    host.prepareProject(project).commit();
    expect(host.getFrameTiming()).toMatchObject({ recordingStartedAtMs: 2200, ticksObserved: 0 });
    await host.stop();
    await other.stop();
  });
});
