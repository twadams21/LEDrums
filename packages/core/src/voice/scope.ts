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
    `'zero'` → `[0]` (never render nothing), `'sentinel'` → `[-1]` (an unmatchable
    index, so an invalid hoop ref intersects to nothing), `'none'` → `[]`. */
export type EmptyHoopFallback = 'zero' | 'sentinel' | 'none';

export interface ParseHoopTargetOptions {
  /** No `#` in the target id → source drum, hoop `[0]` (the never-render-nothing
      default the compositor and inspector use). When `false`, the drum id is parsed
      from the raw string and an absent hoop list uses {@link emptyFallback}. */
  sourceDrumOnNoHash: boolean;
  /** Hoop list for a `#`-qualified id whose index portion parses to nothing. */
  emptyFallback: EmptyHoopFallback;
  /** Sort the deduped indices ascending; else keep first-seen order. */
  sort: boolean;
}

export interface HoopTarget {
  drumId: string | null;
  hoopIndices: number[];
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
    return { drumId: sourceDrumId, hoopIndices: [0] };
  }
  const sep = targetId.indexOf('#');
  const drumId = sep === -1 ? targetId : targetId.slice(0, sep);
  const parsed = (sep === -1 ? '' : targetId.slice(sep + 1))
    .split(',')
    .map((v) => Number(v))
    .filter((v) => Number.isInteger(v) && v >= 0);
  const deduped = [...new Set(parsed)];
  const indices = sort ? deduped.sort((a, b) => a - b) : deduped;
  const fallback = emptyFallback === 'zero' ? [0] : emptyFallback === 'sentinel' ? [-1] : [];
  return { drumId: drumId || sourceDrumId, hoopIndices: indices.length ? indices : fallback };
}

function toPixelSet(target: ScopeTarget, sourceDrumId: string): PixelSet {
  if (target.scope === 'kit') return { kind: 'kit' };
  if (target.scope === 'drum') return { kind: 'drum', drumId: target.targetId || sourceDrumId };
  const { drumId, hoopIndices } = parseHoopTarget(target.targetId, sourceDrumId, {
    sourceDrumOnNoHash: false,
    emptyFallback: 'sentinel',
    sort: true,
  });
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
  return { scope: 'hoop', targetId: `${set.drumId}#${set.hoopIndices.join(',')}` };
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
