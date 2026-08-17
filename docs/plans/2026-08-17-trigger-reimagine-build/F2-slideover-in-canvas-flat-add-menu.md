# F2 — #188 amendment: inspector stays inside the canvas; Add-node = flat one-click list

**Feedback wave (Trent, 2026-08-17 morning review of stack #194).** Amends PR #188.
Worktree `/Users/trent/.twux/worktrees/slideover`, branch `feat/inspector-slideover` (synced
to origin @ db895d3). Original brief: `S3-inspector-slideover.md` — read it; the two changes
below OVERRIDE its decisions where they conflict.

## A. Inspector slideover: constrain to the canvas region

Trent (verbatim): "inspector as a right slideover over all chrome - move the popover to be
within the canvas. It is useful to be able to see the preview at the same time."

S3 deliberately painted the slideover above ALL chrome, overlapping the drum preview / bus /
layer docks. **Reversed:** the inspector overlay must be anchored to the right edge of the
GRAPH CANVAS region, not the window — the drum preview and docks stay fully visible (and
interactive) while it is open. Keep everything else from S3: overlay not push (canvas geometry
never changes), open on node select, content swaps in place on selection change, Escape /
canvas-background click dismisses, motion tokens, resizable width range.

Implementation note: this likely means the slideover moves back from the shell overlay layer
into the canvas container (position: absolute within the canvas wrapper, clipped to it). Keep
z-order above canvas content, below modals. Update the styleguide entry to match.

## B. Add-node popover: flat list of node types, one click adds

Trent (verbatim): "replace it with just the list of node types (Effect, All, Random, Sequence,
Switch, Chance, Toggle, Delay, Modifier, Mix, Scope, Modulate) … use the icons and colours in
the add effect overlay, and when you click on that node, it is added to the canvas straight
away, no second click."

- The popover shows exactly the flat list of node TYPES (the 12 above — verify the canonical
  list from the node registry; don't hardcode a drifting copy). No search-into-subtypes, no
  taxonomy browsing, no second click.
- Each row gets the icon + colour treatment from the existing add-effect overlay (reuse those
  assets/tokens, don't redraw).
- Click = the node lands on the canvas immediately at the invocation point, with a sensible
  default subtype for Effect / Modifier / Modulate (verify what the current default-on-add is
  and keep it). Subtype switching then happens in the node's inspector — that is slice F3's
  job on #191, NOT yours. Do not touch inspector content.

## Scope fence

May touch: the slideover component + its mount point, `AddNodePopover.svelte` +
`popover-placement.ts`, canvas container wiring, add-node default-type plumbing, styleguide
entries for both, tests, ui-shot presets. Non-goals: inspector CONTENT (S4/S5 files:
EffectParamsSection, ParamRow, FaceParamControl, Modifier/Modulation inspectors), other views.

## Evidence & rules

- `pnpm typecheck` green; targeted vitest only — **NO full `pnpm test`** (orchestrator-only).
- UI verify: own dev stack on **LEDRUMS_WEB_PORT=5282 PORT=4382 LEDRUMS_WS_PORT=4382**,
  ui-shot with `UI_SHOT_BASE=http://localhost:5282`. Ports 5173/4321 are OCCUPIED (Trent's
  live preview) — never touch them; kill your own dev server by PID only.
- Commit on `feat/inspector-slideover`, push with:
  `git -c credential.helper= -c "credential.helper=!f() { echo username=twadams21; echo password=$(gh auth token -u twadams21); }; f" push`
  and verify with `git ls-remote origin feat/inspector-slideover`.
- Report ≤15 lines: what changed, evidence, pushed SHA.
