# Placeholder: remove legacy sections state

This draft PR is a branch-sized work item for the next implementation agent. Replace or remove this placeholder once real code lands.

## Scope

Replace legacy `store.sections` usage with the active authored song's sections wherever that is the real source of truth.

## Target behavior

- Derive section counts and section lists from `store.activeSong?.sections` or equivalent setlist state.
- Remove `sections = $state<Section[]>(structuredClone(SECTIONS))` if it is no longer a meaningful compatibility surface.
- Confirm `buildShow`, serialization, copy/paste sections, and active section selection do not rely on stale parallel state.
- If compatibility is still required, document why and keep the bridge small.

## Suggested checks

- `pnpm typecheck`
- `pnpm test`
- Live Sections view, TopBar section count, section copy/paste, show save/load, and active section switching.
