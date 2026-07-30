# INIT-06 graph-node-type-model — chunked dispatch plan (/slicing-work shape)

One initiative, two STRICTLY SEQUENTIAL chunk dispatches — nearly every step
touches core's node-dispatch seam (node-kind grammar, signature/dispatch
records, eval path), so no parallelism. Fresh agent + cross-model review gate +
orchestrator merge per chunk. Plan of record:
`09-synthesis/INIT-06-graph-node-type-model.json` (opus risk-first strangler —
the only variant both reviewers rated sound; sonnet's shadow-type-then-flip was
ruled UNSOUND, do not drift toward it). `11-decisions.md` overrides plan text.

The plan's internal waves ([S1,S2,S3] · [S4,S7,S10,S13] · [S5,S6,S8] ·
[S9,S11,S12] · [S14]) are DEPENDENCY tiers, not parallel dispatch lanes — a
single agent works them in step order within its chunk.

## Chunk 06A — live bug + grammar + dispatch records (S1–S8)

S1 first and red-first (the dead 'effect' arm in triggerNodeSignature is a live
bug: failing test before fix). Then hoop-target grammar policies (S2), core
fixture eviction (S3, pre-flight first), MOD_SOURCE_KINDS tied to NodeKind via
satisfies + narrowing predicate (S4), delete web's hand-spelled mod-source
enumerations (S5), switch → Record<NodeKind, SigFn> with no default arm (S6),
and the two positional-param collapses: applyModifierChain → ModifierContext
(S7), applyEffectiveParams → (voice, FrameModCtx) (S8). Resting state: dispatch
is Record-driven, grammar named, params objects; suite green.

## Chunk 06B — eval cursor + NodeView + acceptance (S9–S14)

EvalCursor replaces the 8-slot forwarded tuple (S9), NodeView per-kind view
union via Pick (S10) + its two consumers (S11 projection signatures, S12
nodeModSource dispatch), scope-lint's private hoop parse aligned with the
post-A1 1-based grammar (S13), then S14 LAST: the measured kind-mutation probe
across every dispatch site — acceptance evidence, not vibes.

## Every chunk

`lanes/COMMON.md` binds. Re-measure baseline at starting HEAD. packages/core
stays pure (no Node/DOM/IO imports; test-support stays vitest-free). Verify
every plan anchor against the real tree — INIT-01/02 and the light track have
moved files since the plan was written (engine/ → render/, store decomposed).
Review gate per chunk, reviewer model ≠ implementer.
