/* Empty-scope lint (R06, GH #85) — the render-plan compiler's static check for a scope
   chain that can never light a pixel.

   The engine intersects scope constraints as a play flows downstream: a Scope node narrows
   the current target, an Output node narrows again, a Mix resets to whole-kit, and an
   effect/play node seeds the stream with its own scope. When two constraints don't overlap
   the intersection is empty and the engine silently drops the play (`intersectScopeTargets`
   returns `null`, eval `continue`s). A node reached ONLY by such dead streams renders
   nothing — a wired-but-inert branch the author can't see. This surfaces it.

   Provably-empty ONLY. A bare (target-less) scope resolves against the *firing* drum at
   runtime, so its drum axis is a wildcard that can coincide with any concrete drum — it
   never proves emptiness on its own. We assert `empty-scope` for a node only when its
   effective scope is empty for EVERY possible source drum (mirroring `scope.ts`'s runtime
   intersection with `sourceDrumId` treated as a wildcard). This keeps the lint free of
   false positives on the common "auto (firing drum)" targets.

   Pure + framework-free: a function of the compiled flow graph, unit-tested without a DOM. */

import type { Scope } from './types';
import type { GraphNode } from './types';
import type { RenderPlanChild, RenderPlanIssue } from './render-plan';
import { HOOP_TARGET_POLICIES, parseHoopTarget } from './scope'; // S13 — one grammar, not a fifth copy

/** A source-independent view of a scope constraint. `drum: null` is the firing-drum
    wildcard (a bare/auto target) — it can be ANY concrete drum, so it never proves an
    empty intersection on the drum axis. */
type StaticScope =
  | { level: 'kit' }
  | { level: 'drum'; drum: string | null }
  | { level: 'hoop'; drum: string | null; hoops: number[] };

const EMPTY = Symbol('empty-scope');
type Intersection = StaticScope | typeof EMPTY;

/**
 * Parse a node's `(scope, targetId)` into a StaticScope — the static twin of `scope.ts`'s
 * `toPixelSet`, with the runtime `sourceDrumId` replaced by the `null` wildcard.
 *
 * The hoop axis goes through {@link parseHoopTarget} under the SAME named policy `toPixelSet`
 * itself uses (`HOOP_TARGET_POLICIES.resolver`), so the lint and the resolver decode one
 * grammar and cannot disagree. Until INIT-06 S13 this was a fifth hand-rolled copy, and it had
 * missed the A1 cutover in three ways:
 *
 *   · it filtered `v >= 0`, admitting hoop index 0 where the resolver filters `v >= 1` and
 *     falls back to the unmatchable `[-1]` sentinel — so `"kick#0"` rendered nothing at runtime
 *     while the lint saw hoop {0} and called the branch alive (a false NEGATIVE, and the whole
 *     point of this diagnostic);
 *   · it gave a bare (auto) hoop target `hoops: [0]`, where the resolver gives `[1]` — a bare
 *     hoop target resolves to hoop 1 of the firing drum, so the lint called a live branch
 *     provably empty (a false POSITIVE);
 *   · it split on `'#'` and kept only the second field, so a drumId containing '#' lost its
 *     tail differently from every other site. `parseHoopTarget` splits at the FIRST '#' and
 *     keeps the remainder, matching the resolver. (The unescaped-separator limitation itself is
 *     unchanged and still pinned by scope.parse.test.ts's characterisation test.)
 *
 * `drum: null` wildcard semantics are preserved: `sourceDrumId` is passed as `null`, so a bare
 * or drum-less target keeps the firing-drum wildcard that can coincide with any concrete drum.
 */
function staticScope(scope: Scope, targetId: string | undefined): StaticScope {
  if (scope === 'kit') return { level: 'kit' };
  if (scope === 'drum') return { level: 'drum', drum: targetId || null };
  const { drumId, hoopIndices } = parseHoopTarget(targetId, null, HOOP_TARGET_POLICIES.resolver);
  return { level: 'hoop', drum: drumId, hoops: hoopIndices };
}

/** Two drums are provably different only when BOTH are concrete and unequal — a wildcard
    (firing drum) could resolve to either, so it never proves a difference. */
function drumsDiffer(a: string | null, b: string | null): boolean {
  return a !== null && b !== null && a !== b;
}

/** Strictly intersect two static scopes. Returns `EMPTY` only when the intersection is empty
    for every possible source drum. Whole-kit is identity (never a reset). */
function intersect(a: StaticScope, b: StaticScope): Intersection {
  if (a.level === 'kit') return b;
  if (b.level === 'kit') return a;
  if (drumsDiffer(a.drum, b.drum)) return EMPTY;
  const drum = a.drum ?? b.drum; // the concrete drum if either is; else the wildcard
  if (a.level === 'drum' && b.level === 'drum') return { level: 'drum', drum };
  if (a.level === 'hoop' && b.level === 'hoop') {
    const hoops = a.hoops.filter((h) => b.hoops.includes(h));
    return hoops.length ? { level: 'hoop', drum, hoops } : EMPTY;
  }
  // one drum-level, one hoop-level, drums compatible → the hoop (a subset of the drum).
  const hoop = a.level === 'hoop' ? a : (b as Extract<StaticScope, { level: 'hoop' }>);
  return { level: 'hoop', drum, hoops: hoop.hoops };
}

/** Does this node narrow the scope of a play flowing through it? Effect/play nodes SEED a
    stream; Scope/Output nodes narrow it; Mix resets to whole-kit; everything else passes
    the scope through untouched. */
function constraintOf(node: GraphNode): StaticScope | 'reset' | null {
  if (node.kind === 'scope') return staticScope(node.scope, node.targetId);
  if (node.kind === 'output') {
    // Output only narrows when it carries an explicit target; a bare kit Output passes through.
    return node.scope !== 'kit' || node.targetId ? staticScope(node.scope, node.targetId) : null;
  }
  if (node.kind === 'mix') return 'reset';
  return null;
}

/**
 * Flag every Scope/Output node whose effective scope is provably empty on every flow path
 * that reaches it — a wired-but-inert branch that can never light a pixel.
 *
 * Walks each effect/play node's stream forward, accumulating scope constraints exactly as
 * eval does. A constraining node is flagged only when it is reached by ≥1 stream and EVERY
 * reaching stream is empty there; a single live stream keeps it off the list.
 */
export function detectEmptyScopes(
  nodesById: Map<string, GraphNode>,
  flowChildrenById: Map<string, RenderPlanChild[]>,
): RenderPlanIssue[] {
  const reached = new Set<string>();
  const alive = new Set<string>();

  const walk = (nodeId: string, current: StaticScope, onPath: Set<string>): void => {
    for (const child of flowChildrenById.get(nodeId) ?? []) {
      const c = child.node;
      const constraint = constraintOf(c);
      let next: Intersection;
      if (constraint === null) next = current;
      else if (constraint === 'reset') next = { level: 'kit' };
      else next = intersect(current, constraint);

      if (c.kind === 'scope' || c.kind === 'output') {
        reached.add(c.id);
        if (next !== EMPTY) alive.add(c.id);
      }

      if (c.kind === 'output') continue; // terminal collector — nothing flows past it
      if (next === EMPTY) continue; // dead stream: stop propagating (other streams may still be live)
      if (onPath.has(c.id)) continue; // cycle guard (the plan flags the cycle itself)
      walk(c.id, next, new Set(onPath).add(c.id));
    }
  };

  for (const node of nodesById.values()) {
    if (node.kind === 'effect' || node.kind === 'play') {
      walk(node.id, staticScope(node.scope, node.targetId), new Set([node.id]));
    }
  }

  // Emit in node order for a stable, deterministic issue list.
  const issues: RenderPlanIssue[] = [];
  for (const node of nodesById.values()) {
    if (reached.has(node.id) && !alive.has(node.id)) {
      issues.push({
        code: 'empty-scope',
        message: 'Effective scope is empty — this node’s scope can’t intersect the scope reaching it.',
        nodeId: node.id,
      });
    }
  }
  return issues;
}
