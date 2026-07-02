# 03 — Input→graph firing: kill the echo loop, make resolution single-path

> Part of the 2026-07-02 "rock solid" initiative. See [INDEX.md](INDEX.md).

## Problem

MIDI/OSC/keyboard firing feels wrong: routing is more complex than it needs to be and extra events
fire. Desired model (Trent's words): an incoming MIDI/OSC message is received; it is either bound
to trigger a graph directly, **or** it is a drum trigger and fires the graph tied to that drum
trigger in the active song section. One message → one resolution → one fire.

## Current state — the duplicate fires are real (verified 2026-07-02)

### Fire #1+#2: the web echo loop (confirmed in code)

- Outbound: `apps/web/src/lib/trigger-lab/store.svelte.ts:543-559` `forwardMidi` — fires the local
  sim (`fireRawMidiLocal`, :548 → `resolveGraphsForFire` :1078, monitor events :1089-1097) AND
  sends `{t:'midi'}` to the server (:550).
- Server: `apps/server/src/handlers/voice-input.ts:77-84` applies the input to the voice host and
  **broadcasts `{t:'input', kind:'midi', ...}` back to all clients** (:83).
- Echo: `store.svelte.ts:905-910` `onInput` — on a `midi` echo with velocity>0 it calls
  `fireRawMidiLocal(note, …)` **again**. The originating client therefore fires the same directly
  bound graph twice locally, plus the server fires it authoritatively. (Verified: the handler is
  exactly `this.applyMidiLearn(note); this.fireRawMidiLocal(note, …)`.)

### Fire #3: keyboard impersonates MIDI

- `App.svelte:28-29` → `store.fireSectionGraph(index)` (`store.svelte.ts:1165-1193`): fires the
  section graph locally, then forwards **the graph's trigger source** to the server — a synthetic
  `{t:'midi'}` or `{t:'osc'}` (:1186-1193). The server re-resolves that as if real input arrived
  (direct binding AND possibly zone-map pad path), then echoes it back → the echo loop re-fires
  locally. A keyboard press on a MIDI-bound section graph can fire 3×.

### Deliberate non-exclusivity in the engine

- `packages/core/src/voice/engine.ts:257-260` `resolveGraphsForEvent` runs BOTH
  `resolveHitGraphs(drumId, zone)` (when zone-mapped: section-slot graphs `path:'pad-section'`,
  else `graphs[padKey]` fallback `path:'pad-fallback'`) AND `resolveDirectGraphs(e)` (:275-287,
  `path:'direct-midi'|'direct-osc'`) for every noteOn/osc. Commit `a284721` made this intentional
  ("lets a MIDI note drive a patch zone and an authored graph"), with a test documenting both-fire
  (`engine.test.ts:946-958`). This is exactly the "extra events" Trent perceives when a note is
  both zone-mapped and directly bound.
- Server-side precedence into the engine: `apps/server/src/voice-engine-host.ts:206-235`
  (`zoneForNote` attaches drumId/zone on match; miss forwards raw note). Native MIDI/OSC paths
  (`apps/server/src/main.ts:384-430`, :500-519) are single-fire (no echo re-fire — only WS clients
  run `onInput`).
- Key/pad path is already echo-safe: `onInput` has no `key` branch, so `hit()`
  (`store.svelte.ts:1134-1158`) fires once locally + once on the server.

### Why the echo-fire exists (context for the fix)

When input arrives at the *server* (native MIDI, OSC, another client), browser clients need their
local monitor/UI to reflect it. The mistake is that the echo handler *fires the sim* instead of
merely *displaying*. When connected, the visualiser already renders server frames
(`store.previewFrame = useServer ? serverFrame : frameBuf`, `store.svelte.ts:319-323`) and the
server already streams `busLevels` (:900) — local sim firing is redundant for connected visuals.

## Proposed design

### Principle: exactly one resolver owns a hit

The core engine is the **only** resolution module when connected; the web sim resolves only when
offline. The resolution interface (already in core) is the seam; the web sim is a second adapter
used offline — not a concurrent one.

1. **Break the echo loop**: `onInput` must never fire the sim. Keep `applyMidiLearn(note)` (learn
   should work from any input source) and monitor display; delete the `fireRawMidiLocal` call.
2. **Gate outbound local firing on link state**: in `forwardMidi` / `hit` / `fireSectionGraph`,
   fire the local sim only when the engine link is not open (offline preview). When connected,
   send to the server and let frames/busLevels come back. (This also fixes LayersDock/visualiser
   divergence — see doc 04: LayersDock should read server voice state when connected.)
3. **Keyboard sends intent, not impersonation**: new protocol message
   `{ t:'fireGraph'; graphKey; velocity }` (packages/protocol). Server handler → voice host →
   engine fires that graph key directly (new small `InputEvent` kind or a host-level resolution
   short-circuit; keep core pure + deterministic). No re-resolution, no echo mis-fire.
4. **Keep pad + direct both-fire, but make it visible** *(DECIDED by Trent 2026-07-02 —
   overrides the earlier exclusive-precedence recommendation)*: `resolveGraphsForEvent` keeps
   firing both paths (`engine.ts:257-260` unchanged; `engine.test.ts:946-958` stays valid).
   The fix is transparency, not exclusivity: when a trigger node's MIDI/OSC source is ALSO
   zone-mapped to a drum, the trigger node face shows a small link icon whose hover tooltip names
   the drum/zone ("also drum trigger: kick · center"). Pure helper
   `zoneLinkForSource(inputMap, source) → {drumId, zone} | null` (beside `describeTriggerSource`),
   rendered via `NodeCard`'s icon-chip slot; same hint shown in `TriggerSourceInspector` and
   `PatchZoneInspector` (the reverse direction: "this zone's note also fires graph X"). With the
   echo loop dead and keyboard sending intent, both-fire is one server-side layered fire per hit —
   deliberate and visible, not "extra events".

### Resulting flow (the whole spec)

```
message (WebMIDI→WS | native MIDI | OSC | key | fireGraph)
  → server host: fireGraph? fire that graph
      else: direct bindings matching note/address fire (direct-*)
            AND zone-map match attaches (drumId,zone) → active-section slot graphs / pad fallback
            (both may fire for one message — by design, surfaced via the drum-link icon)
      neither matched? monitor 'input-unrouted' event (new — today misses are engine-side only)
  → engine renders; clients display frames/busLevels/monitor. No client fires while connected.
```

## Touch list

- `apps/web/src/lib/trigger-lab/store.svelte.ts` — `onInput` (:905-910), `forwardMidi` (:543-559),
  `hit` (:1134-1158), `fireSectionGraph` (:1165-1193), offline gating helper
- `packages/protocol/src/index.ts` — `fireGraph` message
- `apps/server/src/handlers/voice-input.ts` — `fireGraph` handler; keep `input` broadcast (display)
- `packages/core/src/voice/engine.ts` — resolution UNCHANGED (both-fire kept); add the
  `input-unrouted` diagnostic on full miss
- new pure `zoneLinkForSource` helper + icon/tooltip in `TriggerNode`/`NodeCard`,
  `TriggerSourceInspector.svelte`, `PatchZoneInspector.svelte`

## Tests

- Core: table-driven precedence tests — direct-only, zone-only, both-bound (direct wins, pad
  silent), fireGraph, miss → diagnostic. Determinism preserved (same inputs → same fires).
- Web: `onInput` echo does NOT fire sim (regression for the loop); offline fires locally; online
  does not; keyboard sends `fireGraph` (not synthetic midi); midi-learn still works from echo.
- Monitor: one hit → exactly one `input-resolved` + one `graph-fired` per fired graph, one `input`
  broadcast; assert counts in a server handler test.

## Decisions (LOCKED 2026-07-02)

- **Both-fire kept**; visibility via the drum-link icon + tooltips (Trent's call — see §4 above).
- `input` echo broadcasts stay as-is for Monitor display (diagnostics already carry `source`).
