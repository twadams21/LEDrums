# Ableton / Unreal feasibility — implementation handoff

**Build two one-way Max for Live taps → LEDrums’ existing Node input boundary. Keep lighting generation in pure core and the stage preview in Three. Make Unreal an optional read-only viewer, not a dependency.**

Official documentation retrieved 2026-09-14; these are the pages as served, not historical snapshots. Scope comes from the user’s approved stage-preview, XYZ-effects, consistency and drop-on-track bridge work. Recommendations below are engineering proposals, not additional user decisions.

**Evidence boundary:** documentation research and brief repository inspection only. No Ableton, Max, Unreal, other desktop application, installer, hardware input or output was launched. No device was packaged or runtime-tested. Only this research document is changed by this task.

## 1. Ship direction and licensing

| Question | Finding / consequence |
|---|---|
| MIDI tap without interrupting the instrument? | **Documented viable.** A Max MIDI Effect receives through `midiin` and passes downstream through `midiout`. Put it before the instrument; tee the stream for analysis, retaining the direct pass-through. [MIDI effects][midi-effects] |
| Audio tap without interrupting sound? | **Documented viable.** The default Max Audio Effect connects `plugin~` to `plugout~`. Keep that stereo connection untouched and analyze a parallel branch. Placement determines whether it sees pre- or post-effect audio. [Live manual §31.3][live-manual] |
| Which Live edition? | Suite includes Max for Live; Standard requires the separately licensed Max for Live add-on. Intro does not include it; treat Intro/Lite as requiring an eligible upgrade, not a supported target for these devices. The documented supported pairing is **Suite or Standard + add-on**. [Live manual §31.1][live-manual], [edition comparison][editions] |
| Separate full Max license? | Do not require it for this ordinary MIDI/MSP design. Max for Live is not a standalone Max license: current docs restrict standalone operation and authoring some Gen/MC/Jitter features. Avoid those features in v1. `udpsend`/`udpreceive` explicitly still work; newer integrated OSC support does **not** work with M4L-only authorization. [Max for Live limitations][limitations] |
| Can we produce the artifact without opening Max? | We can author and structurally check **`.maxpat` JSON source**, not honestly certify a distributable `.amxd`. Official creation/distribution instructions use a Live device template, Save in Max, and dependency freezing. [Filetypes][filetypes], [creating devices][creating], [sharing devices][sharing] |

No audio loopback driver or virtual MIDI port is necessary for these *in-track* taps: their input is the device-chain input supplied by Live, not a separately opened system input. This does not make muted, unmonitored or otherwise unrouted tracks magically emit input. [MIDI effects][midi-effects], [Live manual][live-manual], [limitations][limitations]

## 2. Patch design the bridge implementer can use now

### MIDI device

1. **Preserve the raw path:** `midiin → midiout`, with explicit patch-cord/`trigger` ordering so pass-through happens before work on the tap branch. Never reconstruct the downstream performance from just parsed notes; that would discard other messages. [MIDI effects][midi-effects]
2. **Parse a copy:** `midiparse` separates notes, poly pressure, CC, program change, channel pressure, pitch bend and channel. Its seventh outlet reports channel. Use `hires 2` if retaining 14-bit pitch bend. `notein` is a simpler note-only alternative: velocity zero denotes note-off; `xnotein` is needed for release velocity. Forward the app’s supported note-on/off/CC events first; unsupported messages should still pass downstream. [midiparse][midiparse], [notein][notein]
3. **Treat channel as received metadata, not track identity.** Cycling’s M4L guide describes channel 1 as the conventional input, with explicit routing needed for other channels. The patcher’s `is_mpe` flag enables MPE reception; MPE channels represent per-note expression and are not reliable original-track identifiers. Preserve the received channel, but distinguish named tracks by bridge source identity. Do not advertise transparent original hardware-channel or unrestricted SysEx/clock/PC capture: Live limits the messages it passes between devices. [MIDI effects][midi-effects], [patcher `is_mpe`][patcher], [Live MPE settings][mpe], [limitations][limitations]
4. **Defer only the tap work.** Collect a complete event and defer its network branch, never the raw musical path. Keep event ordering and use bounded admission; do not apply audio-style latest-value coalescing to note-on/off pairs. MIDI messages can originate at high priority; `deferlow` queues at the tail of the low-priority queue and preserves sequencing. It is not a latency guarantee. [deferlow][deferlow]

For transport later, Max’s unnamed `transport` synchronizes to Live. That is a better documented starting point than assuming a track device receives MIDI Clock bytes. V1 should leave LEDrums’ current selected-port clock/manual timing policy alone. [M4L timing][timing]

### Audio device: Level / Bass / Mids / Highs

Keep `plugin~` left/right connected directly to corresponding `plugout~` inputs. DSP, gain and smoothing used for analysis must **not** sit on that pass-through. The MSP objects provide the necessary operations: `cross~` has low/high outputs from third-order crossover filters; `average~ N rms` computes RMS over samples; `snapshot~` converts a signal to periodic floating-point values. [plugin~][plugin], [plugout~][plugout], [cross~][cross], [average~][average], [snapshot~][snapshot]

**Proposed v1 measurement contract:**

| Feature | Analysis branch |
|---|---|
| Level | Full-band RMS |
| Bass | High-pass near 20 Hz, low-pass near 250 Hz → RMS |
| Mids | High-pass near 250 Hz, low-pass near 2 kHz → RMS |
| Highs | High-pass near 2 kHz, low-pass near 12 kHz, respecting Nyquist → RMS |

Use crossover outputs/cascades for the band branches; no FFT or external package is required for this approximation. Measure stereo channels separately and combine their **powers**, e.g. `sqrt((Lrms² + Rrms²)/2)`, rather than summing waveforms and cancelling anti-phase audio. That stereo rule and the cutoffs are proposed semantics, not Max defaults.

Match the existing app’s *units*: full-scale-sine convention `dB = 20·log10(rms·sqrt(2))`; analysis gain; clamp `[floorDb, 0] → [0, 1]`; silence/invalid values → zero; time-based attack/release. Current defaults are floor −60 dB, gain 1, attack 15 ms, release 180 ms. Choose an explicit RMS duration, derive its sample count from sample rate, and publish an atomic four-feature frame at about 30 Hz. These defaults/cutoffs come from [`apps/web/src/lib/audio/analysis.ts`](../../apps/web/src/lib/audio/analysis.ts), not an Ableton specification.

**Important consistency limit:** the browser currently sums FFT-bin powers with a Blackman-window calibration offset of +10 dB. Filtered RMS has different band-edge/window behavior. **Do not copy that +10 dB into the Max RMS branches or claim numerical parity.** Identify this analysis version and test normalization with synthetic tones. Exact cross-provider equality would require matching the analysis algorithm/window, not just sharing four labels. Analysis-window, filter and publication delay also remain even when the musical pass-through has no deliberately inserted delay. Live’s device delay compensation is for the audio path, not a promise to align an external lighting packet. [Audio-device latency][audio-devices]

## 3. Networking: safest v1 is stock OSC UDP, outbound only

**Prefer ordinary address + arguments → `deferlow` → `udpsend 127.0.0.1 <port>`.** The stock object serializes Max messages as OSC-compatible UDP packets; no CNMAT externals, OSCQuery server or npm install is needed for simple messages. Do not mistake JSON text for wire OSC. If later using `FullPacket`, it is transient and must not be stored in message boxes or `zl.reg`; defer ordinary values *before* packet construction. [udpsend][udpsend], [OSC guide][osc-guide], [M4L licensing limitations][limitations]

| Option | Use / constraint |
|---|---|
| Stock `udpsend` | Smallest v1 dependency/process footprint, especially for many track instances. Low-priority sending isolates it from the musical branch, **but the docs do not establish nonblocking/worst-case send latency**. Rate-limit/coalesce continuous values and use a numeric loopback destination. [udpsend][udpsend], [deferlow][deferlow] |
| `node.script` + built-in `dgram`/HTTP | Appropriate if a later authenticated connection or more involved transport is needed. `node.script` runs a separate Node process; Max↔Node execution is asynchronous and the full Node networking library is available. It bundles a Node executable. This adds process startup/memory per instance and a script dependency to package. No npm dependency is needed for Node UDP/HTTP. `@defer 1` affects messages **from Node into Max**, not every operation automatically. [node.script][node-script], [Node dgram][dgram] |
| Integrated parameter OSC / OSCQuery | Not the baseline: current M4L-only authorization excludes integrated OSC support, despite allowing the UDP objects. [limitations][limitations] |

Recommended bridge boundary (proposed contract, **not an existing protocol claim**):

1. **Register repeatedly:** send version, saved `sourceId`, runtime `instanceNonce`, kind (`midi`/`audio`), display name and capabilities on ready and roughly once/second. Registration is metadata, not an input hit. Repetition permits late app startup without a callback.
2. **Identify every event/frame:** carry source ID, nonce and sequence; features are one atomic frame. The Node receiver validates finite bounds, sizes and message types, stamps arrival with its own clock, and passes accepted data into the existing input/feature seams. Preserve FIFO note events; retain only the latest continuous sample per source. Sequence gaps are diagnostic, not permission to replay old hits.
3. **Keep source lifetimes explicit:** feature freshness should use the existing 500 ms policy independently per source; source-list presence can have a longer heartbeat lease. UDP loss is possible, so provide note-state cleanup on source expiry and do not promise exact-once cues. Handle delayed previous-session packets without letting them reclaim a new session.
4. **Keep authority in LEDrums:** use a dedicated loopback bridge endpoint or an equivalently restricted dispatcher, not unrestricted registration on the public/tailnet application API. Auto-registering an input must not grant editor, project mutation, host-event or desktop-command authority. No host-token scraping; no client-provided callback URL/port; no reverse API server in the device. Loopback is exposure reduction, **not authentication**. If stronger local authorization is required, use a separate scoped input capability rather than the privileged desktop host token.
5. **Avoid double ingress:** a track uses either this bridge or its separately routed native/WebMIDI input for the same performance. Do not also send bridge notes down a virtual LEDrums port and count both. Test wrong-version packets, floods, duplicates, reconnects and expiry with synthetic inputs and output disabled.

These are application design recommendations. UDP’s payload/MTU and send-queue considerations are documented by Node; bounded queues and freshness are LEDrums responsibilities, not services supplied by OSC. [Node dgram][dgram]

**Existing local seams inspected:** [`architecture.md`](../../.mex/context/architecture.md), [`audio-midi-inputs.md`](../../.mex/patterns/audio-midi-inputs.md), [`protocol schemas`](../../packages/protocol/src/schemas.ts). Current `audioFeatures` is a flat four-value message **without source identity**. The parent’s named-source bridge must extend/translate that boundary; merely sending four new OSC addresses does not create independent Audio graph sources. Core must remain IO-free and engine-owned freshness must survive browser disconnects.

## 4. Automatic naming, saved identity and copy collisions

**Naming is feasible using the Live API; persistent unique instance identity needs our own policy.**

- Initialize API access from `live.thisdevice`, not ordinary `loadbang`. Its ready bang also occurs on preset load/device save, so setup must be idempotent. Resolve `this_device` and walk `canonical_parent` to the containing **Track**, then observe its `name`. A rack-nested device can have a Chain parent: inspect the object type and keep walking rather than assuming one parent hop is always the track. Track name is observable; allow a stored display-name override. [live.thisdevice][thisdevice], [Live API overview][live-api], [Track][track]
- Live API object IDs are device-local and **not stored** across reload. Track indexes and names can change. The `---` prefix makes Max named objects device-local when initialized; it is useful for internal sends/receives, not a documented durable external ID. [Live API IDs][live-api], [Ableton production guidelines: naming][production]
- Persist a generated UUID in an individual `pattr` with **Parameter Mode Enable**, **Blob** type and **Stored Only** visibility. Store the optional display-name override similarly. `autopattr` alone does not register values with Live. **Hidden visibility loses persistence.** Generate only when the restored ID is empty; ship a blank ID in the distribution template, not the author’s populated ID. [pattr in Live][live-pattr], [parameter types/visibility][parameters], [limitations][limitations]

**Copy policy — a required design decision, not solved by UUID generation alone:** assume device/track/preset copies can retain the stored UUID. The reviewed docs provide no guaranteed persistent clone-distinguishing ID or supported “this is a duplication, mint anew” callback. Do not equate a ready bang with a new logical source.

For v1, generate a fresh **runtime nonce per actual device lifetime**, keep it across network reconnects, and detect competing live `(sourceId, nonce)` claims. Quarantine/report a new conflicting claimant instead of mixing its values into the original source. Provide a device-side **New input identity** action that generates/stores a new UUID; leave the original source’s mappings untouched. The app cannot repair a device’s saved identity over a deliberately one-way link. Fully automatic clone repair is a later, separately validated design; source-code checks cannot establish save/duplicate/undo behavior in Live.

## 5. Effect/cue automation without remote control of Live

Expose a small fixed bank of `live.dial`/`live.numbox`/toggle parameters with stable unique **Long Names**, Float 0–1 where appropriate, and visibility **Automated and Stored**. Live automation/clip envelopes drive their outputs; the device sends those values outward. LEDrums maps `(sourceId, parameterKey)` to existing modulation targets. No `live.remote~`, plugin host or reverse callback is necessary for Live → LEDrums automation. Long Names are also parameter recall identities; changing them breaks old saved values. [parameters][parameters], [Ableton production guidelines: automation/updates][production]

Keep identity/settings **Stored Only**, continuous telemetry **not stored/automated**, and user-authored control parameters **Automated and Stored**. Otherwise meters can fill the Undo history. Choose an explicit update limit for continuous automation. [production][production], [live.dial][live-dial]

**Cues should follow, not block, v1 input registration.** Proposed cue semantics: an explicit enabled gate plus a rising-edge action, unique event sequence and no firing from initialization/preset restoration. Do not replay queued cues on reconnect. Start with existing engine-owned MIDI/OSC recall intents, not arbitrary graph/project mutations. UDP duplicate suppression is possible; guaranteed delivery is not. If reliable cue acknowledgement becomes a requirement, add a scoped device-initiated connection, not arbitrary server-initiated callbacks. Scrubbing, looping and automation chase semantics remain Live tests.

## 6. Source we can author now ≠ a proven drop-in device

Cycling lists `.maxpat` as JSON Patcher and `.amxd` separately as Ableton Live Max Device. Ableton says AMXD files are stored separately from Sets; distribution should freeze dependencies, including JS/abstractions. A rename of `.maxpat` to `.amxd` is **not** the documented conversion path. No supported headless AMXD creation/freezing workflow was established in the official docs reviewed. [filetypes][filetypes], [Live manual §31.3/31.5][live-manual], [creating][creating], [sharing][sharing], [production][production]

| Allowed now: source-level evidence | Still unverified; requires later human authorization |
|---|---|
| Generate JSON patch source, known object names/attributes, presentation metadata and parameter definitions. | Max accepts the patch, instantiates every object and restores every parameter. |
| Validate JSON, unique object IDs, connection endpoints/known inlet-outlet ranges, direct pass-through topology and included dependency paths. | Live recognizes the correct device type; a saved/frozen `.amxd` loads on another machine without missing files. |
| Test extracted normalization/serialization/identity logic with synthetic inputs; test actual Node receiver and engine behavior without a DAW. | Real MIDI channel/MPE handling, note-off/release behavior, actual audio transparency and end-to-end timing. |
| Test simulated duplicate IDs, restart and stale-input transitions against LEDrums dev server only. | Save/reopen, device/track duplication, rack nesting/moves, presets, Undo, bypass, frozen tracks, automation, offline rendering and multiple running Live instances. |

**Deliverable label now: “Max for Live patch source — not yet packaged or verified in Live.”** Later packaging is a human-authorized release gate, not a reason to launch Max during this task.

## 7. Unreal: optional viewer first, GPU engine only as a separate experiment

### Read-only consumer — feasible and lower-risk

The existing [`SerializedModel`](../../packages/protocol/src/index.ts) already carries ordered world positions in **mm**, tangents, normals, segment lengths and drum ranges; the app has a separate binary frame channel. Use that model plus the **server-generated RGB frames**, not a new Unreal drum geometry/effect implementation. Epic’s C++ `IWebSocket` supports text and binary reception. Its OSC plugin supports messages/bundles in Blueprint or C++ and client allowlisting, useful for sparse control metadata; WS avoids designing a new multi-datagram RGB assembly protocol. [IWebSocket][unreal-ws], [OSC plugin][unreal-osc]

Proposed viewer rules: explicit unit/axis conversion; preserve pixel order; rebuild geometry only on model change; tag/pair frames with model revision if the current stream lacks that guarantee; discard mismatches; latest-complete-frame backpressure. Use a **server-enforced read-only subscription**, not an ordinary editor connection that happens not to send commands. GPU instancing/emissive materials and optional bloom can improve presentation without moving LED rendering authority. Viewer stalls/disconnects must never stall core or Art-Net/sACN. This is a proposed adapter, not a tested Unreal integration.

### GPU-generated LED effects — possible, but not a free performance win

A GPU experiment would upload XYZ once, evaluate a material/compute field at **LED coordinates**, produce a compact RGB buffer, then transfer it back to the CPU for existing network output. Screen-space effects alone do not define physical pixel values.

Epic explicitly labels `UKismetRenderingLibrary` render-target read helpers **“incredibly inefficient and slow.”** Do not loop `ReadRenderTargetPixel` once per LED. RHI instead exposes fenced staging readback via `FRHIGPUMemoryReadback`: `EnqueueCopy`, `IsReady`, `Lock`, `Unlock`. [render-target API][render-lib], [RHI readback][readback]

Recommended experiment: bounded double/triple-buffered readbacks; enqueue now, poll later, consume only ready buffers; record originating engine time/frame/model revision and never wait for the GPU on LEDrums’ render tick. This introduces pipeline age/jitter that must be measured; an asynchronous API does **not** guarantee same-frame completion. CPU/GPU math and feedback behavior also need deterministic/parity tests before replacing core effects. No p95 latency, CPU saving or old-Mac improvement is established here.

### macOS / Intel versus Apple GPU caveat

Pin an Unreal version and exact OS/GPU before choosing features. The official **5.6** macOS page as served during this research lists Sonoma 14.0, minimum 16 GB RAM, recommended 32 GB and M3, and minimum M1/M2 depending on rendering features. It also says macOS Editor distribution is universal and code plugins need universal binaries. **Universal architecture packaging is not a promise that every old Intel Mac meets the current editor/rendering requirements.** [UE 5.6 macOS requirements][unreal-mac]

Its feature table separately lists:

- Software Lumen / Temporal Super Resolution: Intel/AMD-based Apple computers and/or Apple Silicon M1+.
- Nanite / Virtual Shadow Maps: Apple Silicon **M2+**, **beta**.
- Hardware-ray-traced Lumen / MegaLights: Apple Silicon **M2+**, **experimental** in the currently served table.

The table’s Intel feature entries coexist with its Apple-Silicon minimum-processor recommendation; do not resolve that into blanket Intel support. Nor should older statements that macOS hardware ray tracing is wholly unsupported override the currently served experimental qualification. Version selectors are not immutable historical snapshots. [UE macOS requirements][unreal-mac]

**Keep the v1 Three preview and CPU fields as the baseline.** Assess an optional Unreal viewer with a modest renderer before enabling Lumen/Nanite/TSR. Any claimed improvement needs matched input traces, kit/voice counts, preview resolution, power/thermal state and exact Intel/Apple GPU. Measure engine tick p50/p95, missed output deadlines and input-to-frame age separately from viewer FPS. GPU beauty/features on an M-series machine cannot establish performance consistency on the older Mac.

## Next implementation order

1. Finish the parent’s named-source ingress with collision/freshness isolation, synthetic fixtures and no privileged callbacks.
2. Author the two stock-object `.maxpat` sources; pin the four-feature algorithm/version and small automation bank.
3. Verify source structure and synthetic bridge → engine → existing preview behavior; label it **source-only**.
4. Defer human-authorized Live packaging/acceptance and optional read-only Unreal adapter. Do not launch either here.

## Official source URLs

All external citations are vendor-owned manuals, API references or Ableton’s official production guidelines. Repository links above describe local implementation only.

[live-manual]: https://www.ableton.com/en/live-manual/12/max-for-live/
[editions]: https://www.ableton.com/en/live/compare-editions/
[limitations]: https://docs.cycling74.com/userguide/m4l/live_limitations/
[midi-effects]: https://docs.cycling74.com/userguide/m4l/live_midieffects/
[midiparse]: https://docs.cycling74.com/reference/midiparse/
[notein]: https://docs.cycling74.com/reference/notein/
[patcher]: https://docs.cycling74.com/reference/patcher/
[mpe]: https://www.ableton.com/en/live-manual/12/editing-mpe/
[timing]: https://docs.cycling74.com/userguide/m4l/live_timing/
[plugin]: https://docs.cycling74.com/reference/plugin~/
[plugout]: https://docs.cycling74.com/reference/plugout~/
[cross]: https://docs.cycling74.com/reference/cross~/
[average]: https://docs.cycling74.com/reference/average~/
[snapshot]: https://docs.cycling74.com/reference/snapshot~/
[audio-devices]: https://docs.cycling74.com/userguide/m4l/live_audiodevices/
[udpsend]: https://docs.cycling74.com/reference/udpsend/
[deferlow]: https://docs.cycling74.com/reference/deferlow/
[osc-guide]: https://docs.cycling74.com/userguide/osc/
[node-script]: https://docs.cycling74.com/reference/node.script
[dgram]: https://nodejs.org/api/dgram.html
[thisdevice]: https://docs.cycling74.com/reference/live.thisdevice
[live-api]: https://docs.cycling74.com/userguide/m4l/live_api_overview/
[track]: https://docs.cycling74.com/apiref/lom/track/
[live-pattr]: https://docs.cycling74.com/userguide/m4l/live_pattr/
[parameters]: https://docs.cycling74.com/userguide/m4l/live_parameters/
[live-dial]: https://docs.cycling74.com/reference/live.dial
[production]: https://github.com/Ableton/maxdevtools/blob/main/m4l-production-guidelines/m4l-production-guidelines.md
[filetypes]: https://docs.cycling74.com/userguide/filetypes/
[creating]: https://docs.cycling74.com/userguide/m4l/live_creatingdevices/
[sharing]: https://docs.cycling74.com/userguide/m4l/live_sharing/
[unreal-ws]: https://dev.epicgames.com/documentation/en-us/unreal-engine/API/Runtime/WebSockets/IWebSocket
[unreal-osc]: https://dev.epicgames.com/documentation/en-us/unreal-engine/osc-plugin-overview-for-unreal-engine
[render-lib]: https://dev.epicgames.com/documentation/en-us/unreal-engine/API/Runtime/Engine/UKismetRenderingLibrary
[readback]: https://dev.epicgames.com/documentation/en-us/unreal-engine/API/Runtime/RHI/FRHIGPUMemoryReadback
[unreal-mac]: https://dev.epicgames.com/documentation/en-us/unreal-engine/macos-development-requirements-for-unreal-engine?application_version=5.6
