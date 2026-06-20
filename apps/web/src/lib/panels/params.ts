import type { ParamSpec } from '@ledrums/core';

// ---------------------------------------------------------------------------
// paramSpec → control descriptor (drives generic EffectParams rendering)
// ---------------------------------------------------------------------------

export type ControlKind = 'slider' | 'swatch' | 'select' | 'checkbox';

export interface ControlDescriptor {
  kind: ControlKind;
  key: string;
  label: string;
  default: number | string | boolean;
  min?: number;
  max?: number;
  step?: number;
  options?: string[];
  unit?: string;
}

/** Map a ParamSpec to the control type the UI should render. */
export function controlForParam(spec: ParamSpec): ControlDescriptor {
  const base = {
    key: spec.key,
    label: spec.label,
    default: spec.default,
    min: spec.min,
    max: spec.max,
    step: spec.step,
    options: spec.options,
    unit: spec.unit,
  };
  switch (spec.type) {
    case 'number':
      return { kind: 'slider', ...base };
    case 'color':
      return { kind: 'swatch', ...base };
    case 'enum':
      return { kind: 'select', ...base };
    case 'bool':
      return { kind: 'checkbox', ...base };
    default:
      return { kind: 'slider', ...base };
  }
}

export function controlsForSpec(specs: ParamSpec[]): ControlDescriptor[] {
  return specs.map(controlForParam);
}

// ---------------------------------------------------------------------------
// throttle — leading-edge + trailing coalesce
// ---------------------------------------------------------------------------

export interface Throttled<A extends unknown[]> {
  (...args: A): void;
  cancel(): void;
}

/**
 * Leading-edge throttle: the first call in a window dispatches immediately;
 * subsequent calls within `ms` are coalesced and the *latest* args fire once
 * at the trailing edge. Good for slider drags → bounded setParam rate.
 */
export function throttle<A extends unknown[]>(fn: (...args: A) => void, ms: number): Throttled<A> {
  let last = -Infinity;
  let timer: ReturnType<typeof setTimeout> | null = null;
  let pending: A | null = null;

  const now = (): number =>
    typeof performance !== 'undefined' && typeof performance.now === 'function'
      ? performance.now()
      : Date.now();

  const invoke = (args: A): void => {
    last = now();
    fn(...args);
  };

  const wrapped = ((...args: A) => {
    const elapsed = now() - last;
    if (elapsed >= ms) {
      invoke(args);
      return;
    }
    // Within the window: remember latest args, arm a trailing-edge timer.
    pending = args;
    if (timer === null) {
      timer = setTimeout(() => {
        timer = null;
        if (pending !== null) {
          const p = pending;
          pending = null;
          invoke(p);
        }
      }, ms - elapsed);
    }
  }) as Throttled<A>;

  wrapped.cancel = () => {
    if (timer !== null) {
      clearTimeout(timer);
      timer = null;
    }
    pending = null;
  };

  return wrapped;
}

// ---------------------------------------------------------------------------
// tapTempo — average tap interval → BPM
// ---------------------------------------------------------------------------

/**
 * Compute BPM from an ordered list of tap timestamps (ms). Needs ≥2 taps.
 * Averages the inter-tap intervals; returns null with fewer than 2 taps.
 * Result is clamped to a sane 20..400 BPM range.
 */
export function tapTempo(times: number[]): number | null {
  if (times.length < 2) return null;
  let sum = 0;
  let n = 0;
  for (let i = 1; i < times.length; i++) {
    const dt = times[i]! - times[i - 1]!;
    if (dt > 0) {
      sum += dt;
      n += 1;
    }
  }
  if (n === 0) return null;
  const avgMs = sum / n;
  const bpm = 60000 / avgMs;
  return Math.max(20, Math.min(400, Math.round(bpm)));
}
