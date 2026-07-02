/**
 * Pure handle↔shape geometry for the ADSR envelope editor. No DOM, no Svelte, no
 * IO — just the math that maps drag positions to {@link AdsrShape} patches, and a
 * shape to the handle anchors / segment bands the SVG view draws. The `.svelte`
 * component is a thin view over these; S24 unit-tests them here and S34's Envelope
 * node inspector reuses the same seam. Kept in web (not core) because it is
 * editor-presentation geometry, not engine domain — but it is import-clean, so a
 * test needs no jsdom.
 */
import type { AdsrShape } from './sim';

/** SVG viewBox dimensions + inner padding (so endpoint/stage handles never clip). */
export const GEO = { W: 480, H: 160, PAD: 10 } as const;
const innerW = GEO.W - GEO.PAD * 2;
const innerH = GEO.H - GEO.PAD * 2;

/** Keyboard nudge step (unit space) for arrow-key handle adjustment. */
export const NUDGE = 0.02;

const clampUnit = (x: number): number => (x < 0 ? 0 : x > 1 ? 1 : x);
const clamp = (x: number, lo: number, hi: number): number => (x < lo ? lo : x > hi ? hi : x);

/** The three easable/draggable segments. The flat sustain plateau has no ease. */
export type Stage = 'attack' | 'decay' | 'release';

/** unit phase 0..1 → SVG x. */
export const xOf = (t: number): number => GEO.PAD + t * innerW;
/** unit level 0..1 → SVG y (inverted: v=0 bottom, v=1 top). */
export const yOf = (v: number): number => GEO.PAD + (1 - v) * innerH;

/** A rectangle in client space — the subset of `DOMRect` the mapping reads (so a
    test can pass a plain literal without constructing a real DOMRect). */
export interface Box {
  left: number;
  top: number;
  width: number;
  height: number;
}

/**
 * Map a pointer position (client px) to envelope `(t, v)` using the SVG's box.
 * The SVG scales its viewBox to its rendered box (`preserveAspectRatio="none"`),
 * so client px → viewBox px → unit, both axes clamped to 0..1.
 */
export function toUnit(clientX: number, clientY: number, rect: Box): { t: number; v: number } {
  const px = ((clientX - rect.left) / rect.width) * GEO.W;
  const py = ((clientY - rect.top) / rect.height) * GEO.H;
  const t = clampUnit((px - GEO.PAD) / innerW);
  const v = clampUnit(1 - (py - GEO.PAD) / innerH);
  return { t, v };
}

/** A handle's anchor position in unit `(t, v)` space. */
export interface Anchor {
  t: number;
  v: number;
}

/**
 * The three stage-handle anchors for a shape, in unit space. `attack` now carries
 * the attack peak on its `v` (the draggable `attackLevel`, v2); `sustain`/`release`
 * share the sustain level. Mirrors the sampling boundaries `adsrToPoints` uses.
 */
export function handleAnchors(a: AdsrShape): { attack: Anchor; sustain: Anchor; release: Anchor } {
  const peak = clampUnit(a.attackLevel ?? 1);
  const sus = clampUnit(a.sustain);
  return {
    attack: { t: clampUnit(a.attack), v: peak },
    sustain: { t: clampUnit(a.attack + a.decay), v: sus },
    release: { t: clampUnit(1 - a.release), v: sus },
  };
}

/** Per-stage `[t0, t1]` bands in unit space — the clickable/keyboard-selectable
    regions for ease editing. The flat sustain plateau (`[decayEnd, releaseStart]`)
    is intentionally excluded (it has no ease). Boundaries are monotonic. */
export function segmentBands(a: AdsrShape): Record<Stage, [number, number]> {
  const aEnd = clampUnit(a.attack);
  const dEnd = Math.max(aEnd, clampUnit(a.attack + a.decay));
  const rStart = Math.max(dEnd, clampUnit(1 - a.release));
  return {
    attack: [0, aEnd],
    decay: [aEnd, dEnd],
    release: [rStart, 1],
  };
}

/** Which segment a phase `t` falls in, or `null` on the flat sustain plateau —
    the click-to-select-segment mapping. */
export function segmentAt(a: AdsrShape, t: number): Stage | null {
  const aEnd = clampUnit(a.attack);
  const dEnd = Math.max(aEnd, clampUnit(a.attack + a.decay));
  const rStart = Math.max(dEnd, clampUnit(1 - a.release));
  if (t <= aEnd) return 'attack';
  if (t <= dEnd) return 'decay';
  if (t >= rStart) return 'release';
  return null;
}

/**
 * Attack handle drag → shape patch. `t` sets the attack time (X), `v` sets the
 * attack peak `attackLevel` (Y, v2 — previously the handle was stuck at the top).
 * The sustain point's X is held fixed by recomputing `decay`; attack is clamped so
 * `attack ≤ attack+decay ≤ 1−release` (and ≤ 0.9) stays invariant.
 */
export function dragAttack(a: AdsrShape, t: number, v: number): Partial<AdsrShape> {
  const sustainT = clampUnit(a.attack + a.decay);
  const releaseT = clampUnit(1 - a.release);
  const attack = clamp(t, 0, Math.min(0.9, sustainT, releaseT));
  const decay = Math.max(0, sustainT - attack);
  return { attack, decay, attackLevel: clampUnit(v) };
}

/** Sustain handle drag → patch. `t` sets `decay` (relative to attack), `v` sets the
    sustain level. */
export function dragSustain(a: AdsrShape, t: number, v: number): Partial<AdsrShape> {
  const attackT = clampUnit(a.attack);
  const releaseT = clampUnit(1 - a.release);
  const x = clamp(t, attackT, releaseT);
  return { decay: Math.max(0, x - attackT), sustain: clampUnit(v) };
}

/** Release handle drag → patch. Release is X-only (its Y tracks sustain). */
export function dragRelease(a: AdsrShape, t: number): Partial<AdsrShape> {
  const sustainT = clampUnit(a.attack + a.decay);
  const x = clamp(t, sustainT, 1);
  return { release: clamp(1 - x, 0, 0.9) };
}
