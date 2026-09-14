'use strict';

const { BANDS } = require('./packets.cjs');
// Local analysis version, not a new wire field (the server's schema is strict).
const ANALYSIS_VERSION = 'stereo-crossover-rms-v1';
const RMS_WINDOW_MS = 20;
const PUBLISH_MS = 34; // <=30 Hz, rather than 33 ms's 30.30 Hz.
const ZERO_FRAME = Object.freeze({ level: 0, bass: 0, mids: 0, highs: 0 });
const DEFAULT_SETTINGS = Object.freeze({ gain: 1, floorDb: -60, attackMs: 15, releaseMs: 180 });
const SETTING_RANGES = Object.freeze({ gain: [0, 4], floorDb: [-90, -20], attackMs: [0, 1000], releaseMs: [0, 1000] });
function clampUnit(value) { return Number.isFinite(value) ? Math.max(0, Math.min(1, value)) : 0; }
function sanitizeSettings(input = {}) {
  const result = {};
  for (const key of Object.keys(DEFAULT_SETTINGS)) {
    const value = input[key];
    const [min, max] = SETTING_RANGES[key];
    result[key] = Number.isFinite(value) ? Math.max(min, Math.min(max, value)) : DEFAULT_SETTINGS[key];
  }
  return result;
}
function rmsToUnit(rms, gain, floorDb) {
  if (!Number.isFinite(rms) || rms <= 0 || !Number.isFinite(gain) || gain <= 0 || !Number.isFinite(floorDb) || floorDb >= 0) return 0;
  // A full-scale sine RMS = 1/sqrt(2) reads 0 dBFS. No browser FFT +10 dB correction.
  const db = 20 * Math.log10(rms * Math.SQRT2) + 20 * Math.log10(gain);
  return clampUnit((db - floorDb) / -floorDb);
}
function smooth(previous, target, dtMs, settings) {
  const prev = clampUnit(previous);
  const tau = target > prev ? settings.attackMs : settings.releaseMs;
  if (!(tau > 0)) return target;
  if (!Number.isFinite(dtMs) || dtMs <= 0) return prev;
  return clampUnit(prev + (target - prev) * (1 - Math.exp(-dtMs / tau)));
}

/** Eight scalar RMS readings: Level L/R, Bass L/R, Mids L/R, Highs L/R.
 * RMS powers combine, not waveforms: opposite-phase stereo cannot cancel the meter.
 * MSP owns crossover/window computation. This pure helper owns normalization/smoothing. */
function analyzeStereoRms(values, previous = ZERO_FRAME, dtMs = PUBLISH_MS, inputSettings = DEFAULT_SETTINGS) {
  if (!Array.isArray(values) || values.length !== 8) throw new Error('Expected eight stereo RMS readings');
  const settings = sanitizeSettings(inputSettings);
  const valid = (value) => Number.isFinite(value) && value > 0 ? value : 0;
  const result = {};
  BANDS.forEach((band, index) => {
    const rms = Math.hypot(valid(values[index * 2]), valid(values[index * 2 + 1])) / Math.SQRT2;
    result[band] = smooth(previous[band], rmsToUnit(rms, settings.gain, settings.floorDb), dtMs, settings);
  });
  return result;
}

module.exports = {
  ANALYSIS_VERSION, RMS_WINDOW_MS, PUBLISH_MS, ZERO_FRAME, DEFAULT_SETTINGS,
  SETTING_RANGES, sanitizeSettings, rmsToUnit, analyzeStereoRms,
};
