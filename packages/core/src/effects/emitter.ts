import type { RenderContext, Trigger } from '../engine/render-context';

/**
 * Per-hit emissions — the missing multiplicity primitive for trigger effects.
 *
 * A weak trigger effect renders ONE global thing (a band indexed off the transport
 * beat, a texture on wall-clock time), so repeated hits stack identical copies
 * instead of layering: hit a drum four times and you get one band four times as
 * bright, not four bands chasing each other. The correct shape is: every hit spawns
 * an *emission* — a small record that remembers its own birth (drum, velocity,
 * hit-relative age, optional effect-specific data) — and the effect renders every
 * live emission each frame. Four hits a beat apart = four wavefronts a beat apart.
 *
 * This module owns that lifecycle behind two calls (`createEmitterState` once,
 * `updateEmissions` once per frame): spawn-exactly-once via the trigger `seq`
 * contract, hit-relative aging via `ctx.dt` accumulation (clock-domain agnostic —
 * works under both the 'voice' and 'absolute' timebases and the thumbnail's looping
 * clock), TTL expiry with in-place compaction, and a hard cap. Deterministic: no
 * clock reads, no RNG (effects wanting per-emission randomness derive it in their
 * `spawnData` from their own seeded state).
 *
 * Hosting note: under the voice engine each hit is its own voice, so a generator
 * voice sees exactly one trigger and renders one emission — multiplicity then comes
 * from polyphony compositing voices. Under hosts with a live trigger stream (the
 * legacy engine, the web sim, thumbnails), one instance sees every hit and renders
 * them all. Emission-based effects are correct in BOTH hostings; that host-agnosticism
 * is the point of writing against this seam.
 */
export interface Emission<D = undefined> {
  /** The originating trigger's seq (stable identity for the emission's life). */
  seq: number;
  drumId: string;
  note: number;
  velocity: number;
  /** Hit-relative age, ms — seeded from the trigger's age at spawn, advanced by ctx.dt. */
  ageMs: number;
  /** Effect-specific payload built once at spawn (target point, start angle, …). */
  data: D;
}

export interface EmitterState<D = undefined> {
  emissions: Emission<D>[];
  lastSeq: number;
}

/** Hard cap on live emissions — a runaway trigger stream degrades, never explodes. */
export const MAX_EMISSIONS = 64;

export function createEmitterState<D = undefined>(): EmitterState<D> {
  return { emissions: [], lastSeq: 0 };
}

/**
 * Advance, expire, and spawn emissions for this frame; returns the live list
 * (the state's own array — do not retain across frames).
 *
 * - Existing emissions age by `ctx.dt`; any older than `ttlMs` compacts away in place.
 * - Each trigger with `seq > lastSeq` spawns one emission (age seeded from the
 *   trigger's `ageMs`, so late discovery of an in-flight hit stays time-correct).
 * - `spawnData` runs once per new hit — allocate per-emission payload there, never
 *   in the render loop.
 */
export function updateEmissions<D>(
  state: EmitterState<D>,
  ctx: RenderContext,
  ttlMs: number,
  spawnData: (trig: Trigger) => D,
): Emission<D>[] {
  let w = 0;
  for (const em of state.emissions) {
    em.ageMs += ctx.dt;
    if (em.ageMs > ttlMs) continue;
    state.emissions[w++] = em;
  }
  state.emissions.length = w;

  for (const trig of ctx.triggers) {
    if (trig.seq <= state.lastSeq) continue;
    state.lastSeq = trig.seq;
    if (state.emissions.length >= MAX_EMISSIONS) break;
    const age = trig.ageMs > 0 ? trig.ageMs : 0;
    if (age > ttlMs) continue; // already expired at discovery
    state.emissions.push({
      seq: trig.seq,
      drumId: trig.drumId,
      note: trig.note,
      velocity: trig.velocity,
      ageMs: age,
      data: spawnData(trig),
    });
  }
  return state.emissions;
}
