'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const {
  ZERO_FRAME, DEFAULT_SETTINGS, ANALYSIS_VERSION, PUBLISH_MS, RMS_WINDOW_MS,
  sanitizeSettings, rmsToUnit, analyzeStereoRms,
} = require('./audio.cjs');
const instant = { ...DEFAULT_SETTINGS, attackMs: 0, releaseMs: 0 };
const close = (actual, expected) => assert.ok(Math.abs(actual - expected) < 1e-10, `${actual} != ${expected}`);
function sineRms(amplitude, phase = 0) {
  let power = 0;
  for (let i = 0; i < 4800; i++) {
    const sample = amplitude * Math.sin(i / 48 * Math.PI * 2 + phase);
    power += sample * sample;
  }
  return Math.sqrt(power / 4800);
}

test('synthetic full-scale, half-floor and sub-floor tones normalize without FFT correction', () => {
  close(rmsToUnit(sineRms(1), 1, -60), 1);
  close(rmsToUnit(sineRms(10 ** (-30 / 20)), 1, -60), 0.5);
  close(rmsToUnit(sineRms(10 ** (-80 / 20)), 1, -60), 0);
  close(rmsToUnit(sineRms(0.25), 4, -60), 1);
  assert.equal(rmsToUnit(1, 0, -60), 0);
  for (const value of [0, -1, NaN, Infinity]) assert.equal(rmsToUnit(value, 1, -60), 0);
});

test('stereo powers combine after RMS: anti-phase cannot cancel; one-channel signal loses 3dB', () => {
  const l = sineRms(1);
  const r = sineRms(1, Math.PI);
  assert.deepEqual(analyzeStereoRms([l, r, 0, 0, 0, 0, 0, 0], ZERO_FRAME, 34, instant), { ...ZERO_FRAME, level: 1 });
  const frame = analyzeStereoRms([l, 0, l, 0, l, 0, l, 0], ZERO_FRAME, 34, instant);
  for (const value of Object.values(frame)) close(value, (60 - 10 * Math.log10(2)) / 60);
});

test('band pairs stay independent, invalid RMS is silence, output always finite normalized', () => {
  const frame = analyzeStereoRms([0, 0, 1, 1, NaN, Infinity, -1, -10], ZERO_FRAME, 34, instant);
  assert.deepEqual(frame, { level: 0, bass: 1, mids: 0, highs: 0 });
  assert.throws(() => analyzeStereoRms([0, 0]));
  for (let i = 0; i < 100; i++) {
    const measured = analyzeStereoRms(Array(8).fill(i / 10), frame, i * 10);
    for (const value of Object.values(measured)) assert.ok(Number.isFinite(value) && value >= 0 && value <= 1);
  }
});

test('attack/release are real-time constants, invariant under subdivision', () => {
  const loud = Array(8).fill(1);
  const initial = analyzeStereoRms(loud, ZERO_FRAME, 15);
  close(initial.level, 1 - Math.exp(-1));
  const first = analyzeStereoRms(loud, ZERO_FRAME, 7.5);
  const second = analyzeStereoRms(loud, first, 7.5);
  close(initial.level, second.level);
  const released = analyzeStereoRms(Array(8).fill(0), { level: 1, bass: 1, mids: 1, highs: 1 }, 180);
  close(released.level, Math.exp(-1));
  assert.deepEqual(analyzeStereoRms(loud, ZERO_FRAME, 0), ZERO_FRAME);
});

test('settings/rate/version defaults are explicit and bounded', () => {
  assert.deepEqual(sanitizeSettings(), DEFAULT_SETTINGS);
  assert.deepEqual(sanitizeSettings({ gain: 20, floorDb: -1, attackMs: NaN, releaseMs: -20 }), {
    gain: 4, floorDb: -20, attackMs: 15, releaseMs: 0,
  });
  assert.ok(1000 / PUBLISH_MS <= 30);
  assert.equal(RMS_WINDOW_MS, 20);
  assert.equal(ANALYSIS_VERSION, 'stereo-crossover-rms-v1');
});
