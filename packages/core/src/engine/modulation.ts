import { clamp01, lerp, wrap } from '../math';
import type { Clip, ControlSource, Curve, ParamValue } from '../model/project-schema';
import type { ResolvedParams } from '../effects/types';
import type { ControlState } from './control-state';
import type { TransportState } from './render-context';

/** Bipolar/unipolar LFO value in [0,1] for a given shape, time, and rate. */
export function lfoValue(shape: string, timeMs: number, rate: number): number {
  const phase = wrap(timeMs * 0.001 * rate, 1);
  switch (shape) {
    case 'saw':
      return phase;
    case 'square':
      return phase < 0.5 ? 1 : 0;
    case 'triangle':
      return phase < 0.5 ? phase * 2 : 2 - phase * 2;
    case 'sine':
    default:
      return 0.5 + 0.5 * Math.sin(phase * Math.PI * 2);
  }
}

/** Resolve a control source to a normalized 0..1 value. */
export function sourceValue(
  source: ControlSource,
  cs: ControlState,
  transport: TransportState,
): number {
  switch (source.type) {
    case 'velocity':
      return source.drum ? cs.getVelocity(source.drum) : cs.maxVelocity();
    case 'volume':
      return clamp01(cs.volume);
    case 'beat':
      // Sawtooth ramp that resets every (1/mult) beats.
      return wrap(transport.beat * source.mult, 1);
    case 'lfo':
      return lfoValue(source.shape, transport.timeMs, source.rate);
    case 'osc':
      return clamp01(cs.getOsc(source.address));
  }
}

/** Apply a response curve to a normalized value. */
export function applyCurve(curve: Curve, x: number): number {
  const c = clamp01(x);
  switch (curve) {
    case 'linear':
      return c;
    case 'exp':
      return c * c;
    case 'log':
      return Math.sqrt(c);
    case 'invert':
      return 1 - c;
  }
}

/**
 * Resolve a clip's effective parameters: base params overlaid with each modulation's
 * `lerp(min, max, curve(sourceValue))`. Pure given (clip, control state, transport).
 */
export function resolveParams(
  clip: Clip,
  cs: ControlState,
  transport: TransportState,
): ResolvedParams {
  const out: ResolvedParams = {};
  for (const [k, v] of Object.entries(clip.params)) out[k] = v as ParamValue;
  for (const mod of clip.modulations) {
    const sv = applyCurve(mod.curve, sourceValue(mod.source, cs, transport));
    out[mod.param] = lerp(mod.min, mod.max, sv);
  }
  return out;
}
