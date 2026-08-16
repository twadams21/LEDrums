# S2 — "Now playing" indicator on trigger graph-list cards (+ the graph key on the voice wire)

**Effort: opus/medium · branch `feat/graph-now-playing` off `main` · PR into main.**

## What Trent asked for (verbatim in the verdicts doc §5)

Toggles and loops that "are fired and keep playing" need a sustained indicator on the graph
card, "so we know that when lights are displaying on the kit, what graph might be controlling
the lights." Keep the existing one-shot 520ms `.fireburst` for the *fired* moment (it answers a
different question); the sustained "now playing" state is a **separate, calmer mark** — think
G1c's restraint: small, steady, no motion loop. Apply `/make-interfaces-feel-better`; respect
reduced motion (steady state is already motion-free).

## The wire gap you must close first (verified 2026-08-17, file:line evidence)

`Voice.pad` (the firing graph's KEY) exists engine-side but NEVER reaches the client:

- Core sets it at spawn: `packages/core/src/voice/voice-pool.ts:206` (`slot.pad = deps.pad ?? ''`),
  fed from `packages/core/src/voice/engine.ts:655` (`pad` = `resolved.statePrefix`, set ~631).
- The wire item `VoiceStat` (`engine.ts:89-102`) has NO `pad`; the builder `stats()`
  (`engine.ts:742-751`) copies only id/busId/effectId/mode/level/hue/releasing/via.
- Protocol `voiceStatSchema` (`packages/protocol/src/schemas.ts:297-306`) has no `pad` and is a
  stripping z.object — even an emitted field would be silently dropped. A compile-time lock
  `_LockVoiceStats` (`schemas.ts:471`) forces core + protocol to be edited together.
- Web ingest: `apps/web/src/lib/ws/client.ts:250` → `store.svelte.ts:1431` (`serverVoices`) →
  `dock-voices.ts:63-79`. `DockVoice` also lacks `pad`.
- The web sim hardcodes `pad: 'preview'` for every voice (`apps/web/src/lib/trigger-lab/sim.ts:523`)
  — fix it to carry the actual firing graph key so offline behaves like linked.
- Section-slot fires use `statePrefix = \`${key}#${slotIndex}\`` (`engine.ts:516`); direct paths
  use the bare key (439/477/523). Normalise with a `split('#')[0]`-style helper in ONE place.

Add `pad` to: `VoiceStat` + `stats()` (core), `voiceStatSchema` + the `_LockVoiceStats` lock
(protocol), `DockVoice` + `serverVoiceToDockVoice` (web). `mode: PlayMode` already flows
end-to-end (`engine.ts:746`, `schemas.ts` enum, `dock-voices.ts:68`) — use it as-is.

## The indicator logic

A graph card is "now playing" when live voices attribute to it: read `dockVoices`/`serverVoices`
(NOT the smoothed `dockVoicesDisplay` — it decays late; `store.svelte.ts:450-455`), predicate on
normalised `pad === graphKey`. Distinguish sustained (`mode` `loop`/`hold`, or any voice still
alive past the burst) — that's the "now playing" mark. `serverVoices` clears on link drop
(`store.svelte.ts:1415`), so the indicator dies with the link — correct behaviour, keep it.
Derive per-graph liveness in ONE pure selector (new small module beside `dock-voices.ts`, unit
tested with voices from both paths), not inline in the component.

## Anchors to verify

Every file:line above (they were read on a slightly different sha), plus `GraphsDock.svelte`'s
current `.fireburst`/`lastSectionFire` mechanism and the G1c edge-marker styling it must sit
beside.

## Scope fence

May touch: the core `stats()`/`VoiceStat` addition, `schemas.ts` voiceStat + lock, `sim.ts` pad
line, `dock-voices.ts`, one new selector module + test, `GraphsDock.svelte` + its styles,
ui-shot preset(s), styleguide entry ONLY if a new reusable primitive emerges (a one-off card
mark is not one). Non-goals: any engine spawn-path change beyond reading what exists, monitor
bus changes, the graph-list thumbnails, S3's drawer work (different files — do not touch
NodeEditor/TriggerGraphView).

## Evidence

- Typecheck 0 + targeted vitest (core voice stats, protocol schemas, the new selector),
  committed HEAD pushed. **Do NOT run the full `pnpm test` sweep — orchestrator-only rule
  (parallel sweeps can crash this machine); the orchestrator sweeps at review.**
- Unit tests: the selector (server-shaped + sim-shaped voices, `#slot` suffix case, link-drop
  empty case). Protocol lock compiles.
- ui-shot: card with sustained indicator lit (drive it via the seam ops: `effect:`, `fire:`;
  a loop-mode effect keeps voices alive) — `--strict`.
- Report: commit body <30 lines; one-line completion message names sha + branch.

## Escalate if

- Adding `pad` to the wire breaks the protocol lock in a way requiring changes beyond
  voiceStat (schema versioning questions are above your pay grade tonight).
- Voice attribution turns out ambiguous for linked/copied graphs (same KEY on multiple songs is
  FINE — same key = same graph = both light; but if you find a case where the key is missing
  entirely on a real path, report it, don't invent a fallback).
