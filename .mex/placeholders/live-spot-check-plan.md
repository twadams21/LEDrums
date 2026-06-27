# Placeholder: live unified-shell spot-check plan

This draft PR is a branch-sized work item for the next implementation agent. Replace or remove this placeholder once real code lands.

## Scope

`.mex/ROUTER.md` says the live `:5173` spot-check is still owed. Capture that as an executable or documented checklist before deeper refactors land.

## Checklist targets

- Graph UX: Trigger graph and Patch graph render, pan, zoom, fit, reconnect, delete, drag/drop.
- Trigger-source editing: source type, MIDI/OSC fields, labels, routing into graph nodes.
- Sections: list, active section, rename, duplicate, copy/paste, graph assignment.
- Drum geometry: default and non-default project shapes.
- Hardware cases: rewire, dense layout, straddle layout, output labels.
- MIDI/OSC: input monitor, source mapping, controller settings.
- Show library: new, open, save, save-as, close, rename, delete, reload.
- Perform view and renames-on-face.

## Suggested implementation

Start with a markdown checklist if no browser automation harness exists. If Playwright or another harness is already present, encode the stable smoke cases there.

## Suggested checks

- `pnpm typecheck`
- `pnpm test`
- Manual or automated `:5173` sweep recorded in the PR.
