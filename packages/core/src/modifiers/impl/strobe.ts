/**
 * Strobe / Shutter — a rate/duty chop. Gates the voice's output on and off at a fixed
 * frequency: during the "on" slice of each cycle the frame passes through untouched;
 * during the "off" slice the range is blanked to black. Classic shutter / strobe flash.
 *
 * The phase is read from the host voice's LOCAL clock (`ctx.timeMs`, the voice's age —
 * never wall-clock), so the chop starts with the voice and every replay lines up:
 *   phase = (timeMs mod periodMs) / periodMs,   periodMs = 1000 / rate
 *   on    = phase < duty
 *
 * `rate` ≤ 0 or `duty` ≥ 1 → always on (identity); `duty` ≤ 0 → always off. Stateless and
 * deterministic: a pure function of the voice clock and its params.
 */
import { pnum } from '../../effects/types';
import type { ModifierDef, PixelRange } from '../types';

export const strobe: ModifierDef = {
  id: 'strobe',
  name: 'Strobe',
  category: 'temporal',
  paramSpec: [
    { key: 'rate', label: 'Rate', type: 'number', default: 8, min: 0.1, max: 40, step: 0.1, unit: 'Hz' },
    { key: 'duty', label: 'Duty', type: 'number', default: 0.5, min: 0, max: 1, step: 0.05 },
  ],

  apply(ctx, params, fb, range: PixelRange): void {
    const rate = pnum(params, 'rate', 8);
    const duty = pnum(params, 'duty', 0.5);
    if (rate <= 0 || duty >= 1) return; // always on → identity
    const periodMs = 1000 / rate;
    const phase = ((ctx.timeMs % periodMs) + periodMs) % periodMs / periodMs; // [0,1), robust to <0
    if (duty > 0 && phase < duty) return; // in the "on" window → pass through
    // Off window (or duty ≤ 0): blank the range to black.
    const out = fb.rgba;
    for (let i = range.start; i < range.end; i++) {
      const j = i * 4;
      out[j] = 0;
      out[j + 1] = 0;
      out[j + 2] = 0;
      out[j + 3] = 0;
    }
  },
};
