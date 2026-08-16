/**
 * When an effect's contribution stops being worth rendering, and what that implies for how
 * long its host voice must live.
 *
 * A leaf module on purpose: {@link ../voice/voice-life} imports it, and so do the effect impls
 * that declare an exponential life. Putting these next to the resolver instead would close a
 * cycle (impl → voice-life → registry → impl).
 */

/**
 * The normalized brightness below which an effect stops drawing. Every impl's render loop
 * compares against this same threshold (`if (intensity < 0.004) continue`) — the literals
 * there and this constant are one number; change both together.
 */
export const VISIBLE_CUTOFF = 0.004;

/**
 * How many time constants an exponential decay needs before it falls under
 * {@link VISIBLE_CUTOFF} — `e^-n < cutoff` ⇒ `n > ln(1/cutoff)` ≈ 5.52.
 *
 * An effect whose param is a decay CONSTANT rather than a hard cutoff is still visible long
 * after that many milliseconds: `decayMs: 220` renders for ~1.2s, not 220ms. Such effects
 * declare `voiceLife.factor = EXP_TAIL_FACTOR` so their voice is sized to what the eye
 * actually sees rather than to the time constant.
 */
export const EXP_TAIL_FACTOR = Math.log(1 / VISIBLE_CUTOFF);
