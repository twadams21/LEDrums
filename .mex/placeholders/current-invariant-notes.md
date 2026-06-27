# Placeholder: refresh source comments to current invariants

This draft PR is a branch-sized work item for the next implementation agent. Replace or remove this placeholder once real code lands.

## Scope

Source comments still carry branch/slice history such as S1/S2/S3/U4/S7 and some stale notes about wiring that is now complete.

## Target behavior

- Keep rationale and project history in `.mex`, ADRs, and long-form docs.
- Keep source comments focused on current invariants, contracts, and non-obvious behavior.
- Remove or update comments that describe old migration state.
- Avoid changing behavior in this cleanup.

## Suggested checks

- `pnpm typecheck`
- `pnpm test`
- Review changed comments against `.mex/ROUTER.md`, `CLAUDE.md`, and current code behavior.
