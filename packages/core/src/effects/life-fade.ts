/**
 * Whether an effect's own decay term applies at all.
 *
 * Deliberately its own module with no registry import: every decaying effect in
 * `effects/impl` calls this, and `effects/voice-life` (its natural home by subject) imports
 * the registry — which imports those impls. One `import` there is a cycle that leaves the
 * registry half-built at module init, so the seam that all 13 effects share has to be a leaf.
 */
import type { RenderContext } from '../engine/render-context';

/**
 * An effect's OWN decay term, suppressed to 1 when the voice carries an authored envelope.
 *
 * The envelope replaces the Decay param rather than trimming it (Trent, 2026-08-17: "it
 * replaces 100% of their use cases"). Without this the two multiply: the drawn shape could
 * only ever make a voice dimmer or shorter than the effect's own fade, never hold it, never
 * step it — which is exactly why a `snap` curve at gain 1.0 still read as a linear fade.
 *
 * Applied ONLY to a term that is a function of the VOICE's age against its declared life —
 * the voice's decay, which the envelope now owns. Per-element shaping that happens to use the
 * same maths (a hoop cascade, a particle's own life, a frame-feedback smear) is left alone: it
 * is what the effect looks like, not how long the hit lasts. The four effects where that
 * distinction bites are listed in the F5 report.
 */
export function lifeFade(ctx: Pick<RenderContext, 'authoredDecay'>, natural: number): number {
  return ctx.authoredDecay === true ? 1 : natural;
}
