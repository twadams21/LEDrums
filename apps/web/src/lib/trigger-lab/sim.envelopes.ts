/* =============================================================================
   TRIGGER LAB — envelopes + param primitives.

   The envelope shape model, the standard easing set, and the sampling code are
   SINGLE-SOURCED in `@ledrums/core` (`voice/envelope.ts` + `voice/easing.ts`) and
   re-exported here (the `computeDelayMs` precedent: web imports it, no drift). The
   S23 rework moved the duplicated shape/easing/sampling code out of this file — what
   remains local is only the param-value primitives, which a sibling slice (S18) is
   widening for enum/colour params and therefore owns.
   ============================================================================= */

import { voice } from '@ledrums/core';

// ---- Envelope shape / easing / sampling — single-sourced in core (S23) ------

export type EnvKind = voice.EnvKind;
export type EnvPoint = voice.EnvPoint;
export type Envelope = voice.Envelope;
export type EnvMap = voice.EnvMap;
export type AdsrShape = voice.AdsrShape;
export type EaseFn = voice.EaseFn;
export type EaseDir = voice.EaseDir;
export type EaseSpec = voice.EaseSpec;

// Re-exported by value so identity holds (`sampleEnvelope === voice.sampleEnvelope`):
// proof there is one implementation, not a copy.
export const {
  envShape,
  presetPoints,
  defaultEnvelope,
  cloneEnvelope,
  defaultAdsr,
  adsrToPoints,
  sampleEnvelope,
  migrateAdsr,
  ease,
} = voice;

/** Named envelope shapes the editor seeds from (then reshapes into a curve). */
export const ENV_KINDS: EnvKind[] = ['decay', 'rise', 'pluck', 'pulse'];

// ---- Param primitives (local — owned here until S18 widens ParamValue) -------

/** Mirrors core `voice.ParamValue` (S18): numbers/booleans plus `string` for enum choices
    and static-colour hex params. Kept structurally identical to the core type so a web
    `EffectDef`/play-node flows into a `voice.Show` (setShow) without a conversion. */
export type ParamValue = number | boolean | string;
export type ParamValues = Record<string, ParamValue>;

export interface ParamSpec {
  key: string;
  label: string;
  kind: 'number' | 'bool' | 'enum' | 'color';
  min?: number;
  max?: number;
  step?: number;
  unit?: string;
  /** Allowed values for an `enum` param (rendered as a Select). */
  options?: string[];
  default: ParamValue;
  /** a number param an envelope can sweep over the voice's life. */
  envable?: boolean;
}

/** Clamp to the unit interval 0..1 — the shared helper every value primitive uses. */
export const clampUnit = (x: number): number => (x < 0 ? 0 : x > 1 ? 1 : x);
