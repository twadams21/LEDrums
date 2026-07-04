import type { PixelModel } from '../geometry/pixel-model';
import type { Framebuffer } from '../engine/framebuffer';
import type { RenderContext } from '../engine/render-context';

export type ParamType = 'number' | 'color' | 'enum' | 'bool';

/** Declares a single effect parameter so the UI can render a control generically. */
export interface ParamSpec {
  key: string;
  label: string;
  type: ParamType;
  default: number | string | boolean;
  min?: number;
  max?: number;
  step?: number;
  /** Allowed values for `enum` params. */
  options?: string[];
  /** Suffix shown in the UI (e.g. "ms", "Hz"). */
  unit?: string;
}

export type EffectCategory = 'base' | 'trigger' | 'wash' | 'meter' | 'utility' | 'texture' | 'particle';

/**
 * Which clock a generator animates against.
 * - `'absolute'` (default): free-running engine time. Correct for base/ambient loops
 *   (breathing-kit, hue-rotate-kit, textures used as looks) — they must NOT phase-snap on
 *   section recall. `ctx.timeMs` / `ctx.transport` are the engine's wall-clock + transport.
 * - `'voice'`: hit-relative. The generator bridge feeds `trig.ageMs` as `ctx.timeMs` and a
 *   voice-local `ctx.transport` (beat derived from age×bpm), so the effect starts from its
 *   start position on each hit and restarts on retrigger (new voice = animation from 0).
 */
export type EffectTimebase = 'voice' | 'absolute';

/** Resolved parameter values (base params overlaid with modulation), passed to render. */
export type ResolvedParams = Record<string, number | string | boolean>;

/**
 * A pure per-pixel renderer. `render` reads the context + resolved params and writes
 * into the layer framebuffer. Stateful effects declare a `State` and a `createState`;
 * the engine owns that state, resets it on clip change, and never persists it (KTD7).
 */
export interface EffectGenerator<State = unknown> {
  id: string;
  name: string;
  category: EffectCategory;
  paramSpec: ParamSpec[];
  /**
   * Clock this effect animates against (default `'absolute'`). The flag is interface, not
   * convention — the generator bridge and the thumbnail renderer both read it to decide
   * which clock to feed. Converting a free-running effect to restart-on-trigger is then a
   * one-line declaration here plus (where the effect reads `ctx.timeMs` directly) swapping
   * to the now voice-local clock; the generator signature never changes. See
   * {@link EffectTimebase}.
   */
  timebase?: EffectTimebase;
  /** Build per-clip mutable state (accumulation buffers, RNG cursor, held color).
      `seed` (item C) is the host voice's per-trigger seed — RNG-backed effects seed their
      stream from it so each fire looks different yet replays exactly; absent (older callers,
      thumbnails) they fall back to their fixed default seed. */
  createState?(model: PixelModel, seed?: number): State;
  render(ctx: RenderContext, params: ResolvedParams, fb: Framebuffer, state: State): void;
}

// --- param readers (tolerant of missing/modulated values) ---

export function pnum(params: ResolvedParams, key: string, fallback: number): number {
  const v = params[key];
  return typeof v === 'number' && Number.isFinite(v) ? v : fallback;
}

export function pstr(params: ResolvedParams, key: string, fallback: string): string {
  const v = params[key];
  return typeof v === 'string' ? v : fallback;
}

export function pbool(params: ResolvedParams, key: string, fallback: boolean): boolean {
  const v = params[key];
  return typeof v === 'boolean' ? v : fallback;
}

/** Build the default param record from a paramSpec (used to seed clips and tests). */
export function defaultParams(spec: ParamSpec[]): ResolvedParams {
  const out: ResolvedParams = {};
  for (const s of spec) out[s.key] = s.default;
  return out;
}
