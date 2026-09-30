# trigger-lab — the authoring store and the offline engine

The directory name is historical (it began as a throwaway trigger-model probe). Today it holds the
web app's authoring model for Effect chains and its offline preview:

- `store.svelte.ts` — `TriggerLab`, the one reactive store. It owns the authored v3 show library
  (songs → sections → Effect stacks + Master chains), implements `EffectsAuthoringApi`
  (`effects-api.ts`) and `MapModeApi` (`map-api.ts`), and runs the engine link.
- `effects-controller.svelte.ts` / `effects-doc.ts` / `grid-model.ts` — the pure Effect mutations
  and grid read models behind the authoring contract.
- `sim.ts` — the offline Sim: a private core `createVoiceBusEngine` driven by the browser clock, so
  offline playback matches the server engine by construction (`runtime-parity.test.ts`).
- `persistence.ts` — the v3 show library and v2 song library (new storage keys).
  `legacy-import.ts` is the only reader of the old graph-model libraries; it imports their songs,
  sections and transport and drops the graphs.
- `clipdoc.ts` / `effects-files.ts` — copy/paste and save/load-to-file (section, song, patch,
  Effect, cell and device kinds).
- `store/` — pure slices the store delegates to (ids, shows, song library, input mappings,
  routing, transport, history).
