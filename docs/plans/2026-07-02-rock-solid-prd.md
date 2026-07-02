# PRD: Rock Solid — reliability + feature initiative

> Context layer: **`docs/plans/2026-07-02-rock-solid/`** (INDEX + docs 01–11). Every requirement
> below has a section doc with verified mechanisms, file/line anchors, module designs, touch
> lists, test plans, and locked decisions. Implementation agents MUST read the INDEX plus their
> slice's doc(s) — nothing should need re-discovery. All product decisions were locked with Trent
> on 2026-07-02; the only open items are two minor UX details in doc 11.

## Problem Statement

The app is cool, but the operator doesn't trust it enough to run a live show. Specifically:

- I can't tell whether MIDI/OSC messages are actually being received, or whether Art-Net/sACN
  data is actually reaching my PixLite controller — the app can say "LIVE" while output silently
  fails.
- The desktop app shows a separately-styled loading screen that presents share URLs/PINs at the
  wrong times (including mid-update, when the PIN is about to die), and updates download with no
  visible progress from either place that can trigger them.
- Firing feels wrong: hits produce extra/duplicate events, and the routing is harder to reason
  about than "a message either fires a graph directly or acts as a drum trigger."
- Section changes fire base effects that I can't author anywhere, and they show in the bus layers
  but not the visualiser.
- Effects can't make white (hue-only controls), enum settings are stuck at defaults, some
  thumbnails are broken, and triggered effects don't restart from their start position — a
  trigger just unmasks a free-running loop.
- The envelope editor pins attack at the top and links all curves; there's no way to reuse an
  envelope, drive a parameter from MIDI CC, or add post-processing looks (grain/bloom/trail).
- The linked-preset mode is confusing and broken-feeling; songs are trapped inside one show; and
  I can't author on my own dev server and move work across to the drummer's server.
- Small layout frictions (no resize rail between visualiser and inspector; no way to flip a drum
  or mirror the kit) and one scary bug: the trigger graph once went blank mid-edit until refresh.

## Solution

Make the server engine the single authoritative resolver/renderer when connected (the web sim
becomes an offline-preview adapter), surface the confidence data that already flows (plus the
PixLite Mk3 management API for controller-side verification), collapse the desktop shell into
in-app token-styled boot/update UI with real progress, fix the echo-loop and keyboard firing
bugs, implement section looks in the engine with a per-bus authoring UI, overhaul effect
parameters to full colour + enums, give effects a declared timebase so triggers restart them,
introduce modifier nodes and a modulation system (Envelope/LFO/CC nodes → per-param mappings on
target nodes), replace linked presets with explicit reuse, add a canonical Song Library +
Setlist, add clipboard portability across servers, add the layout/geometry conveniences, and
harden the trigger-graph view so it can never silently blank again.

## User Stories

Actors: **rig-builder** (authors content, configures IO/kit), **performer** (plays the show),
both usually the same person at different times.

### IO confidence + PixLite (doc 01)
1. As a rig-builder, I want the output pill to reflect real transmission state (armed/dry-run/disabled, packets flowing, last error), so that "LIVE" can never lie while Art-Net silently fails.
2. As a rig-builder, I want a controller/output status panel showing packets/s, universe count, and the last send error, so that I can diagnose output problems without reading the Monitor log.
3. As a rig-builder, I want the app to discover my PixLite A4 Mk3 on the LAN and show its name, model, firmware, and IP, so that I don't have to hunt for its address.
4. As a rig-builder, I want one click to adopt the discovered controller's IP into my output settings, so that misconfigured hosts stop being a failure mode.
5. As a rig-builder, I want the app to read the controller's own per-universe receive stats (receiving? good/bad packet counts, active priority, source), so that I can verify end-to-end that my data is arriving.
6. As a rig-builder, I want controller health readouts (temperature, voltages, per-port fuse/current status, output frame rate), so that I can catch hardware problems before the show.
7. As a rig-builder, I want an "identify" button that flashes the controller's LED, so that I can physically find the right unit.
8. As a rig-builder, I want to run the controller's built-in test patterns (colour/cycle per port/pixel) with a loud UI warning that live data is suspended, so that I can verify physical wiring without the engine — and never forget I've done it.
9. As a rig-builder, I want a "last heard" activity indicator beside every MIDI/OSC binding (note/address, value, how long ago), so that I know a binding actually works after I set it.
10. As a rig-builder, I want to see the list of connected MIDI devices (with hot-plug updates), so that I know the browser sees my hardware.
11. As a performer, I want unrouted inputs (a hit that matched nothing) to appear in the Monitor, so that dead pads are diagnosable mid-rehearsal.

### Desktop shell + updates (doc 02)
12. As a performer, I want the desktop app to boot straight into one app surface with boot status rendered in the app's own design language, so that there is no second-looking screen.
13. As a performer, I want share URL/PIN shown only when the app is fully running, so that I never share a PIN that an update restart is about to invalidate.
14. As a rig-builder, I want a real progress bar (percentage) while an update downloads, in both the settings dialog and the boot overlay, so that I know something is happening.
15. As a performer, I want updates to be fully in-app — a badge/toast when one is available, install only when I choose, never an auto-restart — so that an update can never interrupt a show.

### Input routing (doc 03)
16. As a performer, I want one hit to produce exactly one authoritative fire (no local double-fire, no echo re-fire), so that what I see matches what I played.
17. As a performer, I want computer-keyboard triggering to send explicit "fire this graph" intent rather than synthetic MIDI, so that keyboard hits can't multiply through re-resolution.
18. As a rig-builder, I want a trigger node whose MIDI/OSC source is also zone-mapped to a drum to show a link icon with a tooltip naming that drum/zone, so that deliberate both-firing is visible instead of mysterious.
19. As a rig-builder, I want local-sim preview firing to work when the server is offline and stand down when connected, so that offline authoring still gives feedback without double-rendering live.

### Section looks (doc 04)
20. As a rig-builder, I want a per-bus "look" picker on each section (which effect loops on base/trigger/effect buses while the section is active), so that section base effects are authorable, not fixture-hardcoded.
21. As a performer, I want section changes to start looks in the real engine, so that the visualiser, the bus layers, and the physical kit always agree.

### Effect properties + envelope shapes (doc 05)
22. As a rig-builder, I want saturation and brightness controls on every colour-producing effect, so that I can make white and pastels.
23. As a rig-builder, I want enum parameters (wash mode, wipe axis, etc.) editable in the inspector, so that effects stop being stuck on hidden defaults.
24. As a rig-builder, I want a colour swatch that writes through to hue/saturation/brightness sliders that each remain modulatable, so that I can set colours fast and still sweep them.
25. As a rig-builder, I want envelopes with a movable attack level and independent per-segment easings (Resolume-style easing set), so that attack isn't pinned at the top and curves aren't linked.

### Effect timebase + thumbnails (doc 06)
26. As a performer, I want triggered effects to start from their start position and restart on retrigger, so that a chase always launches from the hit instead of unmasking a spinning loop.
27. As a rig-builder, I want base/ambient loop effects to keep free-running, so that section looks don't all snap to phase zero.
28. As a rig-builder, I want every effect thumbnail to animate representatively (firing and decaying), so that the gallery is trustworthy.

### Effect modifiers (doc 06)
29. As a rig-builder, I want modifier nodes (Trail, Echo, Bloom, Sparkle, Grain, Strobe, Pixelate, Mirror, HueShift, Saturation/Levels/Invert, and a growing second wave), so that I can post-process any effect for full creative expression.
30. As a rig-builder, I want to wire one modifier node into many play nodes via a distinct mod input handle, so that one Bloom setting drives many effects.
31. As a rig-builder, I want explicit modifier chaining (mod→mod→play) with parallel wires ordered by node position, so that processing order is visible and deterministic.
32. As a rig-builder, I want to bypass a modifier without unwiring it, so that A/B-ing a look is instant.

### Modulation system (doc 10)
33. As a rig-builder, I want Envelope, LFO, and CC-In nodes in the graph, so that one modulation source can drive many parameters across many effects and modifiers.
34. As a rig-builder, I want target nodes to expose an initially-empty list of mappable parameters — each added parameter appearing as its own labelled row with its own type-scoped input handle — so that wiring a modulation is unambiguous and self-documenting.
35. As a rig-builder, I want per-mapping amount, invert, and range edited on the target node only, so that there is exactly one place to look.
36. As a performer, I want a MIDI CC fader to vary any mapped parameter live (all voices, continuous), so that I can perform lighting intensity/colour by hand.
37. As a rig-builder, I want LFOs with waveform choice and free-Hz or musical-division rates, so that modulation can lock to the song tempo.
38. As a rig-builder, I want each modulation node's face to preview its signal (envelope curve with live phase cursor, LFO waveform with phase, CC live value bar), so that I can see what every source is doing over time.
39. As a rig-builder, I want my existing per-node envelopes migrated automatically into envelope nodes with identical behaviour, so that old shows keep working.

### Presets + Song Library (doc 07)
40. As a rig-builder, I want the linked/instance mode gone — every node owns its params, presets become Apply/Save-as snapshots — so that an edit can never mysteriously change other nodes.
41. As a rig-builder, I want a canonical Song Library above shows: setlists reference library songs (with full dependency closure), and editing a library song updates it everywhere, with a detach-to-local-copy escape hatch.
42. As a rig-builder, I want deleting an in-use library song to be blocked with a list of the shows using it, so that a setlist can never dangle.
43. As a performer, I want the vocabulary to be "Song Library" and "Setlist" throughout, so that the model matches how musicians talk.

### Clipboard portability (doc 11)
44. As a rig-builder, I want to copy a trigger graph, a section, or a whole song to the system clipboard and paste it into a session on a different server, so that I can author offline on my own dev server and move work across.
45. As a rig-builder, I want pasted content re-keyed automatically with identical-content reuse, so that copy A→B→A round-trips create no duplicates.
46. As a rig-builder, I want to copy/paste the patch (kit geometry + routing + IO settings) behind a confirm dialog that diffs what will change, so that moving a rig config is possible but never accidental.

### Layout + geometry (doc 08)
47. As a rig-builder, I want a drag rail between the visualiser and the inspector in the right dock (size persisted), so that I can balance the two panes.
48. As a rig-builder, I want a per-drum flip toggle (top/bottom skins swap, chase direction corrected), so that an upside-down-mounted drum is a one-click fix.
49. As a rig-builder, I want a kit-level mirror (X or Y), so that a stage-left/stage-right setup swap is a one-click fix.
50. As a rig-builder, I want flips/mirrors to change geometry only — never the pixel output order — so that layout fixes can't re-patch my hardware.

### Trigger-graph hardening (doc 09)
51. As a rig-builder, I want graph editor faults (failed wire gestures, projection errors) caught, reported to the Monitor, and self-healed by a rebuild, so that the canvas can never silently blank until a refresh.
52. As a rig-builder, I want a visible "stale node" placeholder instead of an empty card if node data ever fails to resolve, so that a fault is diagnosable the moment it happens.

## Implementation Decisions

All decisions below are LOCKED (details + rationale in the referenced context docs).

- **Authority principle** (docs 03/04): when the engine link is open, the server engine is the
  only resolver/renderer; the web sim fires only offline. The input echo broadcast remains for
  display/learn but never fires the sim. Keyboard triggering becomes a new explicit
  fire-graph client message. Pad-path + direct-binding both-fire is KEPT, surfaced by a
  drum-link indicator on trigger nodes and matching hints in the zone/source inspectors.
- **Section looks** (doc 04): the engine implements look spawn/release on section recall,
  structurally mirroring the sim's reference behaviour; the authored section model gains a
  per-bus looks map bridged into the engine; the Layers dock reads server voice state when
  connected.
- **PixLite** (doc 01): new PixLite client module behind an interface in the io package
  (HTTP/WS JSON, strict member ordering, sequential request queue), with an in-memory fake as
  the second adapter; a server-side controller-monitor service polls read-only stats (1–2s while
  Monitor/Patch is open) and emits a new controller-status message plus monitor events. v1 scope:
  discovery (subnet /ver probe), adopt-IP, rx verification, health, identify, test patterns
  (with loud takeover state). Config-write deferred. Controller identity persisted on the server
  Project.
- **Desktop** (doc 02): the bundled shell page reduces to a dumb bootstrap (spinner + fatal
  error) with token values injected at build; boot/update/share UI renders in the main web app
  via a deepened desktop-bridge module subscribing to the existing boot-status event stream; the
  Rust boot status gains a structured progress-percent field; the native update dialog is
  removed; share info gates on the running stage.
- **Effect params** (doc 05): the param value type widens to include enum strings; the
  spec-mapping seam maps all four param types (number/bool/enum/colour) instead of dropping
  colour/enum; a registry-wide pass gives every colour-producing effect hue/saturation/brightness
  (numeric, modulatable) with a write-through swatch in the inspector; the audit table
  (effect × params before/after) is an implementation deliverable.
- **Envelopes** (docs 05/10): the shape gains attackLevel + per-segment easing (standard easing
  set, family-grouped UI); shape code becomes single-sourced in core with the web importing it;
  the legacy single-curve field migrates behaviour-preservingly. Envelopes live as graph nodes
  (see modulation); the shape editor becomes the envelope node's inspector.
- **Timebase** (doc 06): effect generators declare `timebase: voice | absolute` in the registry;
  the generator bridge feeds voice-timebase effects hit-relative time (and voice-local beat);
  ~15 free-running effects convert; mono voice steal resets birth time; thumbnails drive a
  looping synthetic trigger age; web render bridge mirrors identically.
- **Modifiers** (doc 06): a new modifier registry in core (pure per-modifier apply over a
  framebuffer range); modifiers are graph NODES wired to a distinct mod input handle on play
  nodes (edges gain a target-port field); one modifier feeds many play nodes (shared params,
  per-voice state); chains via mod→mod wiring, parallel order by node y-position; the full listed
  set ships and the registry is designed to keep growing; voices carry the resolved chain,
  applied between generator render and blend.
- **Modulation** (doc 10): Envelope/LFO/CC-In node kinds; target nodes (play AND modifier) carry
  an initially-empty exposed-params list; each exposed param renders as its own node-face row +
  scoped input handle (target-port `param:<key>`); mappings (amount/invert/range, summed and
  clamped) are edited target-side only; envelope = per-voice phase (restarts per hit), LFO =
  deterministic function of time+bpm (free Hz or musical divisions), CC = engine-held value table
  fed by queued CC events (determinism preserved); inline per-node envelope maps are migrated to
  nodes and removed; node faces preview their signals via the shared thumbnail ticker
  (reduced-motion aware). LFO ships in the first cut.
- **Presets/Library** (doc 07): the linked flag is removed via a materializing migrator; presets
  become Apply/Save snapshots; a Song Library persistence document (client + opaque server blob,
  same pattern as the show library) holds canonical songs carrying their dependency closure;
  shows hold references with detach-to-copy; deletion of in-use library songs is blocked;
  vocabulary = Song Library + Setlist everywhere.
- **Clipboard** (doc 11): one versioned ClipDoc envelope (graph/section/song/patch) over the
  system clipboard; parse is defensive and never throws; paste re-keys through the id-reservation
  discipline with identical-content reuse; patch paste uses a new bulk set-project message
  (schema-validated, applied once) behind a diff-confirm dialog; closure extraction is shared
  with the Song Library module.
- **Geometry** (doc 08): per-drum `flip` and kit-level `mirror` fields applied inside the pixel
  model build as pure reflections (geometry only — pixel index order and DMX map bytes provably
  unchanged); the drum inspector gains the flip toggle; kit mirror control on the Patch view
  toolbar; the latent pixels-per-hoop forwarding gap on the legacy path is fixed in passing.
- **Graph hardening** (doc 09): instrument-first — error boundaries on all flow event handlers
  (report to Monitor, reset projection cache, force rebuild), exception-safe cache lifecycle,
  dev-mode desync assertion, and stale-node placeholder rendering; the ranked root-cause
  candidates guide the follow-up fix once telemetry convicts one.
- **Process**: every UI-touching slice applies the `/make-interfaces-feel-better` skill on top of
  the Impeccable design context (now a non-negotiable in AGENTS.md). Non-negotiables hold: core
  stays pure, IO behind interfaces, deterministic render loop, fire-and-forget outputs.
- **Dependency order**: 03 → 04; 05 → 06(modifiers, builds wiring infra) → 10; 06(timebase) →
  thumbnails; 07A(remove linked) → 07B(library) → 11; 01/02/08/09 independent (09 lands first,
  it's instrumentation). 05/06/10 are one first wave.

## Testing Decisions

Good tests here exercise **external behaviour through a seam** — input events in, frames/
diagnostics/persisted-state out — never implementation internals. Confirmed seam strategy:

- **Core engine seam** (highest; prior art: the existing 200+ core tests incl. golden-frame and
  determinism suites): routing precedence and single-fire counts, section look spawn/release,
  param/colour output (saturation-0 ⇒ white), timebase restarts, modifier chain application and
  ordering, modulation sampling (envelope phase, LFO determinism, CC table), migrator parity
  (pre/post behaviour sample-identical) and idempotency, flip/mirror geometry goldens with
  byte-equal DMX maps.
- **Server handler seam** (prior art: existing server tests with fake sockets/monitor sinks):
  fire-graph message, set-project validation + single apply, controller-status emission from a
  fake PixLite adapter, update-status endpoint, monitor event counts per hit.
- **Web store + pure-slice seam** (prior art: existing store/persistence/projection tests and the
  jsdom component infra): all migrators, Song Library closure/ref/detach/guard, ClipDoc
  serialize/parse/remap round-trips, projection cache hardening, wiring validation (never
  throws), pane-size persistence.
- **New seams, each with two adapters**: PixliteClient (real HTTP/WS + in-memory fake; fixture
  JSON from the API doc), desktop-bridge (Tauri adapter + null/browser fake; update-state
  reducer), clipdoc (pure module; clipboard and future file export are adapters).
- UI components stay thin over these seams; component tests only where the existing jsdom infra
  applies (inspectors, node cards, placeholder rendering). A consolidated live spot-check pass
  (browser + real hardware) is budgeted at the end — several behaviours (wire feel, PixLite
  against real hardware, update progress) are only provable live, and prior initiatives' owed
  spot-checks fold into it.

## Out of Scope

- PixLite config-WRITE (network/pixel-port changes from the app) — explicitly deferred to a later
  slice; v1 is read-only + identify + test patterns.
- File-based export/import of ClipDoc envelopes (trivial later adapter over the same format).
- Audio-level and velocity as modulation sources (the source registry is designed for them;
  Envelope/LFO/CC ship first).
- Second-wave modifiers beyond the listed extended set; the registry keeps growing post-initiative.
- Legacy (non-voice) engine feature parity — voice mode is the shipping engine; legacy gets only
  the pixels-per-hoop forwarding fix.
- The "Graphs" renaming exploration (Cue/Gesture/Reaction) — vault-only for now.
- Broader UI redesign work not named here (the Impeccable `/craft` track continues separately).

## Further Notes

- The context docs are the contract: each PRD slice brief should name its doc(s) and forbid
  re-derivation of decided questions. Line anchors in the docs may drift — re-anchor by symbol.
- Two open UX micro-decisions live in doc 11 (paste-song destination dialog; clipboard-permission
  fallback) — decide during that slice, both options are cheap.
- The blank-nodes bug (doc 09) is deliberately instrument-first: its hardening also protects
  every new node kind this initiative adds (modifiers, modulation sources, param rows), so it
  should land before the graph-model slices.
- Determinism is a test target throughout: same input log ⇒ same frames, including CC-driven
  modulation (CC values arrive as queued events, never sampled ambiently).
