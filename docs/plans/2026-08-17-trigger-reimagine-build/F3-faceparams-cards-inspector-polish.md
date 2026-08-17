# F3 — #191 amendment: node-card face controls + inspector polish + subtype switchers

**Feedback wave (Trent, 2026-08-17 morning review of stack #194).** Amends PR #191 (S5 face
params). Worktree `/Users/trent/.twux/worktrees/faceparams`, branch `feat/face-params`
(synced to origin @ 4a497ff). Original brief: `S5-face-params.md`.

This slice deliberately owns ALL param-row-layout changes across the stack (ParamRow /
EffectParamsSection live on the parent branch feat/effect-inspector-disclosure, but editing
them there while S5 sits above would fork the seam — so those edits land HERE, as part of
#191's diff). Work through the checklist in order, committing in logical chunks.

## Node card (Trent verbatim, itemised)

1. "move the face buttons to the left of the effect label" — locate the face buttons relative
   to the effect label in the current UI (screenshot first) and move them to its left.
2. "Drop the blue dot next to the param label on the node card."
3. "move the modulation handle on the effect card closer to the border (it's slightly off it
   now)" — flush to the card border.
4. "add the sliders to the node cards" — face params on the card render with their slider
   affordance (as in the inspector), not value-only.
5. "remove the animated value" — the live-animating value readout on the card goes.
6. "allow scroll wheel on mouse over to control the value from the card" — wheel over a face
   param adjusts it (respect the param's step/range; prevent page scroll while captured).

## Inspector (Trent verbatim, itemised)

7. "where we are displaying a value and a unit, move the unit to a (i) hover tooltip over the
   param label so that the number input fields are all aligned." Use the design-system
   tooltip; every number input in a section left-aligns to the same column.
8. "When a slider is set to 0.60 (a number ending in 0) the 0 is rendered outside the input
   box - fix it." Reproduce first (likely input width driven by a trimmed numeric formatting),
   then fix for all formatted widths, not just this case.
9. Dropdown menus: max-height must not be shorter than **80% of the viewport height** — no
   scrolling a few-line overflow. Fix at the shared dropdown/select primitive level.
10. Dropdowns with **4 or fewer options become segmented button groups** (design-system
    segment control). Apply at the same shared level so it holds everywhere in the app; verify
    each affected site still reads well (screenshot the inspectors + settings).
11. **Subtype switchers:** in the Effect, Modifier, and Modulate node inspectors, add a
    switcher to change the node's subtype in place (companion to the flat Add-node menu that
    slice F2 builds on #188 — a node is added with a default subtype and re-typed here).
    Reuse the icons + colours from the add-effect overlay. Switching preserves whatever params
    sensibly carry over; verify how the store handles a type change (or add the store seam if
    none exists — test it).

## Scope fence

May touch: TriggerNode.svelte, FaceParamControl.svelte, FaceExposeButton.svelte, drag-number,
ParamRow.svelte, EffectParamsSection.svelte, Modifier/Modulation/Play inspectors, the shared
dropdown/select + tooltip + segmented-control primitives in `lib/ui`, store seams for subtype
switching, styleguide entries for everything changed + `pnpm design-system` regen, tests,
ui-shot presets. Non-goals: AddNodePopover / slideover shell (F2 on #188 owns those),
envelope/CurveField work (F4/F5), 'life'→'decay' renames (F5).

## Evidence & rules

- `pnpm typecheck` green; targeted vitest only — **NO full `pnpm test`** (orchestrator-only).
- UI verify every numbered item with ui-shot: own dev stack on **LEDRUMS_WEB_PORT=5283
  PORT=4383 LEDRUMS_WS_PORT=4383**, `UI_SHOT_BASE=http://localhost:5283`. Ports 5173/4321 are
  OCCUPIED (Trent's live preview) — never touch them; kill your own dev server by PID only.
- Commit on `feat/face-params`, push with:
  `git -c credential.helper= -c "credential.helper=!f() { echo username=twadams21; echo password=$(gh auth token -u twadams21); }; f" push`
  and verify with `git ls-remote origin feat/face-params`.
- Report ≤20 lines: per-item done/deferred with reason, evidence, pushed SHA.
