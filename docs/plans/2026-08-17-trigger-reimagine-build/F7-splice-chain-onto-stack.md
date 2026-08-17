# F7 — chain Tim's Splice node (PR #184) onto the amended stack as its new top

**Trent, 2026-08-17: "the last one to add into the stack is Tim's Splice node."** Worktree
`/Users/trent/.twux/worktrees/splice`, branch `feat/splice-node` @ d8995b0 (deps installed) —
this is **Tim Coghill's work**, freshly rebased by him onto main plus three commits from
today; treat his design decisions as settled and adapt them to the stack's surfaces, never
redesign them. He may push again while you work — the orchestrator handles re-chaining;
don't fetch/rebase mid-task.

Context you must read first (the surfaces Splice predates):
- `F2-slideover-in-canvas-flat-add-menu.md` — the flat one-click Add-node list replaced the
  old Add tab / `buildAddGroups` palette Splice registered into.
- `F3-faceparams-cards-inspector-polish.md` — ParamRow layout (face button leads, unit on the
  label tooltip), Select shape rule (≤4 options = segments), subtype switchers.
- `F4-curvefield-log-notched-strength.md` + `F5-envelope-replaces-brightness-decay.md` — ONE
  core curve module `packages/core/src/model/curve.ts`, `profile: 'bend'|'sCurve'|'snap'`,
  bipolar strength; envelope-authoritative decay via `RenderContext.authoredDecay`.

## The task

1. `git merge origin/feat/velocity-sensitivity` (8f75e32 — the chained stack top carrying
   F1–F6). Resolve conflicts adapting SPLICE to the STACK, not the reverse. Known collision
   areas: the add-node path (Splice registered against the deleted `AddPalette`/taxonomy
   groups — re-register it as a row in `ADD_NODE_TYPES` with its icon/tint from
   `trigger-node-meta`; put it beside Scope, and flag placement as a taste call in your
   report), inspector mounting (the old right-column editor became the in-canvas slideover —
   Splice's inspector should render through `Inspector.svelte` like every node), store/sim
   node plumbing, `docs/design-system.html` (resolve either way, regenerate at the end).
2. **Adapt Splice's code to the wave's models** wherever the merge doesn't force it but the
   conventions do: any `'linear'`/`'exp'` curve literals → `'bend'` + signed strength against
   `model/curve.ts`; if Splice's per-unit envelope interacts with voice decay, respect
   `authoredDecay` semantics (read `packages/core/src/effects/life-fade.ts`'s header — if
   Splice's envelope is per-ELEMENT shaping, the four-effects precedent says leave it; say
   which way it falls in your report). Inspector rows should use the shared
   `ParamRow`/`ParamLabel`; Selects follow the ≤4-segments rule automatically — verify his
   panes still read well (screenshot).
3. 'life' → 'decay' in any user-facing strings Splice adds.
4. Verify the merged whole in the browser: add a Splice from the flat menu (one click), its
   inspector opens in the slideover, a splice cascades on the preview, and the S8 velocity
   curve + F5 decay envelope still render.

## Scope fence

May touch: merge resolutions anywhere the merge conflicts, Splice's own files (core
voice/splice, its UI), the add-node registration surfaces, styleguide entry for anything
Splice shows there + `pnpm design-system` regen, ui-shot presets (his splice presets exist —
keep them working). Non-goals: redesigning Splice behaviour, any F1–F6 surface beyond what
the merge touches, other views.

## Evidence & rules

- `pnpm typecheck` green; targeted vitest only (splice tests, voice-pool, store/views suites
  you touch) — **NO full `pnpm test`** (orchestrator-only rule).
- ui-shot: own dev stack on **LEDRUMS_WEB_PORT=5287 PORT=4387 LEDRUMS_WS_PORT=4387**,
  `UI_SHOT_BASE=http://localhost:5287`. Ports 5173/4321 are OCCUPIED (Trent's live preview)
  — never touch them; kill your own dev server by PID only.
- Commit on `feat/splice-node`. **Push to Tim's fork** (maintainerCanModify is on):
  `git -c credential.helper= -c "credential.helper=!f() { echo username=twadams21; echo password=$(gh auth token -u twadams21); }; f" push https://github.com/timcoghill-boop/LEDrums.git HEAD:feat/splice-node`
  then verify with `git ls-remote https://github.com/timcoghill-boop/LEDrums.git feat/splice-node`.
- Report ≤15 lines via SendMessage to your parent: conflicts resolved, adaptations, the
  add-menu placement call, the envelope/authoredDecay call, evidence, pushed SHA.
