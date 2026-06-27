# Placeholder: consolidate graph node metadata

This draft PR is a branch-sized work item for the next implementation agent. Replace or remove this placeholder once real code lands.

## Scope

Consolidate duplicated graph/node display metadata that appears across prototype canvas code and the SvelteFlow graph views.

## Target behavior

- Create canonical metadata modules for trigger node kinds, bus icons, labels, tint classes, and related display helpers.
- Use the canonical metadata from active production views.
- Keep prototype-only metadata quarantined if it intentionally diverges.
- Remove stale duplicates after production call sites are migrated.

## Suggested checks

- `pnpm typecheck`
- `pnpm test`
- Live graph view check for node icons, labels, bus badges, hover/decorated edges, and inspector labels.
