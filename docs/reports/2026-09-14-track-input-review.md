# Named track-input bridge — independent review

**Historical first-pass findings; implementation corrections are recorded below.** The original review found two P1 blockers and four P2 defects.

## Review boundary

- Baseline: `efbf269230ba23c77e1adbc243b059c0b59835e4` (`HEAD` at review time). Reviewed the working-tree changes, including new untracked track-input files, not an empty `HEAD` diff.
- Requirement authority: the review request; `docs/plans/2026-09-14-stage-spatial-ableton.md` for supporting context. Producer constraints are the packet schema, not assumptions about a particular sender.
- Covered protocol/schema/export glue, loopback adapter, registry/bridge and tests, server admission/host/boot glue, core `trackAudioInput`/`oscValue`, and web panel/store/WS/Audio inspector glue.
- **Excluded:** `integrations/ableton`, unrelated Stage/spatial/timing work, real devices/output, desktop applications, dev servers, screenshots, full sweeps and benchmarks. Parent owns those gates.
- Only this report was written. Probes used synthetic inputs, injected time, fake output and jsdom. Additional Vitest probes were injected in memory through a transform; no source, test, `.mex`, or git edits.

## Prioritized findings

### 1. P1 — A track-note OSC binding can leave momentary blackout permanently engaged

**Location:** `apps/server/src/track-input-registry.ts:86`, `:134–135`; `apps/server/src/main.ts:777–782`.

A named note's press goes through ordinary OSC handling, including global controls. Its release and disconnect cleanup instead become `oscValue`, which deliberately bypasses global controls. Consequently, a `panicBlackoutMomentary` binding receives its press but can never receive its release. The existing binding/OSC Learn surfaces permit this address.

**Repro:** bind momentary blackout to `/tracks/review-track/midi/1/note/38`. Start a separate looping solid effect. Register a MIDI track, send note 38 on, send it off, then expire the device lease.

**Observed real preview RGB sums:** before press `554238`; pressed `0`; released `0`; expired `0`. Sending an ordinary OSC zero to the same address restores light (`591838`). This is a stuck operator blackout, not an effect envelope.

**Fix:** distinguish note-release events from continuous modulation. Release an existing momentary binding without firing graphs or sequence resets; keep audio/gate/macro updates modulation-only. Alternatively, explicitly reject press-only addresses for momentary bindings. Simply forwarding every zero as ordinary OSC would restore the release-trigger bug.

### 2. P1 — Track MIDI bypasses the existing global MIDI-channel filter

**Location:** `apps/server/src/main.ts:774–775`.

The new sinks call `handleVoiceInput` directly. Normal browser/native MIDI passes through `createClientMessageHandler`, whose channel gate is at `apps/server/src/handlers/client-message.ts:370`. Neither `handleVoiceInput` nor `VoiceEngineHost.toInputEvent` applies that filter. Track notes and CCs therefore drive graphs, modulation and global controls from channels the operator explicitly excluded.

**Repro:** set `inputMap.midiChannel = 1`; register a MIDI track; send note 60 on channel 2 into a graph bound to note 60.

**Observed:** one real engine voice and preview RGB sum `554238`, despite the channel-1-only setting. The probe used the exact new sink routing with fake output, without starting `main` or a socket.

**Fix:** share the existing MIDI admission policy at the new ingress. Test rejected-channel notes and CC0/global-control CCs, not only channel preservation in mocked sink calls. Keep producer registration independent of editor privilege.

### 3. P2 — A delayed hello resets ordering and resurrects a closed session

**Location:** `apps/server/src/track-input-registry.ts:44–60`.

An existing disconnected entry is replaced before sequence validation. Setting its sequence to `packet.seq - 1` makes even a previously accepted hello valid again. Delayed data from that same runtime session can then replay after `bye` or lease expiry, undoing cleanup and generating another hit.

**Repro, same ID/session/port:** `hello(seq=0)` → `noteOn(seq=1)` → `bye(seq=2)` → delayed duplicate `hello(seq=0)` → delayed duplicate `noteOn(seq=1)`.

**Observed:** both duplicates return `{ok:true}`, the entry reconnects, and the sink sees note-on → cleanup note-off → another note-on. No new runtime session was supplied.

**Fix:** preserve the ordering/tombstone information of retained disconnected sessions. Only a genuinely new runtime session should reset sequence admission; a delayed hello must not establish a new lifetime for an old sequence. Cover both explicit bye and timeout, in addition to the existing test that rejects old data while a replacement session is connected.

### 4. P2 — Named OSC signals survive link loss in the offline renderer; retired IDs also accumulate

**Location:** `apps/web/src/lib/trigger-lab/store.svelte.ts:1791–1795`, `:1875–1876`; producer echo at `apps/server/src/main.ts:782`.

The new named signals enter the existing `sim.oscTable` through `receiveInputEcho` (`store.svelte.ts:1954`). Link loss clears track status and the selected **Audio** table only. Named OSC bands/gates/macros remain nonzero indefinitely: `Sim.setOsc`/`sampleOsc` have no freshness clock. A later empty track snapshot does not reconcile those keys either. Cleanup echoes also store zero rather than deleting keys, unlike the new core `oscValue` path, so registry eviction does not bound browser retention.

**Repro:** map `/tracks/audio-track/audio/level` to a looping solid effect's zero-base brightness. Receive value `0.8`, drop the WS connection before the server's cleanup echo, and advance the offline simulator by five seconds.

**Observed rendered RGB float sums:** before input `0`; live `1775.0568`; five seconds after disconnect `1540.1596`; explicitly clearing the named OSC value `0`. A separate store probe still sampled `0.8` after disconnect plus an empty status snapshot. Forty unique IDs receiving value then cleanup-zero left forty entries in `sim.oscTable`; its lifetime is not the registry's 32-device lifetime.

**Fix:** give named OSC mirrors explicit source ownership and clear them on link/session loss and device retirement. Delete retired keys, including relevant activity entries, rather than accumulating zero-valued addresses. Preserve ordinary OSC's existing behavior; do not globally clear unrelated OSC sources.

### 5. P2 — Modulation-only meter echoes consume OSC Learn and author inert bindings

**Location:** `apps/server/src/main.ts:780–782`; consumer `apps/web/src/lib/trigger-lab/store.svelte.ts:1946–1954`.

The comment calls these messages “Meter echo only”, but they use the ordinary `input/kind:osc` envelope. The receiver unconditionally calls `this.osc.apply(label)`. Both supported OSC Learn targets—global controls and drum zones—require trigger/control events, whereas these signals explicitly bypass those routes in the engine.

**Repro:** with an audio track streaming, arm OSC Learn for Next section. Let the next `/tracks/audio-track/audio/level` meter echo arrive before the intended hardware control.

**Observed:** `globalControls.nextSection.oscAddress` becomes that audio address and Learn disarms (`target: null`). The stream can never advance the section because its server path is `oscValue`. Device-cleanup zeros can consume the arm in the same way.

**Fix:** carry an explicit modulation-only distinction in the echo contract and exclude it from trigger/global-control Learn while retaining meter/table updates. Do not fix this by allowing continuous feature traffic to trigger global actions.

### 6. P2 — After disconnect, the UI cannot switch a selected track back to browser capture

**Location:** `apps/web/src/lib/app/chrome/TrackInputsPanel.svelte:38–39`; `apps/web/src/lib/app/settings/panes/InputPane.svelte:82–86`.

The selector and callback require a non-null server status, even for the local Browser / loopback choice. Disconnect clears that status but retains the selected track ID. `InputPane` therefore continues hiding `AudioInputPanel`, while the only control it tells the user to use is disabled. `startAudio()` also refuses while that selection remains set.

**Repro:** select an audio track, lose the engine connection, open Settings → Input as the standalone/offline editor, and try selecting Browser / loopback capture.

**Observed component probe:** `{canEdit:true, selected:'audio-track', disabled:true}`. The store mutation itself permits offline clearing; the panel prevents access to it.

**Fix:** allow an authorized local editor to clear the selection without live registry status. This must not automatically request capture; the existing explicit Enable action should remain required.

## Standards and security assessment

- No additional hard standards findings: core remains IO-free, packet/status types are schema-inferred, and device packets do not enter the authoring reducer/editor registry.
- Loopback binding and exact peer-address checks, the 2048-byte pre-parse cap, strict schemas, active ID/session/port collision refusal, device/note bounds, per-entry rate admission and independent audio freshness are present.
- **Trust assumption:** this endpoint authorizes any process capable of sending local UDP. Saved IDs, runtime sessions and ports are collision/ordering identities, not authentication credentials. That matches the stated trusted-local input requirement; absence of a host token is not reported as a bug.
- The connected echo handler does not fire the simulator, and core `oscValue` returns before trigger/reset resolution. The defects above concern surrounding admission, lifetime and Learn/control handling, not a general double-fire in that path.

## Focused verification and acceptance gaps

Executed only narrow checks:

1. Server registry + voice-input suites: **31 passed**.
2. Core OSC modulation suite: **10 passed**.
3. Web track store/panel suites plus four in-memory diagnostic probes: **14 passed** (10 existing tests; four assertions recording the undesirable behavior).
4. One additional in-memory offline-render probe: **1 passed**, five existing tests skipped by its name filter.
5. Inline synthetic registry/real-host probes confirmed findings 1–3. No server, UDP socket, capture device or output adapter was opened by these probes.

These passing diagnostics confirm the observations, not correctness of the affected behavior. No known localStorage mock problem was investigated or reported.

**First-pass acceptance gap (subsequently covered below):** exercise schema/registry → actual main admission → selected-source host → rendered pixels together, including wrong-channel global controls, momentary release/expiry, closed-session replay, and browser link-loss recovery. Existing bridge tests end at mocked sinks; the added selected-audio host test supplies the track frame directly and does not exercise main's ID-selection sink. Add real reset/global bindings to modulation-only regressions—the current OSC test mentions reset but does not configure a reset source.

Full sweeps, strict UI captures and any sender-package compatibility claims remain outside this review. No Ableton/Max/Unreal/desktop application or `integrations/ableton` file was opened.

## Integrating-session corrections (2026-09-14)

| Finding | Correction and regression evidence |
| --- | --- |
| 1 · held blackout | Explicit registry press/release edges; host-only `oscRelease` completes momentary/continuous controls without firing graphs or resets. Real RGB blackout → release/expiry tests in `track-input-sink.test.ts`. |
| 2 · channel bypass | Shared `midi-channel.ts` policy before both raw and scoped MIDI/CC. An owned release still completes after a filter change. Tests include wrong-channel direct/scoped graphs, momentary control, CC0 recall and master brightness. |
| 3 · replay | Retained entries retain ordering through bye/timeout. Higher-sequence hello on the same peer can resume the same runtime (necessary for the actual sender's port/saved-identity round trip); it NEVER resets sequence. Fresh nonce resets admission; older data while a replacement is active is refused. History remains bounded to 32 retained current entries. |
| 4 · offline ownership | Explicit echo `trackInputId` owns browser keys/badges. Zero, retirement, link/server-session loss and shutdown delete them. Unrelated ordinary OSC survives; a received named zero still supersedes an ordinary write at that exact address, matching server last-event semantics. Rendered offline regression included. |
| 5 · Learn | Explicit `modulationOnly` excludes continuous/release echoes. Ordinary OSC Learn, including an initial fader zero, is unchanged. Actual sequence-reset binding added to the core non-trigger regression. |
| 6 · recovery | Offline editors can clear to browser capture without auto-starting it; viewers remain refused. Mounted keyboard/store regression included. |

`createTrackInputSink` is now the actual production module used by main AND the rendered tests,
not a copied approximation. Registry + sink: **41 tests passed** after final interoperability
correction, including the foreign CJS session writer. Full workspace tests and typechecks passed;
final running-server/capture evidence is recorded in the implementation report. Live/Max and
physical kit behavior are not inferred from this evidence.
