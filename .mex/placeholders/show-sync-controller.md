# Placeholder: extract show-library sync controller

This draft PR is a branch-sized work item for the next implementation agent. Replace or remove this placeholder once real code lands.

## Scope

Show-library reconciliation is currently mixed into the main app store: cold-load adoption, server-wins behavior, localStorage write-through, save status, and server push handling.

Extract a focused sync controller around the server-authoritative show-library blob.

Candidate responsibilities:

- `reconcileServerLibrary`
- `adoptLibrary`
- `syncLibraryToServer`
- signature/hash handling
- localStorage cache bridge
- save status transitions

## Constraints

- Preserve the opaque versioned server blob contract.
- Keep web-side validation/adoption as the owner of authored show schema.
- Avoid changing user-visible save semantics while extracting.

## Suggested checks

- `pnpm typecheck`
- `pnpm test`
- Live show browser checks: new, open, save, save-as, rename, close, delete, reload, and server reconnect.
