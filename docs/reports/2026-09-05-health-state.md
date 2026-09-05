# P01 + P10 — document state health

Branch: `fix/health-document-state`. Scope/decisions: user dispatch, 2026-09-05. Clear Undo on replacement, document-ID guard, 32 MiB estimated history budget with a 10,000-entry ceiling. No sim/render/core edits, release operations, global context or design artifact changes. Integrated ui-shot belongs to the orchestrator.

## P01 evidence

`pnpm install --frozen-lockfile` passed (lockfile unchanged).

Targeted red: `cd apps/web && pnpm exec vitest run src/lib/trigger-lab/store.document-state.test.ts` — **9 failed** against the original implementation: every transition permitted old Undo, including same-ID server adoption, plus direct identity mismatch.

After repair: document-state + shows + server-library tests — **41 passed**. Web-only `pnpm --filter @ledrums/web typecheck` passed (0 errors, 0 warnings). Added connected equal-content Save As → setShow/recall/transport coverage, position-only edit suppression, and history/runtime preservation for save/rename/inactive delete/no-op open. The replacement test matrix exercises New, Open, Save As, delete-active, delete-last, Close, server cold adoption and viewer follow. Each arms a looping voice, pending delay, advanced sequence, live input tables and an unfinished edit gesture. After replacement there is no old Undo, no delayed/looping voice after 500 ms, sequence restarts at step 1, input tables empty, new buses are bound by identity, and new edits can Undo normally.

| Before | After |
| --- | --- |
| `shows-controller.svelte.ts`: New, Save As and delete-last bypassed the show-load hook. | All replacements pass through `activateDocument` → store `replaceDocument`; ordinary saves/renames/inactive deletion retain their lifetime. |
| `store.svelte.ts`: show-load only cleared delays; voices, sequence/PRNG/latches and registries survived. | Instantiate existing `Sim` with current resolved registries, buses, model and tempo; clear transient editor targets, learn arms, gesture suppression and visible local runtime state. No Sim contract change required. |
| Undo had no document identity and survived replacement. | Clear on replacement (including same-ID server adoption), additionally reject a foreign document ID at replay. |
| Equal-content Save As could be signature-suppressed by connected playback. | Replacement invalidates engine sync baseline and sends the replacement/recall and transport through existing interfaces. |

Visual design preserved: no markup, styles, tokens or components changed. Reviewed existing `SaveIndicator.svelte` against make-interfaces-feel-better and Impeccable product guidance: fixed-width status slot, interruptible crossfade and reduced-motion contract remain unchanged. The requested local `.agents/skills/impeccable` path was absent; loaded the existing sibling checkout's `.claude/skills/impeccable` and ran its context resolver against this worktree. `PRODUCT.md` exists; `DESIGN.md` does not.

## P10

Implementation and measurements pending in the next logical commit.
