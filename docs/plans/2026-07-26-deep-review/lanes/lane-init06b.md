# Lane: INIT-06 chunk 06B — eval cursor + NodeView + acceptance (S9–S14)

Read `lanes/COMMON.md` and the **Chunk 06B** section of `lanes/init06-chunks.md` —
both bind. Branch: `init/06b-nodeview` off `review/impl` (start at origin HEAD;
re-measure baseline at your starting HEAD, expect ~3320+). Steps from
`09-synthesis/INIT-06-graph-node-type-model.json`: S9→S10→S11→S12→S13→S14
(S14 LAST — it is the acceptance evidence).

06A landed (S1–S8): grammar policies single-sourced (HOOP_TARGET_POLICIES),
KIND_SIG Record dispatch total, MOD_SOURCE_KINDS satisfies-tied,
ModifierContext / (voice, FrameModCtx) param objects. Verify anchors against
the REAL tree — the plan predates INIT-01/02 and 06A itself.

- S9: EvalCursor replaces the 8-slot forwarded tuple in
  packages/core/src/voice/eval-graph.ts. Same transposition risk S7/S8 had —
  construct per call, verify field-by-field against base, no retention.
- S10: NodeView per-kind view union derived from GraphNode by Pick.
- S11: first consumer — the projection signature Record.
- S12: second consumer — nodeModSource dispatch Record in core.
- S13: align scope-lint.ts's private hoop parse with the post-A1 1-based
  grammar — the LAST hand-rolled grammar copy (06A's residue list confirms).
- S14: the measured kind-mutation probe across every dispatch site.
  BASELINE CAVEAT from 06A's probe: trigger-node-meta.ts's three
  Record<NodeKind,...> tables and SectionComposites.svelte's fourth ALREADY
  error at baseline — must NOT be claimed as this initiative's gain; measure
  the delta honestly.
- Inherited residue to fold in where it fits (small, in-fence-adjacent —
  escalate if either grows):
  · reviewer NB from 06A: OutputNodeInspector.svelte:32 and
    PlayNodeInspector.svelte:77 hand-build `${d.id}#${i + 1}` option values —
    route through core's format helper so "encoder spelled in exactly one
    module" becomes true; ask before widening if these files collide with
    lane-c (INIT-09 owns PlayNodeInspector in its plan list — CHECK with the
    orchestrator BEFORE touching it).
  · persistence.hoop-migration.test.ts:25's const named COMPOSITOR actually
    holds the RESOLVER policy flags — rename to tell the truth.
- packages/core purity rules bind. Gates green per committed step.
- Report: per-step shas, gates numbers, S14 probe results (before/after,
  honest delta), deviations.
