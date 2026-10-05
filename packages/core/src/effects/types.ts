import type { PixelModel } from '../geometry/pixel-model';
import type { Framebuffer } from '../engine/framebuffer';
import type { RenderContext } from '../engine/render-context';
import type { EffectTag } from './vocabulary';

export type ParamType = 'number' | 'color' | 'enum' | 'bool';

/** A condition on another param's value, for {@link ParamSpec.showIf}: it holds one of `is` (or
    none of `not`) — or, with `any`, at least one of those conditions holds. */
export type ShowIf =
  | { key: string; is?: readonly (string | number | boolean)[]; not?: readonly (string | number | boolean)[] }
  | { any: readonly ShowIf[] };

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
  /** Suffix shown in the UI (e.g. "ms", "Hz"). `%` on a 0..1 param: shown as a whole percent. */
  unit?: string;
  /** The card section this param sits under (shown as a capitalised header). Display only. */
  section?: string;
  /** An explanation, shown behind an ⓘ beside the label. Display only. */
  info?: string;
  /** Show the param only while another param holds one of `is` (or none of `not`) — every
      condition, when a list (Dot's Travel angle only for Through a drum / kit / space). Display
      only — a hidden param keeps its value and still renders. */
  showIf?: ShowIf | readonly ShowIf[];
  /** An `enum` whose choices are the kit's drums (value = drum id), filled in by the card after
      its fixed `options` (Dot: `['@hit']`, the drum you hit). Display only. */
  optionsFrom?: 'drums';
  /** A richer control than a slider or a list, drawn by the card. Display only.
      `hoop-pick`: a button per hoop (its range from `rangeFrom`). `hoop-angle`: a ring of the
      hoop's pixels to click, in degrees from the front (0° at the bottom). `drum-order`: the kit's
      drums as chips to drag, stored as comma-separated drum ids. `space-point`: the kit seen from
      the top and the front to click a point in, editing the three 0..1 params named in `keys`. */
  widget?: { kind: 'hoop-pick' } | { kind: 'hoop-angle' } | { kind: 'drum-order' } | { kind: 'space-point'; keys: readonly [string, string, string] };
  /** Edited by another param's widget, so the card shows no row of its own. Display only. */
  partOf?: string;
  /** A range the card reads from the kit (Dot: `start-hoops` — the start drum's hoop count;
      `start-pixels` — its start hoop's pixel count, the dots on the Start angle ring). Display
      only; the effect clamps anyway. */
  rangeFrom?: 'start-hoops' | 'start-pixels';
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
  /** 1–2 sentences for the gallery card + inspector — what it does and why it reads well on
      THIS kit. Populated centrally from `metadata.ts` by the registry (additive, D1). */
  description?: string;
  /** Tags from the controlled vocabulary (`vocabulary.ts`). DATA the gallery filters and
      derives collections from — nothing in the render path branches on them. */
  tags?: readonly EffectTag[];
  /** When set, this effect is retired: hidden from the gallery and aliased to `replacedBy`
      (the alias map keeps existing shows working). Left unset until U3's retire/merge pass. */
  deprecated?: { replacedBy: string; note?: string };
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
  /**
   * Declares that one of this effect's own params governs how long its visuals last, so the
   * host voice's envelope can be derived from the INSTANCE's value instead of the fixed
   * per-category default. Without this, a voice is reaped on the category envelope (a
   * `'trigger'` effect dies at ~410ms) no matter what the effect's Life slider says, and the
   * effect's internal fade never reaches its end — the param appears to do nothing.
   *
   * Two shapes, told apart by `factor`:
   * - A HARD cutoff — the emission is gone at `age >= life`. No factor.
   * - An exponential decay toward a visibility threshold, where the param is a time CONSTANT
   *   and the visible tail is a multiple of it (`decayMs: 220` renders for ~1.2s). Declare
   *   `factor: EXP_TAIL_FACTOR`; sustain becomes `life × factor`.
   *
   * `unit: 'beats'` converts at the voice's spawn bpm, matching how the effect itself
   * converts. Resolved from the registry at spawn ({@link resolveVoiceSustainMs}), so this
   * never has to cross the wire.
   */
  voiceLife?: { key: string; unit: 'ms' | 'beats'; factor?: number };
  /**
   * A cap across hits: how many EARLIER voices of the same Effect may `keep` living when a new
   * one fires, or `undefined` for no cap. The engine cuts the oldest beyond it at fire — or
   * fades them over `fadeMs` (Dot's Max alive). Read from the fire's params, so a modulated value
   * applies from the next hit.
   */
  liveVoices?(params: ResolvedParams): { keep: number; fadeMs?: number } | undefined;
  /**
   * How long this effect's content lasts from the hit (ms), or `null` when it never ends on its
   * own — read when an Effect's Sustain is "until it ends" (amp length `auto`; Dot: until the
   * last dot finishes). `params` arrive tempo-resolved.
   */
  contentSpanMs?(params: ResolvedParams): number | null;
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
