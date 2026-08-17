# F6 — #193 chaining: merge the amended envelope stack into S8 and adapt it to the new curve model

**Feedback wave (Trent, 2026-08-17).** Chains PR #193 onto its amended parents. Worktree
`/Users/trent/.twux/worktrees/velsens-f6`, branch `feat/velocity-sensitivity` @ a08964f (deps
installed). Context briefs: `F4-curvefield-log-notched-strength.md`,
`F5-envelope-replaces-brightness-decay.md` (read both — they define the model you are
adopting), original `S8-velocity-sensitivity.md`.

## The task

1. `git fetch origin && git merge origin/feat/life-envelope` (947a9c8 — carries F4's 6ef4284).
   Two known conflicts:
   - **`packages/core/src/curve/curve.ts` (modify/delete):** S8 moved+rewrote the curve module
     as `packages/core/src/model/curve.ts` ("one core curve module", a08964f); F5 amended the
     old path. Resolution: **keep S8's location**, port F4/F5's semantics onto it —
     `CurveProfile = 'bend' | 'sCurve' | 'snap'` (no 'linear'/'exp'), bipolar strength −1..+1
     with `clampBipolar`, exponent = `base^strength` (bend 8, sCurve 5, so ±s are exact
     inverse shapes and 0 is straight by arithmetic), `CURVE_PROFILE_OPTIONS`, `DEFAULT_CURVE
     profile:'bend'`, `curveValueSchema` = `z.enum(['bend','sCurve','snap'])` + strength
     `min(-1).max(1)`. Delete the stray `curve/curve.ts` so ONE module remains; every import
     across the tree resolves to the canonical path. Diff your port against
     `origin/feat/life-envelope:packages/core/src/curve/curve.ts` to prove nothing was lost.
   - **`docs/design-system.html`:** resolve either way, then regenerate with
     `pnpm design-system` after everything compiles.
2. **Adapt S8's own feature code** (the per-drum velocity sensitivity curve): every
   'linear'/'exp' profile reference, unipolar strength assumption, seed/default, and test
   moves to the new model (0 = exactly linear; −s = the inverse bend). The view-side mode
   label is derived via the helpers F4 added (`curveModeLabel` etc. in
   `apps/web/src/lib/ui/curve-field.ts`) — reuse, don't duplicate.
3. `RenderContext.authoredDecay` (F5) is additive and inert for S8 — adopt, don't fight it.
4. Sanity-check the merged whole: the decay envelope block (F5) and the velocity curve (S8)
   both render, both bend nonlinearly when driven off centre.

## Scope fence

May touch: merge resolutions anywhere the merge conflicts, `packages/core/src/model/curve.ts`
(the port), S8's velocity-sensitivity files and tests, imports of the curve module across the
tree, `docs/design-system.html` regen, ui-shot presets for the velocity curve. Non-goals:
re-designing anything F4/F5 decided; ParamRow layout (F3 owns); new features.

## Evidence & rules

- `pnpm typecheck` green; targeted vitest only (core curve/model tests, velocity-sensitivity
  tests, sim/life-envelope tests) — **NO full `pnpm test`** (orchestrator-only rule).
- UI verify with ui-shot: own dev stack on **LEDRUMS_WEB_PORT=5286 PORT=4386
  LEDRUMS_WS_PORT=4386**, `UI_SHOT_BASE=http://localhost:5286`. Ports 5173/4321 are OCCUPIED
  (Trent's live preview) — never touch them; kill your own dev server by PID only.
- Commit on `feat/velocity-sensitivity`, push with:
  `git -c credential.helper= -c "credential.helper=!f() { echo username=twadams21; echo password=$(gh auth token -u twadams21); }; f" push`
  and verify with `git ls-remote origin feat/velocity-sensitivity`.
- Report ≤15 lines via SendMessage to your parent: merge resolution summary, what S8 code
  adapted, evidence, pushed SHA.
