import type { Scope } from './types';

export interface ScopeTarget {
  scope: Scope;
  targetId?: string;
}

type PixelSet =
  | { kind: 'kit' }
  | { kind: 'drum'; drumId: string }
  | { kind: 'hoop'; drumId: string; hoopIndices: number[] };

/** Hoop list to use for a `#`-qualified target id that yields no valid indices:
    `'first'` → `[1]` (never render nothing — hoops are 1-based, A1), `'sentinel'` → `[-1]`
    (an unmatchable index, so an invalid hoop ref intersects to nothing), `'none'` → `[]`. */
export type EmptyHoopFallback = 'first' | 'sentinel' | 'none';

export interface ParseHoopTargetOptions {
  /** No `#` in the target id → source drum, hoop `[1]` (the never-render-nothing
      default the compositor and inspector use; hoops are 1-based per A1). When `false`,
      the drum id is parsed from the raw string and an absent hoop list uses {@link emptyFallback}. */
  sourceDrumOnNoHash: boolean;
  /** Hoop list for a `#`-qualified id whose index portion parses to nothing. */
  emptyFallback: EmptyHoopFallback;
  /** Sort the deduped indices ascending; else keep first-seen order. */
  sort: boolean;
}

/**
 * The three parse policies that actually exist in the tree, named instead of respelled as
 * anonymous literals at each call site. Every production caller of {@link parseHoopTarget}
 * passes one of these; `scope.parse.test.ts` imports them so the suite fails if a preset
 * drifts from what a caller expects.
 *
 * - `compositor` — the render path (compositor.ts). Never render nothing: a hash-less id is the
 *   source drum's hoop 1 and an unparseable index portion falls back to `[1]`. Authoring order.
 * - `inspector` — the scope inspector UI. Same hash-less short-circuit, but an explicit "none"
 *   selection stays empty rather than snapping back to hoop 1, and hoops display sorted.
 * - `resolver` — scope intersection ({@link intersectScopeTargets}). Parses the drum id out of a
 *   hash-less string rather than assuming the source drum, and uses the unmatchable `[-1]`
 *   sentinel so an invalid hoop ref intersects to nothing instead of silently lighting hoop 1.
 */
export const HOOP_TARGET_POLICIES = {
  compositor: { sourceDrumOnNoHash: true, emptyFallback: 'first', sort: false },
  inspector: { sourceDrumOnNoHash: true, emptyFallback: 'none', sort: true },
  resolver: { sourceDrumOnNoHash: false, emptyFallback: 'sentinel', sort: true },
} as const satisfies Record<string, ParseHoopTargetOptions>;

export interface HoopTarget {
  drumId: string | null;
  hoopIndices: number[];
}

/** The ONE place the `"<drumId>#<h>[,<h>]"` wire form is spelled. Deliberately does NOT
    normalise its indices — {@link fromPixelSet} must be able to emit the `[-1]` sentinel that
    the `resolver` policy produces, which {@link encodeHoopTarget}'s `>= 1` filter would erase
    into a bare `"drum#"`. Callers that want normalisation go through encodeHoopTarget.
    KNOWN LIMITATION: the separators are unescaped, so a drumId containing '#' or ',' does not
    round-trip — pinned by the `documents-unescaped-drumid-limitation` characterisation test in
    scope.parse.test.ts rather than fixed here (it would need an escaping decision). */
function formatHoopTarget(drumId: string, indices: readonly number[]): string {
  return `${drumId}#${indices.join(',')}`;
}

/** Encode an authoring hoop selection to a scope target id: deduped, sorted, indices < 1
    dropped (hoops are 1-based per A1). The hoop-target ENCODER now lives in exactly one
    module — the scope inspector re-exports this rather than keeping its own copy. */
export function encodeHoopTarget(drumId: string, hoops: readonly number[]): string {
  const normalized = [...new Set(hoops)].filter((v) => Number.isInteger(v) && v >= 1).sort((a, b) => a - b);
  return formatHoopTarget(drumId, normalized);
}

/**
 * Canonical parse of a `"<drumId>#<hoopIndex>[,<hoopIndex>]"` scope target into a drum
 * id + hoop-index list. The compositor, the lab renderer, and the scope inspector all
 * decode this same grammar but diverge on three deliberate points — sort order, the
 * empty-hoop fallback, and how a hash-less id is treated — expressed here as
 * {@link ParseHoopTargetOptions} so each caller keeps its existing behaviour.
 */
export function parseHoopTarget(
  targetId: string | undefined,
  sourceDrumId: string | null,
  options: ParseHoopTargetOptions,
): HoopTarget {
  const { sourceDrumOnNoHash, emptyFallback, sort } = options;
  if (!targetId || (sourceDrumOnNoHash && !targetId.includes('#'))) {
    return { drumId: sourceDrumId, hoopIndices: [1] };
  }
  const sep = targetId.indexOf('#');
  const drumId = sep === -1 ? targetId : targetId.slice(0, sep);
  const parsed = (sep === -1 ? '' : targetId.slice(sep + 1))
    .split(',')
    .map((v) => Number(v))
    .filter((v) => Number.isInteger(v) && v >= 1); // hoops are 1-based (A1)
  const deduped = [...new Set(parsed)];
  const indices = sort ? deduped.sort((a, b) => a - b) : deduped;
  const fallback = emptyFallback === 'first' ? [1] : emptyFallback === 'sentinel' ? [-1] : [];
  return { drumId: drumId || sourceDrumId, hoopIndices: indices.length ? indices : fallback };
}

function toPixelSet(target: ScopeTarget, sourceDrumId: string): PixelSet {
  if (target.scope === 'kit') return { kind: 'kit' };
  if (target.scope === 'drum') return { kind: 'drum', drumId: target.targetId || sourceDrumId };
  const { drumId, hoopIndices } = parseHoopTarget(target.targetId, sourceDrumId, HOOP_TARGET_POLICIES.resolver);
  return { kind: 'hoop', drumId: drumId ?? sourceDrumId, hoopIndices };
}

function intersectPixelSets(a: PixelSet, b: PixelSet): PixelSet | null {
  if (a.kind === 'kit') return b;
  if (b.kind === 'kit') return a;
  if (a.kind === 'drum' && b.kind === 'drum') return a.drumId === b.drumId ? a : null;
  if (a.kind === 'drum' && b.kind === 'hoop') return a.drumId === b.drumId ? b : null;
  if (a.kind === 'hoop' && b.kind === 'drum') return a.drumId === b.drumId ? a : null;
  if (a.kind === 'hoop' && b.kind === 'hoop') {
    if (a.drumId !== b.drumId) return null;
    const hoopIndices = a.hoopIndices.filter((i) => b.hoopIndices.includes(i));
    return hoopIndices.length ? { kind: 'hoop', drumId: a.drumId, hoopIndices } : null;
  }
  return null;
}

function fromPixelSet(set: PixelSet): ScopeTarget {
  if (set.kind === 'kit') return { scope: 'kit' };
  if (set.kind === 'drum') return { scope: 'drum', targetId: set.drumId };
  // NON-normalising on purpose: hoopIndices here can be the resolver policy's `[-1]` sentinel,
  // which encodeHoopTarget would filter away into a bare `"drum#"`. See formatHoopTarget.
  return { scope: 'hoop', targetId: formatHoopTarget(set.drumId, set.hoopIndices) };
}

/** Strictly intersect a current route scope with another Scope node / Output scope.
    Whole-kit is identity, never a reset. `null` means the intersection is empty. */
export function intersectScopeTargets(
  current: ScopeTarget,
  next: ScopeTarget,
  sourceDrumId: string,
): ScopeTarget | null {
  const intersection = intersectPixelSets(toPixelSet(current, sourceDrumId), toPixelSet(next, sourceDrumId));
  return intersection ? fromPixelSet(intersection) : null;
}
