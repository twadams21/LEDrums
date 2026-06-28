# Component pass S3.5 — Core voice engine + compositor splits

PRD §S3.4. **PR mapping:** PRD finding (god-files in `packages/core`). Branch base `feat/unified-shell`
(worktree — read `_worktree-note.md`). **Blocked by:** none — independent worktree (core package boundary).
Split out from S3.4 so core and server are separate, parallel worktrees. **Keep `packages/core` PURE** (no
Node/DOM/IO; deterministic — eval stays a pure function of `RenderContext`, no new global state).

## What this delivers
The two largest core voice modules split behind their existing tests, with no behaviour change.

## Scope (`packages/core/src/voice/`)
- **`engine.ts` (760):** extract `eval-graph.ts` (evalNode / childrenOf / evalValueSwitch), `voice-pool.ts`
  (spawn / acquireSlot / release / findActiveVoice), `envelope-tick.ts`. `VoiceBusEngine` stays the public
  class (~420). Pure.
- **`compositor.ts` (388):** extract `pattern-renderer.ts` (sample loop + pixel masking) + `generator-bridge.ts`
  (hosted-generator setup). Pure.
- Preserve the public exports (`index.ts` / `voice/index.ts` surface) exactly — structure only.

## Tests
- `voice/engine.test.ts` (999) + `voice/compositor.test.ts` (238) stay green untouched — they are the
  contract. Re-point internal imports only; don't change assertions.

## Gate discipline
Per-package typecheck/test; full `pnpm typecheck && pnpm test`. **Verify `packages/core` imports nothing
from Node/DOM/IO** (the non-negotiable). Core test count must not drop.

## Acceptance
`voice/engine.ts` + `voice/compositor.ts` split into pure submodules; public surface intact; core stays
pure; all core tests green; full sweep green.

## Report back
Report to parent (orchestrator) with commit SHA, the module splits + sizes, confirmation core stayed pure,
gate totals, deviations. Leave ROUTER to the orchestrator.
