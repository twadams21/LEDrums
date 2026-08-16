/* Option arrays + row derivation for the Splice node editor.
   Pure TS (no runes, no `.svelte`) so the row logic — which is the only part with any real
   decisions in it — is unit-testable without a DOM, like `node-options.ts` beside it. */
import { voice } from '@ledrums/core';
import type { Bus, EffectDef, GraphNode } from '../../trigger-lab/sim';

export const SPLICE_PARTITION_OPTS: Array<{ value: voice.SplicePartition; label: string }> = [
  { value: 'hoop', label: 'Hoop' },
  { value: 'drum', label: 'Drum' },
  { value: 'scope', label: 'Scope' },
];

export const SPLICE_CHASE_OPTS: Array<{ value: voice.SpliceChaseMode; label: string }> = [
  { value: 'off', label: 'Off' },
  { value: 'step', label: 'Chase' },
  { value: 'smooth', label: 'Spin' },
  { value: 'stagger', label: 'Stagger' },
];

/** One-line explanation of what each motion actually moves — the three are easy to confuse. */
export const SPLICE_CHASE_HINTS: Record<voice.SpliceChaseMode, string> = {
  off: '',
  step: 'Each splice hands its content to the next one, a splice per interval.',
  smooth: 'The whole cut glides around, one full lap per interval.',
  stagger: 'The whole cut jumps by a set number of pixels each interval — the same movement as Spin, but landing on steps instead of gliding.',
};

export const SPLICE_RATE_MODE_OPTS: Array<{ value: 'beats' | 'time'; label: string }> = [
  { value: 'beats', label: 'Division' },
  { value: 'time', label: 'Time' },
];

export const SPLICE_DIRECTION_OPTS: Array<{ value: string; label: string }> = [
  { value: '1', label: 'Forward' },
  { value: '-1', label: 'Reverse' },
];

export const SPLICE_OFFSET_MODE_OPTS: Array<{ value: 'beats' | 'time'; label: string }> = [
  { value: 'beats', label: 'Division' },
  { value: 'time', label: 'Time' },
];

/** The order the units start moving in when a cascade offset is set. */
export const SPLICE_ORDER_OPTS: Array<{ value: voice.SpliceOrder; label: string }> = [
  { value: 'up', label: 'Up' },
  { value: 'down', label: 'Down' },
  { value: 'outside-in', label: 'Outside in' },
  { value: 'random', label: 'Random' },
];

export const SPLICE_MOTION_MODE_OPTS: Array<{ value: voice.SpliceMotionMode; label: string }> = [
  { value: 'restart', label: 'Restart' },
  { value: 'continuous', label: 'Continuous' },
  { value: 'latched', label: 'Latched' },
];

/** What a hit does to the motion — the pair is easy to mix up, so each says it outright. */
export const SPLICE_MOTION_MODE_HINTS: Record<voice.SpliceMotionMode, string> = {
  restart: 'Every hit puts the movement back to its starting position.',
  continuous: 'The movement free-runs, even while the kit is dark — a hit lands wherever it has travelled unseen.',
  latched: 'The movement only runs while the lights are up: it stops where the fade left it, and the next hit carries on from there.',
};

/**
 * Layer options for a splice, with each layer's polyphony spelled out — because that rule IS
 * the sustain-or-cut choice: a MONO layer releases whatever it was already playing when a new
 * voice starts (so a sequencer stepping between splice nodes cuts each hoop as it moves on),
 * while a POLY layer lets them overlap and fade out on their own envelopes.
 */
export function spliceLayerOptions(buses: readonly Bus[]): Array<{ value: string; label: string }> {
  return buses.map((b) => ({ value: b.id, label: `${b.name} · ${b.polyphony === 'mono' ? 'cuts' : 'sustains'}` }));
}

export const SPLICE_WAIT_MODE_OPTS: Array<{ value: voice.SpliceWaitMode; label: string }> = [
  { value: 'lit', label: 'Lit' },
  { value: 'dark', label: 'Dark' },
  { value: 'pulse', label: 'Pulse' },
];

/** What a unit does before the cascade reaches it — the difference is whether the LIGHT travels
    or only the movement does. */
export const SPLICE_WAIT_MODE_HINTS: Record<voice.SpliceWaitMode, string> = {
  lit: 'Everything lights at once and holds still until the movement reaches it.',
  dark: 'Nothing lights until its turn comes, so the light itself travels across the kit.',
  pulse: 'Each one runs its own attack, hold and fade as the cascade reaches it, then goes dark again — a pulse travelling across the kit.',
};

/** What one partition unit IS, for labelling the cascade controls — the offset runs across
    hoops under the hoop partition and across drums under the drum partition, so the controls
    say which rather than making the author infer it. */
export function spliceUnitNoun(partition: voice.SplicePartition | undefined): string {
  return partition === 'drum' ? 'Drum' : 'Hoop';
}

/** Sentinel for "this splice has no effect" in the per-row effect Select. Empty string is the
    Select's own placeholder state, so the no-effect choice needs a value of its own. */
export const SPLICE_NO_EFFECT = '@none';

/**
 * Effect options for one splice row: every selectable effect, grouped by collection order so
 * the list reads like the gallery rather than like a hash-map dump, with "No effect" first —
 * because colour-only is the DEFAULT thing a splice is, not an edge case.
 */
export function spliceEffectOptions(effects: readonly EffectDef[]): Array<{ value: string; label: string }> {
  const selectable = effects.filter((e) => !e.deprecated);
  const order = new Map(['hits', 'waves', 'particles', 'textures', 'ambient', 'meters', 'canvas'].map((t, i) => [t, i] as const));
  const sorted = [...selectable].sort((a, b) => {
    const ai = order.get(a.playType ?? 'ambient') ?? 99;
    const bi = order.get(b.playType ?? 'ambient') ?? 99;
    return ai - bi || a.name.localeCompare(b.name);
  });
  return [{ value: SPLICE_NO_EFFECT, label: 'No effect' }, ...sorted.map((e) => ({ value: e.id, label: e.name }))];
}

/** One editable splice row, resolved for display. */
export interface SpliceRow {
  index: number;
  color: string | null;
  effectId: string | null;
  muted: boolean;
  /** No colour AND no effect (or muted) — this splice renders nothing. */
  blank: boolean;
  /** This row's values come from the cycling fallback, not from an authored row of its own. */
  cycled: boolean;
}

/**
 * The rows the inspector edits: exactly `spliceCount` of them, since that is how many bands
 * actually render. Slots past the authored list show the values they will really render with
 * (the cycling fallback) and are flagged `cycled`, so an author sees what slot 5 does before
 * touching it — editing one simply materialises it.
 */
export function spliceRows(node: GraphNode): SpliceRow[] {
  const authored = node.splices ?? [];
  const count = Math.max(voice.MIN_SPLICE_COUNT, Math.min(voice.MAX_SPLICE_COUNT, node.spliceCount ?? voice.DEFAULT_SPLICE_COUNT));
  return Array.from({ length: count }, (_, index) => {
    const def = voice.spliceDefAt(authored, index);
    return {
      index,
      color: typeof def?.color === 'string' && def.color.length > 0 ? def.color : null,
      effectId: typeof def?.effectId === 'string' && def.effectId.length > 0 ? def.effectId : null,
      muted: !!def?.muted,
      blank: voice.isBlankSplice(def),
      cycled: index >= authored.length,
    };
  });
}

/** Short "what is in this splice" line for a row: its effect, its colour, or that it is blank. */
export function describeSpliceRow(row: SpliceRow, effectName: (id: string) => string): string {
  if (row.muted) return 'muted';
  if (row.effectId) return row.color ? `${effectName(row.effectId)} · tinted` : effectName(row.effectId);
  if (row.color) return 'colour';
  return 'blank';
}
