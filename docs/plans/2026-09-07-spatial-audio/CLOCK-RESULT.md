# T1 — MIDI Clock transport sync: result

Worker: twux `midi-clock-2adba1` (Fable/low), worktree `ledrums-wt/midi-clock`, branch `feat/midi-clock`.
Implementation commit: **`0a8c7a95`** (`feat(transport): opt-in MIDI Clock sync (#214 T1)`). This report is the following commit.
Not pushed, not merged, no `.mex`/CAD edits, no agents launched. Parent's mid-slice follow-ups (re-lock after a tempo step, Start-without-pulse timeout, batched duplicate timestamps still count) are included.

## What shipped

**Core (pure, `packages/core/src/engine/midi-clock.ts`)** — 24 PPQN reducer under injected receipt time. `applyMidiClockEvent` handles tick/start/continue/stop/position (14-bit 16ths → quarter beats). Position is exact and tick-counted (first pulse after Start/Continue anchors the downbeat/resume point, every later pulse is +1/24, so no phase drift over bars). `advanceMidiClock` interpolates between pulses for render, clamped at one pulse so a late tick is never double counted; ≥1000 ms of silence (from the last pulse, or from a Start/Continue still awaiting its first pulse) ⇒ `lost`: beat frozen at the rendered position, not playing, tempo retained; the next pulse anchors and resumes, no catch-up. Tempo: bounded 24-interval history, rejects non-positive/duplicate intervals and anything outside 20..300 bpm (±0.5% slack), rejects >1.6× outliers vs the running median, resets after a gap, and re-locks when 6 consecutive outliers agree within 20% (tempo step 120→240 / 120→60 locks within a quarter beat). Seed = authored bpm until 6 intervals; `locked` flag exposed. Host-batched pulses sharing a receipt timestamp all count for position, only their zero interval is excluded from tempo.

**Schema** — `transportSchema` gains `source: 'manual'|'midiClock'` (default manual) and `clockInput: 'native'|'browser'` (default native). Existing projects parse unchanged; `defaults.ts` updated. `Transport`, `TransportSource`, `ClockInput` exported.

**Protocol** — client `{ t:'midiClock', command: tick|start|continue|stop|position, position?: int 0..16383 }`, strict, no channel, no client timestamp. `setTransport` accepts optional `source`/`clockInput`. `voiceStats.clock?: { status: off|waiting|running|stopped|lost, bpm, locked, playing }` piggybacks the existing stats broadcast (no per-tick message, no monitor line per pulse).

**Server** — `VoiceEngineHost.applyMidiClock(msg, route)` stamps `clockNow()` (wall-monotonic, injectable; engine time would quantise pulses to 8.3 ms). Ignored while source is manual or `route !== clockInput`, so native and browser can never combine. `transport(dt)` derives beat/bar/beatInBar/bpm/playing from the reducer in clock mode (authored `playing` ignored, authored bpm only the seed); manual mode is byte-for-byte the old path. Clock state is recreated whenever the source flips or a project is committed. Monitor logs status TRANSITIONS only. WS: `midiClock` handled before the editor gate, editor-only (viewer dropped silently), never persisted. Native HTTP route (`native-midi.ts`) now accepts `midiClock` and `main.ts` feeds it to the host tagged `'native'` (bypassing the WS handler's editor gate for the stub socket); ticks are not monitor-logged, start/stop/continue/position are. `input-router` forwards `source`/`clockInput` in `setTransport`.

**Desktop bridge (Rust)** — `midi_message_json` decodes F8/FA/FB/FC and F2 (LSB-first 14-bit) before the channel parse; other system messages still dropped. Packet walker untouched (already sizes them). Unit tests added in `packet_tests` (order-independent JSON compare), including a pulse/note/pulse/CC/pulse interleaving fixture.

**Web** — `parseMidiMessage` recognises system real-time/SPP before the 2-byte minimum; `initMidi` tags ONLY clock events with the port id (notes/CC/PC unchanged, existing tests untouched). `store/midi-clock.ts` (pure): picker value codec (`native` / `browser:<id>`), option builder (disconnected ports disabled, missing selection shown honestly), `shouldForwardClock` (selected port owns the clock; never in manual, never on the native route, never as viewer), `resolveClockStatus` (server truth while connected; local reducer offline only with a browser port; native offline = waiting, never "synced"), `LocalMidiClock` (same reducer under `performance.now()`). Store: `timingSource`/`clockInput` derived from the server project (like the MIDI channel filter), `clockDeviceId` in localStorage (machine-local, never in the show), `setTimingSource`/`setClockInput` send only that field (the mirrored bpm/playing tuple is untouched, so it cannot overwrite clock state), `adoptClockBpm()` freezes the clock tempo into the authored bpm via the normal path, offline loop drives the sim from the reducer. `MidiClockPanel.svelte` (new, under `app/chrome/`, one import + one insertion in `InputPane.svelte` between the device list and the OSC separator): Timing source segmented [Manual / MIDI Clock]; Clock input dropdown [Native LEDrums port / WebMIDI inputs]; one status pill + tabular bpm with "authored / from clock / seed — not locked yet"; lost explanation; WKWebView/no-WebMIDI hint pointing at the native port; concise Ableton Sync instruction naming the chosen port; "Use N bpm as the manual tempo" button with the switching-to-Manual note. Composed from Field/Select/StatusPill and the settings `.entry` button idiom; no new primitive, so no styleguide entry — parent regenerates `docs/design-system.html` and takes the ui-shot.

**Docs** — README "Input mapping" gains a MIDI Clock paragraph: transport sync only; effects/LFOs authored in seconds run as authored.

## Verification (targeted only, as briefed)

| Suite | Result |
| --- | --- |
| core `engine/midi-clock.test.ts` | 22 passed (multi-tempo lock 20..300, jitter, outliers, tempo step, duplicate/backwards timestamps, gap timeout, Start-without-pulse, stop/continue/position, interpolation clamp, lost/resume) |
| protocol `schemas.test.ts` | 15 passed (midiClock valid/invalid, channel/atMs refused, setTransport source) |
| server `voice-engine-host.test.ts` | 35 passed (manual ignore, route rejection, synthetic stream → transport snapshot, lost/resume, monitor transitions, source flip) |
| server `client-message.test.ts` | 63 passed (editor accepted, viewer dropped, manual ignored) |
| server `native-midi.test.ts`, `ws-protocol`, `input-router`, `voice-input` | 16 + 39 passed |
| web `webmidi.test.ts`, `store/midi-clock.test.ts`, `store.midi-clock.test.ts`, `store.cc`, `store.server-library`, `midi-controller`, `InputPane`, `ws` | 90 passed |
| typecheck | core, protocol, server (`tsc`), web (`svelte-check`, 0 errors) — package-level, not the root sweep |
| Rust | `rustfmt` parses/formats clean; **`cargo test` NOT run** (no target dir in this worktree — full tauri compile) — parent to run `cargo test -p ledrums-desktop --lib packet_tests` or leave to CI |

Not run: full `pnpm test`, root `pnpm typecheck`, dev server, browser, ui-shot, design-system regeneration.

## Limitations / honest notes

- **Native bridge jitter is unmeasured.** Pulses ride the same queued HTTP POST per message as notes (48 POSTs/s at 120 bpm, 1024-deep queue, off the CoreMIDI thread). The server stamps arrival and the estimator smooths, but the hop is not a precision clock transport; the reducer's outlier/duplicate handling is what makes it usable. If real-world jitter is bad, batching pulses per packet with a relative offset is the next step (not done — would be a bridge rewrite).
- Song Position Pointer seeks whenever received (Ableton sends it stopped, before Continue). It is applied even while running — acceptable for a DAW that only sends it stopped.
- Tempo lock needs 6 intervals (~¼ beat); until then the UI says "seed — not locked yet" and the transport runs at the authored bpm.
- Switching back to Manual does NOT copy the clock tempo into the authored bpm automatically (that would fight the show-owned tempo mirror); the button does it explicitly. In clock mode the authored `playing` flag is ignored by the host.
- Offline preview follows the clock only when this browser reads a WebMIDI port; with the native port selected offline the status is `waiting` (the browser has no clock), never a false "synced".
- Legacy (non-voice) host has no external clock; `midiClock` is a no-op there.
- Serialised through the stats stream at the existing 100 Hz interval; the store only assigns on a real change.

## Where things live

- `packages/core/src/engine/midi-clock.ts` (+ test)
- `packages/core/src/model/project-schema.ts`, `defaults.ts`
- `packages/protocol/src/schemas.ts`, `index.ts`
- `apps/server/src/voice-engine-host.ts`, `handlers/client-message.ts`, `http/native-midi.ts`, `main.ts`, `input-router.ts`
- `apps/desktop/src-tauri/src/native_midi.rs`
- `apps/web/src/lib/midi/webmidi.ts`, `trigger-lab/store/midi-clock.ts`, `trigger-lab/store.svelte.ts`, `app/chrome/MidiClockPanel.svelte`, `app/settings/panes/InputPane.svelte`, `ws/protocol-types.ts`
- `README.md`
