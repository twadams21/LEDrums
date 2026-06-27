# Placeholder: split TriggerLab store into focused stores

This draft PR is a branch-sized work item for the next implementation agent. Replace or remove this placeholder once real code lands.

## Scope

`apps/web/src/lib/trigger-lab/store.svelte.ts` has become a production monolith. Split by responsibility while preserving shell behavior.

Candidate slices:

- engine link store: WebSocket, MIDI, frames, latency, stats, connection state
- show-library store: active show, library list, save/adopt state
- setlist store: songs, sections, active song/section, copy/paste sections
- graph store: trigger graph selection, node/edge CRUD, graph names
- effect/preset store: authored effects, presets, parameters, envelopes
- patch/project store: server project, kit, outputs, patch labels
- autosave controller: debounce, server/local persistence, status

## Suggested approach

Extract one slice with a compatibility facade first. Avoid rewiring every component at once.

## Suggested checks

- `pnpm typecheck`
- `pnpm test`
- Live shell sweep, with special attention to active section, graph selection, autosave status, and server reconnect.
