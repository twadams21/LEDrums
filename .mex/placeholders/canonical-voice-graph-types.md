# Placeholder: move voice graph types to the canonical package

This draft PR is a branch-sized work item for the next implementation agent. Replace or remove this placeholder once real code lands.

## Scope

The web show-builder notes that lab simulation types and core voice types are structurally identical. Make the canonical type ownership explicit.

## Target behavior

- Move shared voice/show graph types to `@ledrums/core` or another approved canonical package.
- Import those types from web code instead of relying on parallel structural definitions.
- Keep `show-builder` as an explicit adapter, not a source of duplicated type truth.
- Preserve the purity boundary for `packages/core`: no Node, DOM, or IO imports.

## Suggested checks

- `pnpm typecheck`
- `pnpm test`
- Build/show serialization check from authored state to engine voice graph.
