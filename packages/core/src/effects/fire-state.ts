import type { PixelModel } from '../geometry/pixel-model';
import type { RenderContext } from '../engine/render-context';
import { clamp01 } from '../math';
import { lifeFade } from './life-fade';

/** Reused per-generator state for effects that burn from recent drum hits. */
export interface FireEffectState {
  readonly seed: number;
  readonly drumIndexById: ReadonlyMap<string, number>;
  /** Pixel-index lookup built once with the model's contiguous drum ranges. */
  readonly drumIndexByPixel: Int32Array;
  readonly energyByDrum: Float32Array;
}

/** Build the grouping once when the generator voice is created, not once per frame. */
export function createFireEffectState(model: PixelModel, seed = 0): FireEffectState {
  const drumIndexById = new Map<string, number>();
  const drumIndexByPixel = new Int32Array(model.pixelCount);
  drumIndexByPixel.fill(-1);
  for (let i = 0; i < model.drums.length; i++) {
    const drum = model.drums[i]!;
    drumIndexById.set(drum.drumId, i);
    drumIndexByPixel.fill(i, drum.pixelStart, drum.pixelStart + drum.pixelCount);
  }
  return { seed: seed >>> 0, drumIndexById, drumIndexByPixel, energyByDrum: new Float32Array(model.drums.length) };
}

/** Fill the reused per-drum energy table and return whether any drum can render. */
export function updateFireEnergy(
  ctx: RenderContext,
  state: FireEffectState,
  decayMs: number,
): boolean {
  state.energyByDrum.fill(0);
  for (let i = 0; i < ctx.triggers.length; i += 1) {
    const trig = ctx.triggers[i]!;
    const drumIndex = state.drumIndexById.get(trig.drumId);
    if (drumIndex === undefined) continue;
    const velocity = Number.isFinite(trig.velocity) ? clamp01(trig.velocity) : 0;
    const ageMs = Number.isFinite(trig.ageMs) ? Math.max(0, trig.ageMs) : 0;
    const energy = velocity * lifeFade(ctx, Math.exp(-ageMs / decayMs));
    if (energy > state.energyByDrum[drumIndex]!) state.energyByDrum[drumIndex] = energy;
  }
  for (let i = 0; i < state.energyByDrum.length; i += 1) {
    if (state.energyByDrum[i]! >= 0.004) return true;
  }
  return false;
}
