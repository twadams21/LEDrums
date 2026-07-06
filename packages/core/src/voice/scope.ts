import type { Scope } from './types';

export interface ScopeTarget {
  scope: Scope;
  targetId?: string;
}

type PixelSet =
  | { kind: 'kit' }
  | { kind: 'drum'; drumId: string }
  | { kind: 'hoop'; drumId: string; hoopIndex: number };

function parseHoopTarget(targetId: string | undefined, sourceDrumId: string): PixelSet {
  if (!targetId) return { kind: 'hoop', drumId: sourceDrumId, hoopIndex: 0 };
  const [drumId, hoop] = targetId.split('#');
  const hoopIndex = Number(hoop);
  return { kind: 'hoop', drumId: drumId || sourceDrumId, hoopIndex: Number.isFinite(hoopIndex) ? hoopIndex : -1 };
}

function toPixelSet(target: ScopeTarget, sourceDrumId: string): PixelSet {
  if (target.scope === 'kit') return { kind: 'kit' };
  if (target.scope === 'drum') return { kind: 'drum', drumId: target.targetId || sourceDrumId };
  return parseHoopTarget(target.targetId, sourceDrumId);
}

function intersectPixelSets(a: PixelSet, b: PixelSet): PixelSet | null {
  if (a.kind === 'kit') return b;
  if (b.kind === 'kit') return a;
  if (a.kind === 'drum' && b.kind === 'drum') return a.drumId === b.drumId ? a : null;
  if (a.kind === 'drum' && b.kind === 'hoop') return a.drumId === b.drumId ? b : null;
  if (a.kind === 'hoop' && b.kind === 'drum') return a.drumId === b.drumId ? a : null;
  if (a.kind === 'hoop' && b.kind === 'hoop') {
    return a.drumId === b.drumId && a.hoopIndex === b.hoopIndex ? a : null;
  }
  return null;
}

function fromPixelSet(set: PixelSet): ScopeTarget {
  if (set.kind === 'kit') return { scope: 'kit' };
  if (set.kind === 'drum') return { scope: 'drum', targetId: set.drumId };
  return { scope: 'hoop', targetId: `${set.drumId}#${set.hoopIndex}` };
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
