# Placeholder: standardize numeric commit parsing

This draft PR is a branch-sized work item for the next implementation agent. Replace or remove this placeholder once real code lands.

## Scope

Replace ad-hoc numeric input parsing with a shared parser/commit helper.

## Target behavior

- Add a helper such as `parseOptionalNumber(raw, { min, max, integer })`.
- Define blank input semantics per field: ignore, clear, or restore default.
- Clamp/validate in store/domain logic, not only through input attributes.
- Add small unit coverage for integer, float, min/max, blank, invalid, and clear/default cases.

## Suggested checks

- `pnpm typecheck`
- `pnpm test`
- Live inspector edits for numeric fields: patch dimensions, node probabilities, timings, MIDI values, and controller ranges.
