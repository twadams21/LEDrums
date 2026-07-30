# Lane: INIT-06 chunk 06A — live bug + grammar + dispatch records (S1–S8)

Read `lanes/COMMON.md` and the **Chunk 06A** section of `lanes/init06-chunks.md` —
both bind. Branch: `init/06a-dispatch` off `review/impl` (start at origin HEAD;
re-measure baseline at your starting HEAD, expect ~3265).
Steps from `09-synthesis/INIT-06-graph-node-type-model.json`: S1–S8 in step
order (the plan's waves are dependency tiers, not parallel lanes).

ANCHOR WARNING: the plan predates INIT-01/02 and the light track — core's
engine/ is now render/, the web store is decomposed into five public
controllers, and test helpers live in test-support/. Verify every file/symbol
anchor against the real tree before editing; report count corrections.

- S1 FIRST and RED-FIRST: the dead 'effect' arm in triggerNodeSignature is a
  live bug — write the failing test, watch it fail, then fix. This is the
  chunk's tracer.
- S2: hoop-target grammar — three named parse policies + one format helper.
- S3: evict modulation-parity fixtures from core's shipped surface; PRE-FLIGHT
  first per plan text. packages/core purity rules bind (no Node/DOM/IO;
  test-support stays vitest-free).
- S4: MOD_SOURCE_KINDS tied to NodeKind via `satisfies` + a narrowing
  predicate.
- S5: delete the web's hand-spelled mod-source enumerations (the plan's
  corrected scope — re-verify the consumer set with svelte-check, not grep).
- S6: triggerNodeSignature switch → Record<NodeKind, SigFn>, NO default arm —
  a missing kind must be a compile error, not a runtime fallback.
- S7: applyModifierChain 8 positional params → ModifierContext, constructed
  per call.
- S8: applyEffectiveParams 6 positional params → (voice, FrameModCtx).
- Gates green per committed step (foreground, `pnpm gates`). Rename-normalised
  diff gates where retargeting tests (scripts/rename-gate.sh exists — reuse).
- Report: per-step shas, gates numbers, measured vs plan counts, deviations.
