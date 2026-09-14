import test from 'node:test';
import assert from 'node:assert/strict';
import { BoundedValues, Observations, assertTiming } from './observations.mjs';
import { timingFixture, statsFixture } from './fixtures.test-support.mjs';

test('client quantiles use exact nearest rank with null empties and real zeroes', () => {
  const values = new BoundedValues(100);
  assert.equal(values.snapshot().p50, null);
  for (let i = 99; i >= 0; i--) values.add(i);
  assert.deepEqual([values.snapshot().p50, values.snapshot().p95, values.snapshot().p99], [49, 94, 98]);
  assert.equal(values.snapshot().min, 0);
  for (const bad of [-1, NaN, Infinity, -Infinity]) assert.equal(values.add(bad), false);
  assert.equal(values.snapshot().count, 100);
});

test('client storage wraps and snapshots do not mutate earlier reports', () => {
  const values = new BoundedValues(2);
  values.add(0); values.add(1);
  const first = values.snapshot();
  values.add(5); values.add(9); values.add(10);
  assert.equal(first.p99, 1);
  assert.deepEqual(values.snapshot(), {
    count: 2, totalObserved: 5, overwritten: 3, min: 9, max: 10, mean: 9.5,
    p50: 9, p95: 10, p99: 10, quantileMethod: 'nearest-rank',
  });
});

test('preview gaps exclude warmup, first-baseline and post-duration samples', () => {
  const o = new Observations({ warmupMs: 1000, durationMs: 1000 });
  for (const at of [0, 990, 1000, 1010, 1050, 2001]) o.preview(at, 6);
  assert.equal(o.snapshot().preview.frames, 3);
  assert.equal(o.snapshot().preview.bytes, 18);
  assert.equal(o.snapshot().preview.arrivalGapMs.count, 2);
  assert.equal(o.snapshot().preview.arrivalGapMs.p50, 10);
  assert.equal(o.snapshot().preview.arrivalGapMs.p99, 40);
});

test('actual server windows stay separate, reject old epochs/warmup/duplicates/overlap, and are bounded', () => {
  const o = new Observations({ warmupMs: 3000, durationMs: 5000, snapshotCapacity: 2 });
  o.stats(statsFixture(4500, 0), 4500, 100); // wrong epoch
  o.stats(statsFixture(4000, 100), 4000, 100); // starts 3000, before epoch+warmup
  const first = statsFixture(4100, 100);
  o.stats(first, 4000, 100);
  o.stats(first, 4100, 100); // cached duplicate
  o.stats(statsFixture(4500, 100), 4400, 100); // overlap
  const second = statsFixture(5100, 100);
  second.timing.renderDurationMs.p99 = 99;
  o.stats(second, 5000, 100);
  o.stats(statsFixture(6100, 100), 6000, 100);
  o.stats(statsFixture(9000, 100), 9000, 100); // past duration
  const result = o.snapshot();
  assert.equal(result.serverTiming.count, 2);
  assert.equal(result.serverTiming.overwritten, 1);
  assert.deepEqual(result.serverTiming.windows.map((w) => w.timing.renderDurationMs.p99), [99, 1]);
  assert.equal(result.serverTiming.p99, undefined); // no quantile-of-quantiles
});

test('timing validator fails closed on missing telemetry, non-finite stats and absent server identity', () => {
  assert.doesNotThrow(() => assertTiming(timingFixture()));
  for (const mutate of [
    (s) => { s.version = 2; }, (s) => { s.targetHz = NaN; },
    (s) => { s.renderDurationMs.p95 = Infinity; }, (s) => { delete s.host; },
    (s) => { s.tickIntervalMs.count = 0; },
  ]) {
    const s = timingFixture(); mutate(s); assert.throws(() => assertTiming(s));
  }
  assert.throws(() => assertTiming(undefined));
});
