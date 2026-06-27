# Placeholder: centralize domain ID generation

This draft PR is a branch-sized work item for the next implementation agent. Replace or remove this placeholder once real code lands.

## Scope

Replace the single module-level `idSeq` / `nid()` pattern with a deliberate ID strategy.

## Target behavior

- Provide an ID factory per domain or a compact random-ID helper with collision checks.
- Seed deterministic factories from existing persisted IDs where deterministic behavior is needed for tests or fixtures.
- Avoid coupling unrelated ID domains such as shows, songs, sections, graphs, presets, effects, and nodes to one counter.
- Keep migration/backward compatibility for already persisted IDs.

## Suggested checks

- `pnpm typecheck`
- `pnpm test`
- Save/load and duplicate/create flows for shows, songs, sections, graphs, presets, effects, and graph nodes.
