# Placeholder: migrate legacy design-token aliases

This draft PR is a branch-sized work item for the next implementation agent. Replace or remove this placeholder once real code lands.

## Scope

`.mex/ROUTER.md` notes that existing panels still use legacy token aliases. Migrate view-by-view to the canonical token names, then remove aliases once no call sites remain.

## Suggested approach

- Inventory current alias usage.
- Pick one view/panel family per commit.
- Preserve visual output while changing token names.
- Remove aliases only after all usage is gone.

## Suggested checks

- `pnpm typecheck`
- `pnpm test`
- Visual smoke of TopBar, LeftRail, Trigger graph, Patch graph, Objects, Sections, Inspector, Monitor, and Perform.
