# Placeholder: derive patch topology from the active project

This draft PR is a branch-sized work item for the next implementation agent. Replace or remove this placeholder once real code lands.

## Scope

Patch graph topology should derive drum/output geometry from the server-authoritative project when it is available, not from `DEFAULT_KIT` except as an initial fallback before server state arrives.

## Target behavior

- Use `store.project?.kit` as the source of truth for drum geometry and output counts.
- Keep `DEFAULT_KIT` only as a pre-server fallback.
- Add coverage for a project whose geometry differs from the default fixture.
- Verify patch labels and routing adoption continue to line up with the active project.

## Suggested checks

- `pnpm typecheck`
- `pnpm test`
- Live Patch graph smoke with a non-default project shape.
