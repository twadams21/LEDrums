/**
 * D1 chain-wiring rules — the ONE definition of "is this Output→Hoop / Hoop→Hoop wire legal?",
 * pure + platform-agnostic so the web patch editor's connect-time guard and any server-side
 * edge validation enforce the SAME structural invariants (mutation-parity by construction).
 *
 * The patch graph is a set of linear daisy-chains, each rooted at an Output:
 *   `Output → Hoop → Hoop → …`. The invariants a single wire must never break:
 *   - **Output → at most one Hoop.** An output starts exactly one run.
 *   - **Hoop → at most one upstream** (an Output OR one Hoop) — no fan-in.
 *   - **Hoop → at most one downstream Hoop** — no fan-out.
 *   - **No cycles.** Following upstream links always terminates (at an Output, or an orphan
 *     hoop that is simply not yet rooted — a completeness *warning*, not a wiring error).
 *
 * These are the HARD, per-edge rejections surfaced to the user as they draw. Coverage /
 * orphan-rooting ("every hoop reaches an Output") is a whole-graph *completeness* concern
 * (B1's `hoop-uncovered` warning / {@link checkRoutingIntegrity}), NOT a per-wire reject —
 * a half-wired graph must still be drawable and persistable, so this module deliberately
 * allows an as-yet-unrooted hoop→hoop pair (it just shows as uncovered until rooted).
 */

/** One hoop of a drum, **1-based** (A1). The atomic node of a wire chain. Owned here so the
 *  web patch bridge and the core rules share one definition. */
export interface HoopRef {
  drumId: string;
  /** 1-based hoop index within its drum. */
  hoop: number;
}

/** The SOURCE end of a wire: an Output node, or a Hoop node (the two legal source kinds). */
export type ChainSource =
  | { kind: 'output'; outputId: string }
  | { kind: 'hoop'; ref: HoopRef };

/** One directed wire in the chain graph: a legal `Output → Hoop` or `Hoop → Hoop` link. */
export interface ChainEdge {
  from: ChainSource;
  /** The DOWNSTREAM end is always a hoop (nothing wires INTO an output). */
  to: HoopRef;
}

/** Why a prospective wire was rejected — a stable code (for logic) + a user-facing message. */
export type ChainRejectionCode =
  | 'self'
  | 'output-already-wired'
  | 'hoop-has-upstream'
  | 'source-has-downstream'
  | 'cycle';

/** Verdict for a prospective wire: legal, or rejected with a reason. */
export type ChainConnectionVerdict =
  | { ok: true }
  | { ok: false; code: ChainRejectionCode; message: string };

/** Canonical, collision-free key for a hoop node. */
export function hoopKey(ref: HoopRef): string {
  return `hoop:${ref.drumId}:${ref.hoop}`;
}

/** Canonical, collision-free key for a wire SOURCE (output or hoop). */
export function sourceKey(from: ChainSource): string {
  return from.kind === 'output' ? `output:${from.outputId}` : hoopKey(from.ref);
}

/**
 * Decide whether adding `candidate` to the existing `edges` keeps the chain graph legal.
 * Pure — builds the upstream/downstream adjacency from `edges` and checks the candidate
 * against the four invariants above. `edges` may include not-yet-rooted hoop→hoop pairs
 * (they are honoured for fan-in/fan-out/cycle detection); rooting is a separate completeness
 * concern. Returns the FIRST violation (stable order below) or `{ ok: true }`.
 */
export function classifyChainConnection(edges: ChainEdge[], candidate: ChainEdge): ChainConnectionVerdict {
  const toKey = hoopKey(candidate.to);
  const fromKey = sourceKey(candidate.from);

  // A hoop cannot wire to itself.
  if (candidate.from.kind === 'hoop' && hoopKey(candidate.from.ref) === toKey) {
    return { ok: false, code: 'self', message: 'A hoop cannot wire to itself.' };
  }

  // upstreamOf: target-hoop key → its single source key.  downstreamOf: source key → its single target-hoop key.
  const upstreamOf = new Map<string, string>();
  const downstreamOf = new Map<string, string>();
  for (const e of edges) {
    const eTo = hoopKey(e.to);
    const eFrom = sourceKey(e.from);
    if (!upstreamOf.has(eTo)) upstreamOf.set(eTo, eFrom);
    if (!downstreamOf.has(eFrom)) downstreamOf.set(eFrom, eTo);
  }

  // The target hoop already has an upstream → fan-in.
  if (upstreamOf.has(toKey)) {
    return {
      ok: false,
      code: 'hoop-has-upstream',
      message: `Hoop ${candidate.to.hoop} of "${candidate.to.drumId}" already has an upstream connection.`,
    };
  }

  // The source already drives a hoop → an output can only start one run; a hoop can only chain onward once.
  if (downstreamOf.has(fromKey)) {
    return candidate.from.kind === 'output'
      ? {
          ok: false,
          code: 'output-already-wired',
          message: `Output "${candidate.from.outputId}" already starts a run — remove its wire first.`,
        }
      : {
          ok: false,
          code: 'source-has-downstream',
          message: `Hoop ${candidate.from.ref.hoop} of "${candidate.from.ref.drumId}" already has a downstream hoop.`,
        };
  }

  // Cycle: walking upstream from the source must never reach the target.
  if (candidate.from.kind === 'hoop') {
    const seen = new Set<string>();
    let cursor: string | undefined = fromKey;
    while (cursor !== undefined) {
      if (cursor === toKey) {
        return { ok: false, code: 'cycle', message: 'That wire would create a loop in the chain.' };
      }
      if (seen.has(cursor)) break; // pre-existing cycle in `edges` — don't spin (and don't blame the candidate)
      seen.add(cursor);
      cursor = upstreamOf.get(cursor);
    }
  }

  return { ok: true };
}
