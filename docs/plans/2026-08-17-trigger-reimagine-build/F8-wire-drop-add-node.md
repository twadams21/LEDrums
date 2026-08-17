# F8 — #188 amendment: dropping a wire in empty space summons the Add-node menu, and the added node takes the wire

**Trent, 2026-08-17 (verbatim):** "when dragging to create a new wire, if its released in
empty space, show the add node menu. When a node is then clicked, wire it up to the wire that
would have been added on release."

Worktree `/Users/trent/.twux/worktrees/slideover`, branch `feat/inspector-slideover` (sync to
origin first: `git fetch origin && git merge --ff-only origin/feat/inspector-slideover`).
Context: `F2-slideover-in-canvas-flat-add-menu.md` (the flat popover this extends) and
`S3-inspector-slideover.md`.

## The interaction

1. A connection drag that ends on empty canvas (today: `onConnectEnd` with no landed handle
   and no node under the pointer — see the existing `dropConnect` path that already handles
   "released ON a node") opens the **Add-node popover at the release point**, holding the
   PENDING connection (source node + handle type).
2. Clicking a type adds that node at the release point (exactly as the popover already does)
   AND immediately creates the edge the drag was making: source handle → the new node's input
   (or, if the drag started from an input handle, new node's output → that input). Route the
   edge through the same store path a hand-made connection uses — same validation, one
   mutation path (mutation-parity), so an edge the graph would refuse by hand is refused here
   too.
3. **Filter the list to kinds that can accept the pending wire.** Reuse whatever
   `onBeforeConnect` / edge-pruning logic already defines validity — do not invent a second
   validity table. If only one family is valid (e.g. a modulation wire), the popover shows
   just those rows; if none, don't open the popover at all (the drag just cancels, as today).
4. Dismiss (Escape / click-away) = no node, no wire — identical to today's cancelled drag.
5. Keyboard/a11y and placement behave exactly like the existing popover (`popover-placement`
   bounds logic); drag-to-place rows may stay as they are — the pending-wire flow is
   click-only.

## Scope fence

May touch: `TriggerGraphView.svelte` (connect-end wiring, popover invocation state),
`AddNodePopover.svelte` (optional pending-wire mode: filtered list, onAdd carrying the
connection), the store seam that adds node+edge atomically (one undo entry for the pair —
verify how undo batches today and match it), tests for the new seam, styleguide entry note +
`pnpm design-system` regen if the popover's contract text changes, ui-shot preset for the
flow. Non-goals: inspector content, other views, edge rendering, F3's switcher surfaces.

## Evidence & rules

- `pnpm typecheck` green; targeted vitest only — **NO full `pnpm test`** (orchestrator-only).
- Test the seam: valid pending wire → node + edge in one undo step; invalid kind filtered
  out; dismiss leaves the graph untouched.
- UI verify with ui-shot: own dev stack on **LEDRUMS_WEB_PORT=5288 PORT=4388
  LEDRUMS_WS_PORT=4388**, `UI_SHOT_BASE=http://localhost:5288`. Ports 5173/4321 are OCCUPIED
  (Trent's live preview) — never touch them; kill your own dev server by PID only.
- Commit on `feat/inspector-slideover`, push with:
  `git -c credential.helper= -c "credential.helper=!f() { echo username=twadams21; echo password=$(gh auth token -u twadams21); }; f" push`
  and verify with `git ls-remote origin feat/inspector-slideover`. The orchestrator re-chains
  the stack above you — do NOT merge other branches.
- Report ≤15 lines via SendMessage to your parent: interaction as built, the validity-filter
  source, undo semantics, evidence, pushed SHA.
