/**
 * Freeze — a sample-and-hold on the frame: captures the voice's output once per `intervalMs`
 * window and replays that held frame until the next window, so live content stutter-freezes on
 * a grid. `intervalMs` ≤ 0 is a passthrough (never holds). Temporal: the held frame is
 * per-voice state, and the sample boundary is driven off the voice-local clock (`ctx.timeMs`),
 * so the freeze grid restarts with the voice. Pure/deterministic.
 */
import { pnum } from '../../effects/types';
import type { PixelModel } from '../../geometry/pixel-model';
import type { ModifierDef, PixelRange } from '../types';

interface FreezeState {
  held: Float32Array;
  /** Index of the interval currently held (−1 before the first capture). */
  sampleIndex: number;
}

export const freeze: ModifierDef<FreezeState> = {
  id: 'freeze',
  name: 'Freeze',
  category: 'temporal',
  paramSpec: [{ key: 'intervalMs', label: 'Hold', type: 'number', default: 500, min: 0, max: 5000, step: 10, unit: 'ms' }],

  createState(model: PixelModel): FreezeState {
    return { held: new Float32Array(model.pixelCount * 4), sampleIndex: -1 };
  },

  apply(ctx, params, fb, range: PixelRange, state): void {
    const interval = pnum(params, 'intervalMs', 500);
    const dst = fb.rgba;
    const held = state.held;
    if (interval <= 0) {
      state.sampleIndex = -1; // passthrough; re-arm so re-enabling captures immediately
      return;
    }
    const idx = Math.floor(ctx.timeMs / interval);
    if (idx !== state.sampleIndex) {
      // New window → capture the current frame (which also passes through unchanged).
      for (let i = range.start; i < range.end; i++) {
        const j = i * 4;
        held[j] = dst[j]!;
        held[j + 1] = dst[j + 1]!;
        held[j + 2] = dst[j + 2]!;
        held[j + 3] = dst[j + 3]!;
      }
      state.sampleIndex = idx;
      return;
    }
    // Same window → replay the held frame.
    for (let i = range.start; i < range.end; i++) {
      const j = i * 4;
      dst[j] = held[j]!;
      dst[j + 1] = held[j + 1]!;
      dst[j + 2] = held[j + 2]!;
      dst[j + 3] = held[j + 3]!;
    }
  },
};
