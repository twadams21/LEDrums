# Ableton track tap sources

**Regenerate and run the pure checks before handing these sources to Max.**

```sh
node integrations/ableton/generate.cjs                       # write the .maxpat and .amxd files
node integrations/ableton/generate.cjs --check               # fail if any generated file is stale
node integrations/ableton/generate.cjs --pack ~/Desktop      # hand-off folder for a tester
node --test --test-concurrency=1 integrations/ableton/*.test.cjs
```

**Status · 2026-09-20: generated, unfrozen Max for Live devices — never opened in Max or Live.**
`LEDrums MIDI.amxd` and `LEDrums Audio.amxd` are now real containers, not renamed JSON: the
generator writes the `ampf`/`meta`/`ptch` device wrapper described below, and `--check` fails when
the committed bytes drift from the generator. That is the only thing the change buys. These
commands still only write/check bytes and test JavaScript with synthetic values and injected
sockets. They do not open a UDP socket, launch any application, install anything, or access real
audio/MIDI. **A structurally valid container is not evidence that Max instantiates the device, that
Live loads it, or that its stored parameters/audio behave correctly in-host.** Nothing here has
been load-tested; treat the first Live open as the experiment it is.

## `.amxd` container format

A `.amxd` is a flat sequence of chunks. Each chunk is a **4-byte ASCII tag**, a **little-endian
`uint32` byte length**, and that many payload bytes. Lengths are bytes, never characters — the
generated patches contain `—`, `·` and `≤`, which are 2–3 UTF-8 bytes each.

| Tag | Length | Payload |
| --- | --- | --- |
| `ampf` | `4` | device type fourcc: `aaaa` audio effect, `mmmm` MIDI effect, `iiii` instrument |
| `meta` | `4` | little-endian `uint32`; see the unknown below |
| `ptch` | patcher byte size | patcher JSON as UTF-8, terminated with a single NUL byte |

An unfrozen device stores the patcher JSON directly. A **frozen** device stores an `mx@c` block
(patcher + `dlst` directory of bundled files) in the same `ptch` chunk, and an encrypted one adds a
`ciph` chunk; `amxd.cjs` refuses both by name rather than mis-parsing them.

Sources, cross-checked before relying on any of this:

- [`Ableton/maxdevtools` · `maxdiff/amxd_textconv.py`](https://github.com/Ableton/maxdevtools/blob/main/maxdiff/amxd_textconv.py)
  — Ableton's own reader, and the authority here: the chunk loop, the little-endian size, the
  `ampf` size of 4, the device-type table (plus `nagg`/`natt` MIDI tools), the `mx@c` frozen test,
  and the rule that a final NUL byte is stripped before the JSON is parsed.
- [`ktamas77/js2max` · `src/amxd/writer.ts`](https://github.com/ktamas77/js2max/blob/main/src/amxd/writer.ts)
  — same three chunks and fourcc table, written rather than read.
- [`Provokke/tether-m4l` · `tools/amxd.mjs`](https://github.com/Provokke/tether-m4l/blob/main/tools/amxd.mjs)
  — the same 32-byte `ampf`/`meta`/`ptch` header with an **unfrozen** JSON body.
- [`shakfu/py2max` · `docs/notes/amxd.md`](https://github.com/shakfu/py2max/blob/master/docs/notes/amxd.md)
  — derived byte-by-byte from two real Max-exported devices and verified by byte-for-byte re-pack:
  "NUL-terminated UTF-8 patcher JSON", and the `project` block Max requires.

**Unknown — the `meta` value.** Public writers disagree: `7` (js2max), `1`
(tether-m4l, [audiocontrol-org/audiocontrol](https://github.com/audiocontrol-org/audiocontrol/blob/main/modules/live-max-cc-router/scripts/create-amxd-binary.cjs)),
`0` ([pnomolos/live-wire](https://github.com/pnomolos/live-wire)). Ableton's own reader ignores the
payload entirely, and py2max's byte-exact fixtures carry **no `meta` chunk at all**. We write `1`
and accept any value, or a missing chunk, when reading. Only a real Live load can settle it.

### Patcher fields a device carries beyond a plain `.maxpat`

`buildPatch` adds `latency`, `is_mpe`, `external_mpe_tuning_enabled`, `minimum_live_version`,
`minimum_max_version`, `platform_compatibility`, `saved_attribute_attributes.default_plcolor` and a
`project` block, alongside the existing `openinpresentation` / `devicewidth`. The `project` block is
the load-bearing one — py2max reports that Max refuses a device without it ("a project without a
name is like a day without sunshine. fatal."). Its shape was confirmed field-for-field against a
real Max 9 MIDI-effect device
([`nathanturczan/Scale-Awareness-Bridge`](https://github.com/nathanturczan/Scale-Awareness-Bridge))
and matches py2max and live-wire exactly. `project.amxdtype` is the device fourcc read as a
`uint32`: that real MIDI device stores `1835887981` = `mmmm`; our audio device stores `1633771873` =
`aaaa`. Byte order is unobservable because all four bytes of every fourcc are identical.
`project.creationdate` / `modificationdate` are seconds since **1904-01-01 UTC** (classic Mac
epoch); the generator pins them to a fixed authoring date so the output stays byte-deterministic.

**Unknown:** the generated patchers carry no `appversion` block. Max stamps one into every file it
writes; inventing a version number would be a claim about a Max we have never run.

### Unfrozen devices depend on the files beside them

These devices are **not frozen**. `node.script` resolves `max-bridge.cjs` and its CommonJS
dependencies from the folder the `.amxd` sits in, so:

- moving or copying an `.amxd` on its own **breaks the script link** until the seven `SCRIPT_FILES`
  travel with it — which is what `--pack` exists for;
- Max's **Collect All and Save** collects patcher dependencies, not this JS set, and does not make
  the device self-contained;
- only a freeze pass inside Max bundles the transitive CJS files into the `mx@c` block. Until that
  pass, and until it is proved on a machine without this checkout, the devices are hand-off builds
  for a known tester, not a distributable.

The root `pnpm test` includes these Node tests. There is no new workspace dependency:
`max-api` is supplied by Max's `node.script` host and is explicitly external in `knip.json`,
not installed in LEDrums. The implementation follows the
[feasibility research](../../docs/research/2026-09-14-ableton-unreal-feasibility.md), with one explicit transport
choice overriding that research's stock-OSC recommendation: **`node.script` + versioned JSON UDP**.
The authority is [`track-input.ts`](../../packages/protocol/src/track-input.ts),
[`track-input-bridge.ts`](../../apps/server/src/track-input-bridge.ts) and
[`track-input-registry.ts`](../../apps/server/src/track-input-registry.ts), not this client copy.

## Send synthetic data to an isolated dev server

1. Use an already-running, isolated LEDrums dev stack (example ports): web **5294**, server **4394**,
   track bridge **4395**, physical output disabled and disposable project data. This sender does
   not start the server, disable its output, or change its project; those are preconditions.
2. Run a bounded synthetic session:

   ```sh
   node integrations/ableton/synthetic-sender.cjs --port 4395 --duration 60
   ```

3. Expect two `connected` lines: **`synthetic-track-midi`** and **`synthetic-track-audio`**. The
   former sends channel-1 note 38 press/release pairs and CC 74; the latter sends four independent
   normalized synthetic bands. Both send eight moving macros and repeat registration heartbeats.
   Select **Synthetic track Audio** explicitly in LEDrums Input settings for Audio nodes.
4. Let the duration finish, or use Ctrl-C/SIGTERM. Both sources submit best-effort `bye` and join
   their bounded local send drains before returning. This is not receipt confirmation (see
   [Shutdown](#shutdown)). A separate crash simulation can terminate the sender abruptly to check
   server lease expiry and note cleanup.

Single-source and collision fixtures:

```sh
node integrations/ableton/synthetic-sender.cjs --port 4395 --kind midi --id synthetic-snare-01 --name "Synthetic snare" --duration 30
node integrations/ableton/synthetic-sender.cjs --port 4395 --kind audio --id synthetic-bass-01 --name "Synthetic bass" --duration 30
node integrations/ableton/synthetic-sender.cjs --help
```

To test collision, run a second sender with the **same** ID and kind while the first is connected.
The second reports `duplicate-id` and exits unsuccessfully; it never chooses a replacement ID.
An intentional different `--id` creates a different source and does not repair the original's
mappings. After a crashed sender, an immediate restart may encounter the old 3-second lease.

The CLI has **no host argument** and hardcodes `127.0.0.1` for bind/send. It requires an explicit
nondefault `--port` (1024–65535, **4322 refused**). Duration defaults to 10 seconds, maximum one
hour. `--kind both` appends `-midi` / `-audio` to the ID and MIDI / Audio to the name; final names
and IDs must still fit the protocol. There are no scans, hardware APIs, OSC packets, project
edits, editor credentials, shell-command messages or remote callbacks. Registration is real
UDP, but the performance data is synthetic—not audio capture or a physical latency measurement.

## Files and regeneration

| Files | Responsibility |
| --- | --- |
| `generate.cjs`, `ledrums-midi.maxpat`, `ledrums-audio.maxpat` | Reproducible patch graphs, stored parameters and native Max controls. Change the generator, not generated JSON. |
| `amxd.cjs`, `LEDrums MIDI.amxd`, `LEDrums Audio.amxd` | Pure container writer/reader and the generated unfrozen devices. Change the generator, not the binaries. The `.amxd` variant's header label is the build tag; the loose `.maxpat` keeps the source warning. |
| `packets.cjs`, `session.cjs`, `midi.cjs`, `audio.cjs` | Exact bounded packet construction; injected-clock/send policy; byte-stream parser; stereo normalization/smoothing. No `max-api` or workspace dependencies. |
| `udp.cjs`, `device-runtime.cjs`, `max-bridge.cjs` | Loopback socket owner; injectable Max control bridge; tiny `node.script` entrypoint. Only the entrypoint imports Max-provided `max-api`. |
| `synthetic-sender.cjs`, `*.test.cjs`, `test-helpers.cjs` | Dev-only CLI and Node built-in tests with fake sockets/clocks/process/Max. Test helpers are not device runtime dependencies. |

Every runtime `.cjs` file is listed in both patches' dependency caches, using relative filenames
only, and `--pack` copies exactly that set beside the devices. The later packaging step must still
prove Max freezes **transitive `require()` dependencies**; a source manifest does not certify a
frozen archive. Do not include the tests, CLI, container writer or generator in the device's
runtime dependency set — `--pack` refuses to ship them. The CJS runtime targets Node 18+; pure checks here ran on
Node 25.8.2. Max's bundled Node version/extension loading must be confirmed during packaging.

## Source topology and controls

### MIDI tap

`midiin → midiout` is a **direct cord**, explicitly ordered before the copied tap branch:

```text
midiin ───────────────────→ midiout        instrument path, order 0
     └→ deferlow → prepend midi → node.script    copy only, order 1
```

Musical output is never reconstructed from JS or acknowledged by LEDrums. The parser retains at
most two data bytes; it handles channel 1–16, running status, partial messages, real-time byte
interleaving, native note-off/release velocity, velocity-zero note-on, and CC. It consumes unsupported
channel/system-common messages without inventing notes and ignores SysEx payload with constant
space. Program Change, pitch bend, pressure, SysEx and clock are **not** sent over this protocol;
any bytes Live actually supplies still follow the raw musical path. `is_mpe` is set in source, but
preserved received channels are not a promise of original hardware-channel identity. Live's MIDI
routing/MPE/message restrictions still apply. Existing selected-port clock policy is untouched.

The application-owned copy is FIFO for admitted notes/CC, not latest-note coalescing. Before
registration or while disconnected it drops input rather than queueing a later burst. It retains
no unbounded MIDI/SysEx/outbound event queue. **Max's own `deferlow`/IPC scheduling is not proved
hard-bounded by these JS tests**, and host/network overhead is not claimed zero.

### Audio tap

Both `plugin~` channels connect **directly** to their corresponding `plugout~` inlets. Parallel
analysis never feeds musical output. Each side is measured separately:

| Feature | Parallel MSP path |
| --- | --- |
| Level | Full-band → RMS |
| Bass | `cross~ 20` high output → `cross~ 250` low output → RMS |
| Mids | Above-250 branch → `cross~ 2000` low output → RMS |
| Highs | Above-2000 branch → `cross~ 12000` low output → RMS |

`dspstate~` updates the RMS window to `sampleRate × 0.020` samples, bounded 1–19200 (initial 960,
20 ms at 48 kHz). It limits the upper crossover to `min(12000, 0.45 × sampleRate)` below Nyquist.
These are approximate third-order crossover bands, not brick-wall filters. `qmetro 34` bangs eight
`snapshot~` objects in right-to-left order; Level-L fills `pack`'s hot inlet **last**, producing one
stereo four-band snapshot at no more than about 29.4 Hz. DSP stop stops the snapshot clock and
clears the feature frame. If snapshots stop without notice, the client stops resending after 500 ms
and server feature freshness clears it independently of the source-list lease.

`audio.cjs` combines each stereo pair as `sqrt((Lrms² + Rrms²) / 2)`—never waveform summing, so
opposite-phase stereo does not cancel. It applies the full-scale-sine convention:

```text
dBFS = 20 * log10(stereoRms * sqrt(2)) + 20 * log10(gain)
normalized = clamp((dBFS - floorDb) / -floorDb, 0, 1)
smoothed = previous + (normalized - previous) * (1 - exp(-dtMs / timeConstantMs))
```

Gain defaults **1** (0–4), floor **−60 dB** (−90…−20), attack **15 ms** and release **180 ms**
(0–1000). Zero time constants snap. Invalid/negative RMS is silence. Smoothed release may have a
tail. Only four normalized numbers leave the device; no waveform is recorded or transmitted.

Local analysis identifier: **`stereo-crossover-rms-v1`**, documented here rather than added to the
strict wire schema. **Calibration limitation:** filtered RMS is not the browser's FFT/Blackman
analysis. It does not copy the browser's +10 dB FFT correction, and band readings are not claimed
numerically interchangeable. The pure sine tests cover normalization/stereo/smoothing, **not**
Max's filters, actual sample-rate/window messages, host DSP timing, pass-through null tests or
automation timing. Filter/window/publication delays remain even with a direct audio cord.

### Identity, naming and macros

| Control | Persistence / behavior |
| --- | --- |
| Source ID | Individual `pattr`, Parameter Mode enabled, **Blob / Stored Only** (`parameter_type: 3`, `parameter_invisible: 1`), blank template. Never Hidden (`2`). Displayed in the device; generated only after restored state is ready. |
| Source name / UDP port | Editable with safe defaults **LEDrums MIDI / LEDrums Audio**, **4322**. Name is a stored-only Blob; port is a stored-only integer. Names are manual overrides, **not automatic Live Track-name observers**. |
| New identity | Explicitly generates/stores a fresh UUID. Required after duplicate-ID rejection. Save the Set/preset afterward; existing LEDrums bindings retain the old ID. |
| Macro 1–8 | `live.dial`, Float 0–1, **Automated and Stored**, immutable Long Names `LEDrums Macro 1` … `LEDrums Macro 8`. Latest value per dial, each published at ≤30 Hz, also refreshed once/second. |
| Analysis / telemetry | Gain/floor/attack/release are Stored Only; status/identity display and raw feature telemetry are not automated parameters. Meters cannot fill Live's Undo history. |

Source names must be 1–80 printable characters; IDs/nonces match `[a-zA-Z0-9_-]{8,64}`.
The blank distribution ID is not an author's UUID. The patch waits for **both** `live.thisdevice`
and Node's `ready`, bangs stored controls first, and sends `start midi/audio` last. Repeated ready
bangs after saving do not create a new runtime. A new Node lifetime creates one fresh UUID session
nonce; hellos, data, name/port changes, New identity and bye share a monotonically increasing safe
integer sequence. No filesystem identity cache or stored machine/host token is used.

Copying a device, track, preset or Set may copy its UUID. A conflicting registration is visibly
quarantined: **“Duplicate identity — click New identity, then save the Set.”** It sends no further
hello/data/bye for that claimed identity, even if the first device later disappears or the port/name
changes. It never silently steals an expired lease. Preset restoration can explicitly load a
*different saved identity*; that is not automatic clone detection. Save/reopen/duplicate/Undo behavior
still needs a later Live test. Automatic rack-aware Track-name discovery is deferred.

Controls use native Max/Live primitives and a single compact 169px presentation strip: setup and
status first, macros below, analysis controls alongside. No web UI or design-system files change;
the parent owns LEDrums' app interface/captures. Native rendering, text fitting and parameter
interaction remain unverified because opening Max/Live was prohibited.

## Exact wire and routing

The device sends UTF-8 JSON datagrams to **127.0.0.1:4322** by default. This is **not wire OSC**;
OSC addresses below are synthesized by the server after input validation. Device port is editable
within 1024–65535; no destination host can be edited. Example (UUID values illustrative):

```json
{"v":1,"t":"hello","id":"saved-source-0001","session":"runtime-session-0001","seq":0,"name":"Snare","kind":"midi"}
```

Every packet contains exactly `v:1`, `id`, `session`, `seq` plus one allowlisted body:

| `t` | Additional fields |
| --- | --- |
| `hello` / `bye` | Hello: `name`, `kind: "midi" | "audio"`; bye: none |
| `midi` / `cc` | MIDI: integer `note`, `velocity` 0–127, boolean `on`, integer `channel` 1–16. CC: integer `controller`, `value` 0–127, `channel` 1–16. |
| `audio` | Finite `level`, `bass`, `mids`, `highs`, each 0–1 |
| `macro` | Integer `index` 1–8, finite `value` 0–1 |

There is no capabilities field, timestamp, source host, callback URL, token or arbitrary command.
The strict server schema caps each packet at **2048 bytes**. The client repeats hello roughly
once/second, including after a late server start. The server replies to the sender socket:

```json
{"v":1,"t":"ack","id":"saved-source-0001","session":"runtime-session-0001","seq":0,"ok":true}
{"v":1,"t":"ack","id":"saved-source-0001","session":"runtime-session-0001","seq":0,"ok":false,"reason":"duplicate-id"}
```

Only bounded, recent outstanding-hello ACKs from the exact loopback server port and matching
ID/session/sequence are accepted. These ACKs prove **registration only**, not per-event delivery.
Data remains fire-and-forget; no old hit is replayed after reconnection. UDP loss/reordering and
local send success are not exactly-once delivery. Loopback reduces exposure but is not authentication;
these inputs confer no project editing or host/system authority.

### MIDI: existing global routing by default

Bridge MIDI/CC enters the existing global input map/channel filter and control bindings. Existing
reserved controls (including CC 0 recall) retain their behavior. Do not send the same performance
both through this tap and a native/WebMIDI/virtual LEDrums port: that double-ingresses the notes.
Use the additional source-specific namespace for independent per-track bindings:

| Address after `/tracks/<saved-id>/` | Intended use |
| --- | --- |
| `midi/<channel>/note/<note>` | **Press-only** OSC trigger source, normalized velocity; no event on release |
| `midi/<channel>/gate/<note>` | OSC **modulation** source: velocity while held, **0 on release/expiry**; not a strict Boolean |
| `midi/<channel>/cc/<controller>` | OSC modulation source: normalized CC |

Example: bind an OSC **trigger** to `/tracks/synthetic-track-midi/midi/1/note/38` for only that
source's snare presses. Bind an OSC **modulation** node to
`/tracks/synthetic-track-midi/midi/1/gate/38` for its held velocity. **Do not use the gate as the
press trigger:** ordinary OSC trigger graphs can fire on zero, including releases.

### Audio and macros: independently mappable

The existing **Audio** nodes use the one track explicitly selected in LEDrums **Input settings**.
Browser capture remains the default until a track is selected. For simultaneous independent tracks,
bind existing **OSC modulation** nodes to the per-track addresses:

| Values | Address |
| --- | --- |
| Four audio bands | `/tracks/<id>/audio/level`, `/tracks/<id>/audio/bass`, `/tracks/<id>/audio/mids`, `/tracks/<id>/audio/highs` |
| Eight macros, on either device | `/tracks/<id>/macro/<1..8>` |

These are continuous controls, not acknowledged cues. Initialization, refresh and zero values can
occur, so binding them as OSC triggers is **not** an initialization-safe cue scheme. No arbitrary
project mutation or DAW remote control is implemented.

The parent registry allows 32 sources, 512 events/second/source and 128 simultaneously held notes.
Source presence expires after about 3 seconds; audio freshness is 500 ms. The client publishes
continuous values at 34ms cadence, caps admitted MIDI/CC at **128 events/second**, and permits at
most **64 pending UDP sends**. Overload/send failure stops the entire tap lease with a best-effort
bye instead of dropping note-offs while continuing heartbeats. Status explains restarting the
Node bridge; raw musical pass-through remains direct. A collision never sends bye for the original
claimant. Graceful disposal uses `closebang`/signal termination for best-effort bye; abrupt crashes
rely on server cleanup. These limits do not establish end-to-end host scheduling guarantees.

## Shutdown

`transport.close()` **stops new send admission and incoming replies immediately**, then returns
one idempotent, non-rejecting promise. Accepted sends (including `bye`) retain the socket until
all their local completion callbacks run, or one **250 ms drain budget** expires. Even literal
loopback sends pass through asynchronous `dgram` lookup; closing at submission can cancel them.
The same budget bounds a missing close notification. A bind-pending close is attempted immediately
(no sends were admitted); if refused, late listening/error events retry disposal without reviving
readiness or admission. At timeout the socket is also unreferenced so a broken bind cannot hold
the process indefinitely. The budget is timer-based, not a hard real-time scheduling guarantee.

`device.dispose()` cancels publication, closes its session and **joins that same transport drain**;
repeated `dispose`/`closebang` calls join rather than starting another deadline. Ignoring the promise
is safe: the transport deadline stays referenced until settlement. Max's SIGINT/SIGTERM handlers
join disposal before their explicit `process.exit`, with no competing 100 ms exit timer. Repeated
signals cannot shorten the drain. The synthetic CLI joins both sockets concurrently on duration,
signal or failure; its injected `run(options, dependencies)` test seam resolves only after cleanup.

**A completed join is not UDP receipt or confirmed lease removal.** Callback errors, deadline
expiry, a full send queue, packet loss/reordering and abrupt host termination can still leave the
old lease until expiry; even a graceful fast reopen is not guaranteed to avoid quarantine.
External `process.exit()`, SIGKILL and crashes cannot await cleanup—the `exit` hook is best effort
only. The parent still owns actual isolated-server departure/reopen verification; these tests
prove local lifetime/order only, not Live/Max or network behavior.

## Later, human-authorized packaging and load test — NOT performed here

**Do not launch Live/Max now.** When separately authorized on a machine with Live Suite or
Standard + the licensed Max for Live add-on:

1. Hand off with `node integrations/ableton/generate.cjs --pack <folder>`. It writes
   `<folder>/LEDrums Ableton Devices/` holding exactly the two generated `.amxd` devices, the seven
   `SCRIPT_FILES` runtime files and `READ ME FIRST.txt` — no tests, CLI, generator or `.maxpat`. It
   creates and writes only; it refuses a folder that already holds anything and never deletes.
   Drag `LEDrums MIDI` onto a MIDI track ahead of the instrument, `LEDrums Audio` onto an audio
   track, and record what Max's Console actually says. If Max rejects the container or the patcher,
   the generator is wrong and the fix belongs in `amxd.cjs` / `buildPatch` — **not** in a renamed
   `.maxpat`, and not by hand-editing a binary. The fallback remains building the matching **Max
   MIDI Effect** / **Max Audio Effect** template in Live and transferring the generated patch's
   objects, connections and parameters into it; verify device type, presentation width, MIDI/MPE
   settings and both direct pass-through paths either way.
2. Keep all seven `SCRIPT_FILES` runtime files beside the working patch. Confirm `node.script`
   resolves `max-bridge.cjs`, CommonJS dependencies and Max-provided `max-api` using the bundled
   Node runtime. **No npm install is needed.** Verify each object's inlet/outlet and attribute
   semantics, RMS-size updates and the low-rate snapshot ordering inside Max.
3. Re-save from Max's device workflow and **freeze**; manage dependencies, explicitly checking the
   transitive CJS files were included. Generation here is unfrozen by design — a frozen device is
   made in Max, not by this generator, and a frozen file must then be regenerated by hand whenever
   the runtime changes. Keep the distributable identity Blob **blank**. Test a separate copy so the
   distributed template is not saved with the tester's identity.
4. On an authorized test setup, check load/save/reopen, presets/Undo, duplicate rejection + New
   identity, nested racks, node restart, naming/port persistence, automation, device bypass/removal,
   DSP stop/sample-rate changes, and server late startup/restart. Confirm channel/release/MPE
   behavior with the actual Live version. Measure MIDI pass-through and stereo audio transparency;
   calibrate synthetic tones, band edges, gain and timing. No real-hardware correctness is inferred.
5. Load the **frozen** `.amxd` on a second supported machine without this checkout. Only after that
   gate may the artifact be described as packaged/load-tested. Distribution/release is separate
   from adding these source files to the repository.

Primary documentation supporting the source/packaging distinction:
[Live Max for Live manual](https://www.ableton.com/en/live-manual/12/max-for-live/),
[Max filetypes](https://docs.cycling74.com/userguide/filetypes/),
[creating devices](https://docs.cycling74.com/userguide/m4l/live_creatingdevices/),
[sharing/freezing](https://docs.cycling74.com/userguide/m4l/live_sharing/),
[pattr in Live](https://docs.cycling74.com/userguide/m4l/live_pattr/),
[parameter visibility](https://docs.cycling74.com/userguide/m4l/live_parameters/),
[node.script](https://docs.cycling74.com/reference/node.script),
[licensing limitations](https://docs.cycling74.com/userguide/m4l/live_limitations/).

## Verification boundary

Pure checks cover exact generated JSON, exact container bytes (header per device kind, UTF-8 byte
lengths, nothing past the declared payload, round trip, refusal of truncated/bad-magic/overrun/
frozen/encrypted files), `--check` staleness, two-run byte determinism, the `--pack` contents and
its refusal to touch a non-empty folder, unique graph IDs and declared connection ranges, direct
musical topology, dependency closure, parameter storage/blank identity, byte parsing, normalized
stereo math, packet fields/limits, monotonic ordering, collision quarantine, restored identity,
bounded/coalesced publication, deferred local sends, missing send/close callbacks, bind-pending and
reentrant disposal, signal/explicit-exit drain joins and CLI safety. They do **not** exercise
Max's object parser, actual host parameter persistence, Max scheduling, real sockets against
LEDrums, real MIDI/audio/controllers, or any desktop app.

**The devices have never been loaded.** Nothing in this repository proves Max accepts the
container, that the `meta` value is right, that the `project` block is complete, that a missing
`appversion` is tolerated, or that `node.script` resolves the runtime files beside an unfrozen
device on Tim's machine. Those are open questions for the first real Live open, not claims. The
parent runs the real dev-server synthetic registration/render/expiry checks and captures serially.
