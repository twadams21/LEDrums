/* Graph lint presentation — turns the render-plan compiler's issues into the short,
   plain, act-on-it copy the lint strip renders (R05, GH #84).

   This is presentation only: it consumes `compileRenderPlan().issues` (the single
   render-plan linter) and never re-derives what is wrong — it just states the problem
   in author's language and names the next step. Each compiler code owns one problem
   headline and one next-step; the compiler's own `message` carries the specific detail
   (e.g. the offending cycle path), shown verbatim beneath the headline when present.

   Pure + framework-free so the strip's copy is unit-testable without a DOM. */

import { voice } from '@ledrums/core';

export interface LintEntry {
  code: voice.RenderPlanIssueCode;
  /** Short, plain statement of what is wrong. */
  problem: string;
  /** The next step that clears it. */
  action: string;
  /** The compiler's specific detail (cycle path, …) when it adds something the headline can't. */
  detail?: string;
  /** The node the issue points at, when the compiler named one. */
  nodeId?: string;
}

/** Author-facing problem headline per compiler code — short and plain, no engine jargon. */
const PROBLEM: Record<voice.RenderPlanIssueCode, string> = {
  'missing-trigger': 'No trigger source',
  'missing-output': 'No output',
  'flow-cycle': 'Wires form a loop',
  'empty-scope': 'Scope never matches',
  'no-path-to-output': 'Not reaching Output',
  'dead-branch': 'No layer to render',
};

/** The next step that clears each issue — imperative, one action. */
const ACTION: Record<voice.RenderPlanIssueCode, string> = {
  'missing-trigger': 'Add a trigger source so something can fire this graph.',
  'missing-output': 'Add an Output node and wire your render chain into it.',
  'flow-cycle': 'Remove one wire in the loop so the flow runs start to finish.',
  'empty-scope': 'Widen this scope or the one upstream — they don’t overlap, so nothing here lights.',
  'no-path-to-output': 'Wire this into the Output node so what it renders can light.',
  'dead-branch': 'Wire an Effect or Play into this branch so it has a layer to render.',
};

/** The compiler prefixes cycle detail with this — a dev-facing lead-in the strip drops so the
    author sees just the path. Other codes carry no useful detail (the headline already says it). */
const CYCLE_PREFIX = 'Flow cycle rejected: ';

/** The compiler's message, reduced to the detail the headline doesn't already carry — or
    undefined when the message is just a restatement of the problem. */
function detailOf(issue: voice.RenderPlanIssue): string | undefined {
  if (issue.code === 'flow-cycle') {
    const path = issue.message.startsWith(CYCLE_PREFIX) ? issue.message.slice(CYCLE_PREFIX.length) : issue.message;
    return path.replace(/\.$/, '') || undefined;
  }
  return undefined;
}

/** Map render-plan compile issues to the strip's display entries, preserving order. */
export function lintEntries(issues: readonly voice.RenderPlanIssue[]): LintEntry[] {
  return issues.map((issue) => ({
    code: issue.code,
    problem: PROBLEM[issue.code],
    action: ACTION[issue.code],
    detail: detailOf(issue),
    nodeId: issue.nodeId,
  }));
}

/** Group the anchored findings by their node so the canvas can badge each offending node with
    the SAME entries the strip renders (strip ↔ badge agree — one lint model, two surfaces).
    Findings without a `nodeId` (missing-trigger / missing-output) live only on the strip. */
export function lintEntriesByNode(entries: readonly LintEntry[]): Map<string, LintEntry[]> {
  const byNode = new Map<string, LintEntry[]>();
  for (const entry of entries) {
    if (!entry.nodeId) continue;
    const list = byNode.get(entry.nodeId);
    if (list) list.push(entry);
    else byNode.set(entry.nodeId, [entry]);
  }
  return byNode;
}
