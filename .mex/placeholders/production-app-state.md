# Placeholder: promote production app state out of trigger-lab

This draft PR is a branch-sized work item for the next implementation agent. Replace or remove this placeholder once real code lands.

## Scope

The unified shell imports and runs `TriggerLab` as the production app brain, while parts of `apps/web/src/lib/trigger-lab` still describe themselves as throwaway prototype/simulation code.

Make the boundary explicit:

- Move production shell/store/model code into a production namespace such as `apps/web/src/lib/app/state` or an equivalent project-approved location.
- Leave only actual prototype/demo code under `trigger-lab`, or quarantine it under a clearly named prototype path.
- Update imports from `App.svelte`, shell views, docks, and chrome components.
- Remove or rewrite stale comments that say production code is throwaway.

## Constraints

- Avoid changing runtime behavior while moving files.
- Keep any true prototype route working if still intentionally supported.

## Suggested checks

- `pnpm typecheck`
- `pnpm test`
- Live `:5173` smoke test across Trigger, Patch, Objects, Sections, and Perform views.
