# Task: Implement GitHub issue #134 — Polish reconnect-edge handle appearance + hover states

Run `gh issue view 134 -R twadams21/LEDrums` and treat its body as the spec. It names the exact files, the xyflow portal constraint, the known rough edges, and the contracts.

## Key constraints (from the issue + locked contracts)

- **No motion/transitions on graph interactions** — instant hover only. This is a locked contract; do not add animations, lifts, or transitions.
- The reconnect anchor renders in xyflow's `edge-labels` portal, NOT inside `.svelte-flow__edge` — CSS can't key off edge hover. If you want reveal-on-wire-hover (recommended direction), push hover state down from the edge component as a prop/context.
- Files: `apps/web/src/lib/app/views/WireEdge.svelte` (anchor markup), `apps/web/src/lib/app/views/GraphCanvas.svelte` (`.reconnect-dot` / `.svelte-flow__edgeupdater` rules ~L275-300).
- Use design-system tokens. If anything reusable emerges, extend the styleguide (`apps/web/src/lib/styleguide/`) and regenerate `docs/design-system.html` (`pnpm design-system`) in the same change.
- Apply the `/make-interfaces-feel-better` skill for the polish pass.

## Rough edges to resolve (from the issue)

Always-on dots = visual noise; 8px dot vs 25px hit-box mismatch; no wire-side hover confirmation; unstyled `:active`/mid-drag state; source/target ends indistinguishable.

## Gates

- `pnpm typecheck` and `pnpm test` green on committed HEAD.
- `pnpm ui-shot` captures of BOTH the Patch and Trigger graphs showing rest / hover / dragging states. **Pin `UI_SHOT_BASE` to your worktree's dev server using `$TWUX_DEV_PORT`** — ui-shot defaults to probing :5173 which may be a sibling's server.
- Branch `polish/reconnect-handles-134`, push, open a PR referencing #134. Done = committed-HEAD green AND pushed.

Report back to your parent per the implementer manual, including the PR URL and the ui-shot capture paths.
