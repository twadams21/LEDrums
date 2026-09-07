/**
 * Audio feature frames (GH #214) — the pure data contract between a browser-side analyser and
 * the engine's `audio` modulation source. Four fixed bands, each a finite 0..1 energy: `level`
 * (broadband RMS), `bass` (20–250 Hz), `mids` (250–2000 Hz), `highs` (2000–12000 Hz). The
 * analysis that PRODUCES a frame lives outside core (it needs Web Audio); core only defines the
 * shape, its validation, and how a modulation source SAMPLES the latest frame with freshness.
 *
 * Pure + deterministic: the table is engine-owned state stamped with the engine clock at the
 * moment the frame was queued, and `sampleAudio` reads it against the frame clock the compositor
 * already threads to every source — no `Date.now`, no DOM.
 */
import { z } from 'zod';

/** The four feature keys, in display order. */
export const AUDIO_BANDS = ['level', 'bass', 'mids', 'highs'] as const;
export type AudioBand = (typeof AUDIO_BANDS)[number];

/** One analysed frame: every band a finite 0..1. */
export interface AudioFeatureFrame {
  level: number;
  bass: number;
  mids: number;
  highs: number;
}

/** Runtime validation for a frame — reused by the protocol schema so the wire shape is defined
    once. Non-finite (NaN/±Infinity) and out-of-range values are REJECTED, not clamped: a sender
    that produced them has a bug, and the engine must not guess. */
export const audioFeatureFrameSchema = z
  .object({
    level: z.number().finite().min(0).max(1),
    bass: z.number().finite().min(0).max(1),
    mids: z.number().finite().min(0).max(1),
    highs: z.number().finite().min(0).max(1),
  })
  .strict();

export const ZERO_AUDIO_FRAME: Readonly<AudioFeatureFrame> = Object.freeze({ level: 0, bass: 0, mids: 0, highs: 0 });

export function isAudioBand(value: unknown): value is AudioBand {
  return typeof value === 'string' && (AUDIO_BANDS as readonly string[]).includes(value);
}

/** Clamp one feature into finite 0..1 — the engine's defensive normalisation (a non-finite value
    reads as silence rather than poisoning a param). */
export function audioValue01(raw: number): number {
  if (!Number.isFinite(raw)) return 0;
  return raw < 0 ? 0 : raw > 1 ? 1 : raw;
}

/** A defensively normalised copy of `frame` (every band through {@link audioValue01}). */
export function normalizeAudioFrame(frame: Partial<AudioFeatureFrame> | undefined): AudioFeatureFrame {
  return {
    level: audioValue01(frame?.level ?? 0),
    bass: audioValue01(frame?.bass ?? 0),
    mids: audioValue01(frame?.mids ?? 0),
    highs: audioValue01(frame?.highs ?? 0),
  };
}

/**
 * How long the latest frame stays live. Past this age an `audio` source reads 0, so a stopped
 * capture, a crashed tab or a dropped link decays to silence instead of freezing the last
 * value onto every mapped param. Sized for a 30 Hz sender with room for a few dropped frames.
 */
export const AUDIO_STALE_MS = 500;

/** The engine's live audio state: the latest frame and the engine time it was queued at. */
export interface AudioTable {
  readonly frame: Readonly<AudioFeatureFrame>;
  readonly atMs: number;
}

/**
 * An `audio` source's current 0..1 value: `band` of the latest frame while it is fresh
 * (`timeMs - atMs <= AUDIO_STALE_MS`), else 0. Absent table (never heard) ⇒ 0. The ONE freshness
 * rule every sampling path shares — effect params, modifier links, nested Mix/Splice members and
 * the offline simulator all call this with the frame clock they already carry.
 */
export function sampleAudio(table: AudioTable | undefined | null, band: AudioBand, timeMs: number): number {
  if (!table) return 0;
  const age = timeMs - table.atMs;
  if (!(age <= AUDIO_STALE_MS)) return 0; // also guards NaN
  return audioValue01(table.frame[band]);
}
