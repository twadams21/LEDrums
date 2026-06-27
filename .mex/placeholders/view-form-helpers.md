# Placeholder: extract view form options and formatters

This draft PR is a branch-sized work item for the next implementation agent. Replace or remove this placeholder once real code lands.

## Scope

Move inline option arrays, display formatters, and small commit helpers out of large Svelte components where they obscure the actual UI branches.

Candidate targets:

- trigger node option lists
- patch inspector option lists
- percentage/span/value formatters
- repeated input commit adapters
- small domain-specific labels and display metadata

## Constraints

- Keep option order and labels stable unless intentionally changing UX.
- Prefer pure TypeScript modules with tests for parsing/formatting where useful.

## Suggested checks

- `pnpm typecheck`
- `pnpm test`
- Live inspector sweep to confirm dropdowns, labels, and formatted values stay unchanged.
