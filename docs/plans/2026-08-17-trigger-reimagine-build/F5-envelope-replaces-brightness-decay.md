# F5 — #192 amendment: the envelope replaces Brightness & Decay/Life; decay + max-brightness sliders; 'life'→'decay'

**Feedback wave (Trent, 2026-08-17 morning review of stack #194).** Amends PR #192 (S6b).
Worktree `/Users/trent/.twux/worktrees/lifenv`, branch `feat/life-envelope`.
**Runs AFTER F4** (notched log↔lin↔exp strength slider on feat/envelope-control) — first step:
`git fetch origin && git merge origin/feat/envelope-control` to pick up the amended primitive,
then read F4's report (the orchestrator passes it to you) for where the "curves do nothing"
wire was broken. Original brief: `S6b-envelope-life-decay.md`.

## Trent's verdict (condensed from verbatim)

> This whole graph / envelope approach should replace the Brightness and Decay/Life params
> entirely. I think it replaces 100% of their use cases. Life/decay is on the x axis,
> brightness is on the y axis. … Remove the toggle as well to go between sliders and
> envelope, just use envelope always. And since we have a decay slider, add a max brightness
> slider so the top of the y axis is 100% max brightness, and it gets reduced behind the
> scenes as the max brightness is reduced. … Add an overall slider for decay time. …
> the preview was still fading out what appeared to be linearly. … Replace all occurances
> of 'life' with decay.

## What to do

1. **Envelope always on.** Remove the sliders↔envelope toggle; the envelope editor is the one
   and only control. Remove the separate Brightness and Decay/Life param sliders wherever the
   envelope now covers them — the envelope IS those params (x axis = decay time, y axis =
   brightness). Core/engine changes are in scope ("go all the way" — standing decision).
   Check every mutation path that used the removed params (mutation-parity): presets,
   persistence/schema, protocol defaults, velocity-sensitivity (S8 stacks above you — don't
   edit its files, but don't strand it either; note in your report what it must adapt to).
2. **Overall Decay-time slider**: scales the envelope's x axis (total fade duration).
3. **Max-brightness slider**: the y axis always reads 100% at the top; the actual output is
   scaled by max-brightness behind the scenes (editor shape is normalised, output = shape ×
   max).
4. **Fix the linear-fade preview bug** on this branch's side: the preview/sim must sample the
   envelope through the curve transform (F4 fixed or located the primitive side; you own
   life-envelope.ts, sim.life-envelope, EnvelopeEditorView wiring).
5. **'life' → 'decay' in every user-facing string** on this stack: labels, tooltips, section
   headers, styleguide copy, ui-shot preset names if user-visible. Do NOT rename code
   identifiers/modules (voice-life etc. stay — S7 param-key normalisation owns code renames);
   schema/protocol keys only if they are brand-new on this branch (nothing shipped depends on
   them — greenfield rule), otherwise leave keys and note it.

## Scope fence

May touch: this branch's envelope/voice-life files (web trigger-lab life-envelope, sim,
EnvelopeEditorView, store), packages/core voice-life / envelope-tick / voice-pool seams it
already touches, protocol schema fields this branch introduced, inspector wiring for the two
new sliders, styleguide + `pnpm design-system` regen, tests, ui-shot presets. Non-goals:
CurveField primitive internals (F4 owns), S8 files (feat/velocity-sensitivity), ParamRow
layout (F3 owns).

## Evidence & rules

- `pnpm typecheck` green; targeted vitest only — **NO full `pnpm test`** (orchestrator-only).
- Tests: envelope-through-curve sampling is nonlinear for exp/log/s-curve; max-brightness
  scales output not editor shape; removed-param mutation paths covered.
- UI verify with ui-shot: own dev stack on **LEDRUMS_WEB_PORT=5285 PORT=4385
  LEDRUMS_WS_PORT=4385**, `UI_SHOT_BASE=http://localhost:5285`. Ports 5173/4321 are OCCUPIED
  (Trent's live preview) — never touch them; kill your own dev server by PID only.
- Commit on `feat/life-envelope`, push with:
  `git -c credential.helper= -c "credential.helper=!f() { echo username=twadams21; echo password=$(gh auth token -u twadams21); }; f" push`
  and verify with `git ls-remote origin feat/life-envelope`.
- Report ≤20 lines: what replaced what, S8 adaptation notes, preview-bug root cause, evidence,
  pushed SHA.
