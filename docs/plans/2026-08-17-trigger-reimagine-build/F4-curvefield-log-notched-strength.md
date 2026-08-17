# F4 — #189 amendment: notched strength slider (log↔lin↔exp), over-centre s-curve, curves must actually curve

**Feedback wave (Trent, 2026-08-17 morning review of stack #194).** Amends PR #189 (S6a
CurveField primitive). Worktree `/Users/trent/.twux/worktrees/envctl`, branch
`feat/envelope-control` (synced to origin @ a27efa0). Original brief:
`S6a-envelope-primitive.md`. Slice F5 (on #192, S6b) builds on your output — keep the
primitive's public surface coherent and report any S6b-side breakage you find rather than
fixing files owned by feat/life-envelope.

## Trent's verdict (condensed from verbatim)

> Add a new Log mode (inverse of exp mode). Alternatively, the 'strength' slider could be
> notched in the middle (linear) and above is exp, below is log. The mode should be synced
> with this slider. S-curve and snap are the special cases. S-curve allow to go 'over centre'
> and invert the curve. Exp, s curve, and snap didn't appear to be doing anything in the
> preview either — the preview was still fading out what appeared to be linearly.

He elaborated the second option and tied mode to the slider — implement the **notched
slider** design:

1. **Strength slider becomes bidirectional with a centre notch.** Centre = linear. Pushing
   above centre = exponential, increasingly strong; below centre = logarithmic (the inverse
   shape), increasingly strong. The mode readout (lin/exp/log) is DERIVED from / synced with
   the slider position — lin/exp/log stop being independent buttons and become one continuum.
   Snap the notch (small magnetic zone at centre) so linear is easy to hit.
2. **S-curve and Snap stay as distinct special-case modes.** In S-curve mode the strength
   slider goes **over centre to invert** the curve (ease-in-out ↔ ease-out-in).
3. **Diagnose the "curves do nothing" report.** In the preview, exp/s-curve/snap all faded
   linearly. Find where the curve transform should apply (CurveField output → curve model →
   preview/sim sampling) and fix what is owned by THIS branch (CurveField.svelte,
   curve-field.ts, packages/core curve model). If the break is in S6b's wiring
   (feat/life-envelope files: life-envelope.ts, sim, EnvelopeEditorView), do NOT fix it there
   — state precisely in your report where the wire is broken so F5 picks it up.

## Scope fence

May touch: `apps/web/src/lib/ui/CurveField.svelte`, `curve-field.ts`, packages/core curve
model (`model/curve.ts` and its tests), styleguide `SectionPrimitives.svelte` entry, tests.
Non-goals: files created by feat/life-envelope (S6b) or feat/velocity-sensitivity (S8);
Brightness/Decay param removal (that's F5).

## Evidence & rules

- `pnpm typecheck` green; targeted vitest only — **NO full `pnpm test`** (orchestrator-only).
- Unit-test the curve math: for a fixed strength above/below centre, sampled outputs must
  differ from linear in the expected direction; s-curve inversion crosses over centre.
- UI verify: own dev stack on **LEDRUMS_WEB_PORT=5284 PORT=4384 LEDRUMS_WS_PORT=4384**,
  ui-shot with `UI_SHOT_BASE=http://localhost:5284`. Ports 5173/4321 are OCCUPIED (Trent's
  live preview) — never touch them; kill your own dev server by PID only.
- Commit on `feat/envelope-control`, push with:
  `git -c credential.helper= -c "credential.helper=!f() { echo username=twadams21; echo password=$(gh auth token -u twadams21); }; f" push`
  and verify with `git ls-remote origin feat/envelope-control`.
- Report ≤15 lines: design as built, curve-bug root cause (and whether it lives in S6b),
  evidence, pushed SHA.
