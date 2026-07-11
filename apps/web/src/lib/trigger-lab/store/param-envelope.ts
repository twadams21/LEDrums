/* Param + envelope authoring math — the node-local param write and the per-param envelope
   edits behind the store's `setParam` / `setEnvKind` / `setEnvAmount` / `setEnvPoints` /
   `setEnvAdsr`, as PURE transforms (no runes/DOM) over a node's `params` / `env` maps so the
   seed / clear / custom-mark invariants are unit-testable in isolation. The store's mutators
   keep the `isViewer` guard + undo snapshot, then assign these results back onto the live
   `$state` node. Extracted from store.svelte.ts unchanged in behaviour. */

import type { AdsrShape, EnvKind, EnvMap, EnvPoint, ParamValue, ParamValues } from '../sim';
import { adsrToPoints, defaultEnvelope } from '../sim';

/** Author a param value onto a node's `params` — always node-local now that presets are
    snapshots (S39: no linked write-through). Returns a new params map. */
export function setParamValue(params: ParamValues, key: string, value: ParamValue): ParamValues {
  return { ...params, [key]: value };
}

/** Set or clear the envelope on a param: `'none'` removes it, any other kind seeds a preset
    curve via {@link defaultEnvelope}. Returns a new env map. */
export function setEnvKind(env: EnvMap, key: string, kind: EnvKind): EnvMap {
  const next = { ...env };
  if (kind === 'none') delete next[key];
  else next[key] = defaultEnvelope(kind);
  return next;
}

/** Set the amount on an existing envelope. Returns the SAME map when the param has no
    envelope (caller skips the undo snapshot). */
export function setEnvAmount(env: EnvMap, key: string, amount: number): EnvMap {
  const e = env[key];
  if (!e) return env;
  return { ...env, [key]: { ...e, amount } };
}

/** Replace the curve breakpoints, marking the envelope as hand-edited (`custom`). Returns the
    SAME map when the param has no envelope (caller skips the undo snapshot). */
export function setEnvPoints(env: EnvMap, key: string, points: EnvPoint[]): EnvMap {
  const e = env[key];
  if (!e) return env;
  return { ...env, [key]: { ...e, points, kind: 'custom' } };
}

/** Set the ADSR shape on a param's envelope (regenerates the render curve), seeding a blank
    custom envelope when the param has none yet. Returns a new env map. */
export function setEnvAdsr(env: EnvMap, key: string, adsr: AdsrShape): EnvMap {
  const e = env[key] ?? { kind: 'custom' as EnvKind, amount: 1, points: [] };
  return { ...env, [key]: { ...e, adsr: { ...adsr }, points: adsrToPoints(adsr), kind: 'custom' } };
}
