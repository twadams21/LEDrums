/**
 * Feedback — classic video-feedback: each frame re-injects a decayed, spatially-shifted copy
 * of the PREVIOUS output back onto the fresh frame (`out = min(1, current + amount·prev[p−shift])`),
 * building echoing, self-propelling trails that march along the strip by `shift` px/frame.
 * `amount` is the feedback gain (< 1 so it settles); `shift` scrolls the feedback path.
 *
 * Temporal: the per-voice accumulator holds the previous output and resets with the voice.
 * Pure/deterministic — the accumulator is the only state, read (shifted, edge-clamped) before
 * this frame overwrites it.
 */
import { pnum } from '../../effects/types';
import type { PixelModel } from '../../geometry/pixel-model';
import type { ModifierDef, PixelRange } from '../types';
import { clampIndex, rangeLen } from './strip';

interface FeedbackState {
  /** Previous frame's output over the model, read as this frame's feedback source. */
  acc: Float32Array;
}

export const feedback: ModifierDef<FeedbackState> = {
  id: 'feedback',
  name: 'Feedback',
  category: 'temporal',
  paramSpec: [
    { key: 'amount', label: 'Feedback', type: 'number', default: 0.5, min: 0, max: 0.98, step: 0.01 },
    { key: 'shift', label: 'Shift', type: 'number', default: 1, min: -16, max: 16, step: 1, unit: 'px' },
  ],

  createState(model: PixelModel): FeedbackState {
    return { acc: new Float32Array(model.pixelCount * 4) };
  },

  apply(_ctx, params, fb, range: PixelRange, state): void {
    const amount = pnum(params, 'amount', 0.5);
    const shift = Math.round(pnum(params, 'shift', 1));
    const len = rangeLen(range);
    if (len <= 0) return;
    const dst = fb.rgba;
    const acc = state.acc;
    // Blend the shifted previous output onto the fresh frame (acc is read-only this pass).
    for (let p = 0; p < len; p++) {
      const gi = (range.start + p) * 4;
      const pi = clampIndex(range, p - shift, len) * 4; // previous output, shifted
      for (let c = 0; c < 4; c++) {
        dst[gi + c] = Math.min(1, dst[gi + c]! + amount * acc[pi + c]!);
      }
    }
    // Persist this frame's output as next frame's feedback source.
    for (let i = range.start; i < range.end; i++) {
      const j = i * 4;
      acc[j] = dst[j]!;
      acc[j + 1] = dst[j + 1]!;
      acc[j + 2] = dst[j + 2]!;
      acc[j + 3] = dst[j + 3]!;
    }
  },
};
