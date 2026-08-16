/* Face-param layer (S5) — the ONE list behind both the node-face param rows and the
   inspector's "expose" affordance.

   The verdict (Trent, 2026-08-17): "ride along the existing add parameters to the node to
   allow control with modulation nodes". So a face row IS an exposed `modInputs` row — adding
   a param to the face and exposing it for modulation are the same gesture on the same list.
   Nothing here reshapes that model: `modInputs` stays `{ param: string }[]`.

   What this module adds is the NORMALIZER the face needs. A node declares its params through
   one of two spec dialects — a play/effect node through `EffectDef.params` (`kind`) and a
   modifier node through the core modifier registry's `paramSpec` (`type`) — and the face has
   to render a control per declared TYPE, not per number. `nodeParamSpecs` folds both dialects
   into one shape so every consumer (face rows, the expose picker, the modulation target list)
   reads the same list.

   Pure — no runes, no DOM. The store resolves the rune-backed `effect` and delegates. */

import type { EffectDef, GraphNode, ParamValue, ParamValues } from '../sim';
import { listModifiers } from '@ledrums/core';

/** A declared param, normalized across the two spec dialects. */
export interface FaceParamSpec {
  key: string;
  label: string;
  kind: 'number' | 'bool' | 'enum' | 'color';
  min?: number;
  max?: number;
  step?: number;
  unit?: string;
  /** Allowed values for an `enum` param. */
  options?: string[];
  default: ParamValue;
}

/** Every param a node declares, in declaration order. Play/effect nodes read the resolved
    `effect` (the store resolves it — it is rune-backed); modifier nodes resolve purely via
    `listModifiers()`. Any other kind declares none. */
export function nodeParamSpecs(node: GraphNode, effect: EffectDef | undefined): FaceParamSpec[] {
  if (node.kind === 'play' || node.kind === 'effect') {
    return (effect?.params ?? []).map((s) => ({
      key: s.key,
      label: s.label,
      kind: s.kind,
      min: s.min,
      max: s.max,
      step: s.step,
      unit: s.unit,
      options: s.options,
      default: s.default,
    }));
  }
  if (node.kind === 'modifier') {
    const def = listModifiers().find((m) => m.id === node.modifierId);
    return (def?.paramSpec ?? []).map((s) => ({
      key: s.key,
      label: s.label,
      // the modifier registry names the same field `type`
      kind: s.type,
      min: s.min,
      max: s.max,
      step: s.step,
      unit: s.unit,
      options: s.options,
      default: s.default,
    }));
  }
  return [];
}

/** Whether `key` is currently on the node's face (≡ exposed for modulation). */
export function isParamOnFace(node: GraphNode, key: string): boolean {
  return (node.modInputs ?? []).some((m) => m.param === key);
}

/** Params not yet on the face — the "Add parameter" picker's options. Unlike
    `availableModParams` (numbers only, because only a number can be modulated) this offers
    EVERY declared param: a face row is an editing surface first and a modulation target
    second. A non-numeric row simply carries no `param:<key>` wire handle. */
export function availableFaceParams(
  node: GraphNode,
  effect: EffectDef | undefined,
): { key: string; label: string }[] {
  return nodeParamSpecs(node, effect)
    .filter((s) => !isParamOnFace(node, s.key))
    .map((s) => ({ key: s.key, label: s.label }));
}

/** Only a NUMBER param can be driven by a modulation source, so only a number row carries a
    wire handle. Mirrors the filter `modTargetSpecs` applies. */
export function isModulatable(spec: FaceParamSpec | undefined): boolean {
  return spec?.kind === 'number';
}

/** The value a face row edits: the node's own value, falling back to the spec default (a
    param the node has never written has no entry in `node.params`). */
export function faceParamValue(spec: FaceParamSpec, params: ParamValues | undefined): ParamValue {
  const v = params?.[spec.key];
  return v === undefined ? spec.default : v;
}

/** Read a face value as a number, falling back to the spec default then to `min ?? 0`. */
export function faceNumber(spec: FaceParamSpec, params: ParamValues | undefined): number {
  const v = faceParamValue(spec, params);
  if (typeof v === 'number' && Number.isFinite(v)) return v;
  return typeof spec.default === 'number' ? spec.default : spec.min ?? 0;
}

/** Read a face value as an enum choice, falling back to the first declared option. */
export function faceChoice(spec: FaceParamSpec, params: ParamValues | undefined): string {
  const v = faceParamValue(spec, params);
  if (typeof v === 'string' && (spec.options ?? []).includes(v)) return v;
  return typeof spec.default === 'string' ? spec.default : spec.options?.[0] ?? '';
}

/** The next choice in an enum cycle chip — wraps in both directions. Returns `current`
    when there is nothing to cycle (0 or 1 option), so a click on a degenerate enum is a
    no-op rather than a spurious undo entry. */
export function cycleChoice(options: readonly string[], current: string, dir: 1 | -1 = 1): string {
  if (options.length < 2) return options[0] ?? current;
  const at = options.indexOf(current);
  const from = at === -1 ? 0 : at;
  const next = (from + dir + options.length) % options.length;
  return options[next]!;
}

/** Decimal places implied by a step — so 0.1 + 0.2 never surfaces as 0.30000000000000004. */
function places(step: number | undefined): number {
  if (!step || step <= 0) return 0;
  const text = String(step);
  if (text.includes('e-')) return Number(text.split('e-')[1] ?? 0);
  return text.includes('.') ? text.split('.')[1]?.length ?? 0 : 0;
}

/** The compact read-out a face row shows. Deliberately terser than the inspector's `fmt`:
    a node card is 176–260px wide, so a number carries its unit but never trailing zeros,
    and a bool reads as on/off. */
export function formatFaceValue(spec: FaceParamSpec, value: ParamValue): string {
  if (spec.kind === 'bool') return value === true ? 'on' : 'off';
  if (typeof value === 'number') {
    const p = places(spec.step);
    const text = p > 0 ? value.toFixed(p).replace(/\.?0+$/, '') : String(Math.round(value));
    return `${text}${spec.unit ?? ''}`;
  }
  return String(value ?? '');
}
