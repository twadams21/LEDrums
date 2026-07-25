# Slice — #139: LEDrums must be advertised as a MIDI destination and ingest what Ableton sends

You are the implementer for the highest-value open item in this repo. Branch from current `main`
(`8f7ec3f`) as `fix/midi-advertise-139`.

## The requirement (Trent's words, 2026-07-26)

> LEDrums is advertised on the mac, and can be selected as an output target in Ableton so that
> midi messages that Ableton sends out are ingested by the server correctly.

This supersedes the framing in GitHub issue #139 ("needs a live session with the drummer"). It does
**not** need the drummer, and it does not need his hardware. Ableton is *not* installed on this
machine — see "How to prove it" for the sound proxy.

## What is already true

`apps/desktop/src-tauri/src/native_midi.rs` is correct in architecture. It uses
`midir::os::unix::VirtualInput::create_virtual("LEDrums", …)`, which on CoreMIDI creates a virtual
**destination** — precisely what a sender like Ableton lists as an output target. Received messages
are translated to JSON and POSTed to the sidecar server's `/api/native-midi`, which is implemented
and unit-tested (`apps/server/src/http/native-midi.ts`).

So the port type is right and the ingest endpoint exists. The break is in **when the bridge starts**.

## The confirmed defect — start-up is gated on scraping a log line

`apps/desktop/src-tauri/src/lib.rs:408-413` starts the bridge only when **both** `listening_seen`
**and** a parsed `host_token` have been observed on the sidecar's stdout:

```rust
if !native_midi_started && listening_seen {
    if let Some(token) = host_token.as_deref() { start_native_midi(&app_handle, port, token); … }
}
```

`host_token` comes from `parse_host_token`, a regex over the line `Host token: …`. The server only
emits that line conditionally — `apps/server/src/boot.ts:76`:

```ts
if (deps.hostToken) console.log(`  Host token: ${deps.hostToken}`);
```

**Therefore: whenever the sidecar runs without a host token, the line never prints, and the virtual
`LEDrums` destination is never created at all.** Nothing appears in Ableton, nothing can be
selected, no MIDI can arrive. The comment immediately above that block even anticipates the
tunnel-less case ("no token/PIN will ever print") but the code does not handle it.

This is a fail-open guard in reverse: a missing optional log line silently disables a core feature.

**Your first job is to establish the truth, not to accept mine.** Determine under which real
configurations `deps.hostToken` is unset for the desktop sidecar. If it is always set in the shipped
desktop path, this is a latent bug rather than the drummer's bug — say so plainly in your report and
keep hunting for what else stops the port appearing. Either way the coupling must go: **starting a
MIDI port must not depend on scraping a conditional log line.**

## Scope

1. **Decouple bridge start-up from the host-token scrape.** The bridge should come up once the
   sidecar is listening. The token is only needed to authenticate the POST — get it to the bridge by
   a means that does not depend on a log line existing (the desktop side can know or generate it, or
   the bridge can acquire it lazily/retry). Design this properly; do not paper it with a timeout.
   If a token genuinely cannot exist in some configuration, decide and document what the endpoint
   does then — do not create an unauthenticated hole.
2. **Make the failure loud.** Today `start` errors go to `eprintln!` only. A drummer whose port
   failed to appear gets silence. Surface it through the existing monitor/telemetry path so it is
   visible in the app, consistent with `apps/server/src/http/native-midi.ts`'s error monitor event.
3. **Verify ingest correctness end to end**, not just port creation: note-on, note-off, CC and
   program change, and channel numbering. Note `midi_message_json` maps channel as `(status & 0x0f)
   + 1` (1-based) — confirm that matches what the server and the rest of the pipeline expect, and
   that a note-on with velocity 0 is treated as note-off (it already appears to be).

## How to prove it — the harness is the deliverable

Ableton cannot be driven here, so use the fact that **Ableton and `midir::MidiOutput` read the same
CoreMIDI destination list** (`MIDIGetNumberOfDestinations`). A sender that can see and open
`LEDrums` is exactly what Ableton does when you pick it as an output target.

Build a real integration test (Rust, in `apps/desktop/src-tauri`, `midir` is already a dependency at
0.11.0 — add what you need as a dev-dependency):

- Start `NativeMidiBridge` against a **stub HTTP server** on a loopback port that records the JSON
  bodies it receives. You do not need to boot Tauri or the real sidecar for this.
- From a second `midir::MidiOutput` in the same test, enumerate ports, **assert `LEDrums` is
  present**, connect to it, and send real bytes.
- Assert the stub received the right JSON for each message type, in order.
- Cover the queue-full drop path and the port disappearing on `Drop`.

**Prove it fails first** (`/honest-tests`): construct the pre-fix condition — a sidecar that never
prints `Host token:` — and show the port is absent / the test red **before** your fix, then green
after. Record the observed failure output in the commit body. A regression test that never failed
proves nothing.

Then do one whole-app check: run the desktop app and confirm from a separate process that `LEDrums`
appears in the CoreMIDI destination list, and that a message sent to it reaches the server.

## Out of scope

- OSC from Ableton (needs Max for Live; a separate concern from the MIDI destination).
- The WebMIDI-vs-server-CoreMIDI architecture decision — that is issue #109. Do not relitigate it.
- Anything in `packages/core`.

## Gates

`pnpm typecheck` and `pnpm test` green, plus `cargo test` and `cargo clippy -- -D warnings` in
`apps/desktop/src-tauri`. Then `twux push`. Do not open a PR until the gates pass on committed HEAD.

## Environment traps — these have cost real time before, do not rediscover them

- **Never run a repo-wide test sweep while Trent is at the machine.** Concurrent `pnpm test` runs
  once spawned 16 vitest processes and wedged the Mac. Prefer `pnpm --filter <pkg> test`.
- **Vitest caps must be set in MIN/MAX pairs**, always all four:
  `VITEST_MIN_THREADS=1 VITEST_MAX_THREADS=2 VITEST_MIN_FORKS=1 VITEST_MAX_FORKS=2`.
  Setting only the MAX makes vitest 2.1.9 throw "minThreads and maxThreads must not conflict" and
  report *no tests, exit 1* — which looks exactly like a broken suite.
- **Verify every push landed**: `git rev-parse --short HEAD` vs `origin/<branch>`. A `git push`
  inside a `| tail -1` pipeline silently did not land once and cost a full CI cycle.
- **Running the app**: `infisical run --env=dev -- sh -c 'LEDRUMS_TELEMETRY=on LEDRUMS_ENGINE=voice pnpm dev'`.
  The server binds `PORT` (default 4321) and ignores `LEDRUMS_WS_PORT`; stop any other dev server
  first or you get `EADDRINUSE`.
- **Secrets**: never print or echo `LEDRUMS_TELEMETRY_TOKEN` or any Infisical value. If one is
  missing, report the *name* only.
- Killing a stray process: find the specific pid via `lsof -ti :PORT`. Do not use `pkill` patterns.

## Report

When you reach a verdict, `twux send-message --session parent --status <done|blocked|failed>` with
the real report: the sha, what you found about the host-token hypothesis (confirmed or refuted),
what shipped, the observed pre-fix failure output, any deviations, and how Trent can verify it
himself in Ableton.
