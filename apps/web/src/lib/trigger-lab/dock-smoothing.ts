/* Layers/Buses display smoothing (phase-2 item 3 / H). The server streams voice stats at
   ~2 Hz and the client adopted them raw, so meters and voice chips visibly stepped
   (wave-1 measured ~430–500 ms jumps). The server stays the TRUTH — these helpers only
   produce a DISPLAY value that exponentially approaches the latest authoritative value,
   advanced every rAF frame by the store. Pure (no runes/DOM) so the convergence and the
   allocation-avoidance (object reuse once converged) are unit-tested directly. */

import type { DockVoice } from './dock-voices';

/** Frame-rate-independent smoothing factor for an exponential approach with time
    constant `tauMs` (~150 ms ≈ meters glide over a couple of frames of the 2 Hz feed
    without feeling laggy). `alpha = 1 - e^(-dt/τ)` — correct for any frame delta. */
export function smoothingAlpha(dtMs: number, tauMs = 150): number {
  if (dtMs <= 0) return 0;
  return 1 - Math.exp(-dtMs / tauMs);
}

/** Values closer than this to their target snap to it — quantizes convergence so the
    smoothed objects/strings stop churning once motion has settled. */
const SNAP_EPS = 0.004;

const approach = (prev: number, target: number, alpha: number): number => {
  const next = prev + (target - prev) * alpha;
  return Math.abs(next - target) < SNAP_EPS ? target : next;
};

/** Smooth a bus-level record toward `target`. Keys follow the target (a removed bus
    drops out); a NEW key starts at its target (no ramp-in from zero on first sight). */
export function smoothBusLevels(
  prev: Record<string, number>,
  target: Record<string, number>,
  alpha: number,
): Record<string, number> {
  const out: Record<string, number> = {};
  let changed = false;
  for (const key of Object.keys(target)) {
    const t = target[key]!;
    const p = prev[key];
    out[key] = p === undefined ? t : approach(p, t, alpha);
    if (out[key] !== p) changed = true;
  }
  if (!changed && Object.keys(prev).length === Object.keys(target).length) return prev;
  return out;
}

/** Smooth each dock voice's `level` toward its authoritative value. `levels` is the
    caller-owned per-voice display-level map (pruned of dead voices in place). Voices
    whose display level equals the target are returned by REFERENCE (zero churn for
    settled chips — the per-voice style string only reallocates while actually moving). */
export function smoothDockVoices(
  levels: Map<string, number>,
  voices: readonly DockVoice[],
  alpha: number,
): DockVoice[] {
  const seen = new Set<string>();
  const out: DockVoice[] = new Array(voices.length);
  for (let i = 0; i < voices.length; i++) {
    const v = voices[i]!;
    seen.add(v.id);
    const prev = levels.get(v.id);
    const lvl = prev === undefined ? v.level : approach(prev, v.level, alpha);
    levels.set(v.id, lvl);
    out[i] = lvl === v.level ? v : { ...v, level: lvl };
  }
  for (const id of levels.keys()) if (!seen.has(id)) levels.delete(id);
  return out;
}

/** Group dock voices by bus in ONE pass — replaces the per-bus `filter()` the dock ran
    on every render (item H allocation waste). */
export function groupVoicesByBus(voices: readonly DockVoice[]): Map<string, DockVoice[]> {
  const byBus = new Map<string, DockVoice[]>();
  for (const v of voices) {
    const list = byBus.get(v.busId);
    if (list) list.push(v);
    else byBus.set(v.busId, [v]);
  }
  return byBus;
}
