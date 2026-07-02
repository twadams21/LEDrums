/**
 * Echo — delayed decaying ghosts. A feedback delay line over the voice's pixel range:
 * the frame written `delayMs` ago is scaled by `feedback` and added back onto the fresh
 * frame, and the SUM is what re-enters the delay line — so the ghost repeats every
 * `delayMs` and fades by `feedback` each repeat (a train of decaying copies, not one).
 *
 * Per frame, per channel, over the range:
 *   echoed = feedback · buf[t − delayMs]         (0 while the line is still cold)
 *   out    = min(1, current + echoed)
 *   buf[t] = out;  fb = out
 *
 * State is a per-voice ring buffer of {@link ECHO_SLOTS} frames (one slot per tick), sized
 * to the voice's RANGE (not the whole model — Echo keeps N frames, so range-sizing keeps it
 * bounded). The delay in slots is `round(delayMs / dt)`, clamped to the ring depth, so a
 * longer delay than the ring holds saturates at the ring's span rather than aliasing. Pure +
 * deterministic: the only state is the ring, per-voice, reset with the voice (a retrigger
 * starts from silence — group-G per-voice-state rule); `apply` reads `ctx.dt` for the delay
 * and never re-derives time.
 *
 * Tracer note (S28 shape): `{ id, name, category, paramSpec, createState?, apply }`; temporal
 * state lives in `createState`, `apply` integrates against `ctx.dt` and never touches wall-clock.
 */
import { clamp, clamp01 } from '../../math';
import type { PixelModel } from '../../geometry/pixel-model';
import { pnum } from '../../effects/types';
import type { ModifierDef, PixelRange } from '../types';

/** Delay-line depth in frames. At 60fps (~16ms) this spans ~1s — enough for the 0..1000ms
    `delayMs` range down to ~16ms frames; a longer delay clamps to this span. */
const ECHO_SLOTS = 64;

/** Per-voice ring of the last {@link ECHO_SLOTS} wet frames, packed to the voice's range
    length (stride = rangeLen·4). `pos` is the slot written this tick. */
interface EchoState {
  buf: Float32Array;
  rangeLen: number;
  pos: number;
}

export const echo: ModifierDef<EchoState> = {
  id: 'echo',
  name: 'Echo',
  category: 'temporal',
  paramSpec: [
    { key: 'delayMs', label: 'Delay', type: 'number', default: 120, min: 0, max: 1000, step: 10, unit: 'ms' },
    { key: 'feedback', label: 'Feedback', type: 'number', default: 0.5, min: 0, max: 0.95, step: 0.05 },
  ],

  createState(_model: PixelModel, range: PixelRange): EchoState {
    const rangeLen = Math.max(0, range.end - range.start);
    return { buf: new Float32Array(ECHO_SLOTS * rangeLen * 4), rangeLen, pos: 0 };
  },

  apply(ctx, params, fb, range: PixelRange, state): void {
    const delayMs = pnum(params, 'delayMs', 120);
    const feedback = clamp01(pnum(params, 'feedback', 0.5));
    // Delay in whole slots (frames), at least 1 so read and write never alias the same slot.
    const delaySlots = clamp(Math.round(delayMs / Math.max(ctx.dt, 1e-6)), 1, ECHO_SLOTS - 1);
    const stride = state.rangeLen * 4;
    const buf = state.buf;
    const src = fb.rgba;
    const readSlot = ((state.pos - delaySlots) % ECHO_SLOTS + ECHO_SLOTS) % ECHO_SLOTS;
    const writeBase = state.pos * stride;
    const readBase = readSlot * stride;
    for (let i = range.start; i < range.end; i++) {
      const j = i * 4;
      const b = (i - range.start) * 4;
      for (let c = 0; c < 4; c++) {
        const echoed = buf[readBase + b + c]! * feedback;
        const out = Math.min(1, src[j + c]! + echoed);
        src[j + c] = out;
        buf[writeBase + b + c] = out;
      }
    }
    state.pos = (state.pos + 1) % ECHO_SLOTS;
  },
};
