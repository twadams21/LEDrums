# INIT-02 store-decomposition — chunked dispatch plan (/slicing-work shape)

One initiative, three STRICTLY SEQUENTIAL chunk dispatches (every step churns
store.svelte.ts — shared mutation seam, no parallelism). Fresh agent + review
gate + orchestrator merge per chunk. Plan of record:
`09-synthesis/INIT-02-store-decomposition.json`; `11-decisions.md` veto-round
overrides: collaborators publish as `store.library` / `store.arrangement`
(plan already matches); "Saved" = local write only (S22's honesty bar);
authoring-document store stays a tracked follow-on (S23); Host interfaces stay
exported (S14).

## Chunk 02A — ratchet + tracer + small controllers (S1–S5)

Pin the public surface (size ratchet), close ui-shot preset gaps, then the
tracer (ControllerTest, 3 forwarders) and the two mid-size publishes
(MidiController 6, ControllerMonitor 12). Resting state: three collaborators
public, ratchet green, every deleted forwarder proven consumer-free.

## Chunk 02B — sections + shows migrations (S6–S13)

`store.arrangement` (18 forwarders) then `store.library` (30 forwarders), each
as publish-additive → retarget-production → retarget-tests (rename-normalised
diff gate) → delete. Resting state after EACH of S9/S13 is durable — if the
chunk stalls mid-way, merge what's green.

## Chunk 02C — seams + honesty tail (S14–S23)

Host seams real (S14) · LibrarySync characterization then collapse (S15→S16) ·
shell-nav inlining (S17) · liveRouting/patchRouting named channel (S18) ·
WireEnds (S19→S20) · localStorage result + honest save-error state (S21→S22,
UI-GATED) · ratchet tightened + tracked follow-on emitted (S23).

## Every chunk

`lanes/COMMON.md` binds. Re-measure baseline at starting HEAD. INIT-01 landed
before this: the store no longer has a sim mirror (01B), voice is the only
runtime (01C) — verify every plan anchor against the real store first; forwarder
counts may have moved. Review gate per chunk, reviewer model ≠ implementer.
