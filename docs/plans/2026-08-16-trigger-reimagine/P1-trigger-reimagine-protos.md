# P1 — Trigger view reimagined: divergent HTML prototypes

**Requested by Trent (this machine, 2026-08-16).** You are a UI prototyper doing divergent
design exploration. This is throwaway prototype work — no app code changes, no tests. The
deliverables are standalone HTML files Trent will click through, judge, and record verdicts on.
Refinement and promotion into the real app come later, feature by feature.

## Base and branch

- Branch **off `fix/webkit-colormix-transparent`** (`a6e8533`) — the top of PR stack #185, so
  you see all six in-flight PRs' work (tabbed chrome, graph list, settings sections, segments
  effect, colour fix). The stack may merge to main while you work; irrelevant — your files are
  standalone.
- Work on a new branch `proto/trigger-reimagine`. Everything you produce lives in
  `docs/proto/` + this plan directory.

## The four feature areas

Each area gets its **own self-contained HTML file** presenting **2–4 genuinely divergent
options** (not one idea at three polish levels — different mechanisms). Use the
`/divergent-variants` skill's discipline: force each option from a different reference point.

### 1. On-canvas controls — `docs/proto/trigger-canvas-controls.html`
Some basic controls should move onto the graph canvas itself instead of living only in the
inspector. First decide *which* controls are candidates by reading the real trigger view
(`apps/web/src/lib/app/views/`, `apps/web/src/lib/trigger-lab/`) — think: the params you touch
constantly (life/decay, speed, colour swatch, mute/solo, fire-to-test). Then diverge on *where
and how*: e.g. controls embedded in the node card itself, a contextual floating cluster near
the selected node, an edge/wire-attached mini-control, a canvas-corner HUD. Mock a believable
mini graph-canvas (node cards in the real app's style) as the stage.

### 2. Inspector as a right slideover drawer — `docs/proto/trigger-inspector-drawer.html`
The inspector moves into a right-side slideover. Diverge on behaviour, not just looks:
overlay vs push, peek-strip vs fully hidden when closed, pinnable vs auto-dismiss, how it
behaves on node-select vs canvas-click, width regimes. Show the open/close motion (CSS
transitions are enough) — the *feel* of the slideover is the thing being judged.

### 3. Effect inspector layout rethink — `docs/proto/trigger-effect-inspector.html`
Today every effect exposes its own flat param list. The goal: a **common section shared by
all effects** (the params ~every effect has) + an **effect-specific section** below/beside it.
Ground the common set in reality: read `packages/core/src/effects/metadata.ts`, `registry.ts`
and a handful of `impl/*.ts` to find which params actually recur (hue/saturation/brightness,
life/decay, speed, direction…). Diverge on the organizing structure: e.g. fixed common header
+ scrolling specifics, tabbed common/specific, progressive disclosure ("advanced" fold),
mixer-channel-strip metaphor. Populate with 2–3 real effects (e.g. comet, segments, confetti)
so switching effects demonstrates what stays put and what changes.

### 4. Envelope-by-default for life/decay — `docs/proto/trigger-envelope-param.html`
Trent's seed idea, verbatim: life/decay/similar params become an **envelope by default**. It
could look like *a slider with 2 handles; clicking a handle selects it and you can change the
profile of that handle; if you select a time-based envelope, the handle splits into 2 (start
and stop)*. He suspects there are patterns to borrow from **Lightroom / Adobe interfaces —
levels and gradients** (histogram levels with in/out points, gradient stop editors). He is
explicitly unsure — present a few options and think creatively.

Before designing, research the canonical patterns (house rule: envelopes are domain-standard
UI): ADSR editors, DAW automation lanes, After Effects speed graphs, gradient stop editors,
Lightroom tone-curve/levels. Options should span at least: (a) Trent's two-handle slider with
per-handle profile selection, (b) a gradient-stop-style editor, (c) a mini curve/graph editor.
**These must be interactive** — draggable handles, clickable profile selection, a live decay
preview (e.g. a pulsing bar or ring that replays the envelope) — the interaction is the design
question.

## Style contract

- **Design language: the drum-elevation prototype.** Read the committed
  `docs/proto/drum-elevation.html` and match its register — dark technical-drawing feel,
  panel chrome, annotation style, and its **verdict panel** pattern: every file ends with a
  per-option verdict panel where Trent can mark a winner and leave notes (persist to
  localStorage like the original).
- **One deviation: DM Sans replaces whatever sans the proto used** — DM Sans is now the app's
  UI sans. Load via Google Fonts `<link>` with a system-ui fallback; protos may use the network.
- Self-contained files otherwise: no build step, vanilla JS, open-in-browser works.
- Real vocabulary: use actual node kinds, effect names, and param names from the repo — no
  lorem-ipsum controls. `PRODUCT.md` gives the brand register (engineered, expressive, fast).

## Done means

1. All four files committed on `proto/trigger-reimagine` and **pushed** (docs-only; the full
   gate sweep still applies to committed HEAD — it should pass untouched).
2. This plan file updated with a one-paragraph map: per file, each option's name + one-line
   pitch + the reference point it was forced from.
3. Report to your parent via SendMessage: sha, file list, and for each feature which option
   YOU would bet on and why (one line each). Trent judges; your bet is signal, not a decision.

## Fences

- No changes outside `docs/proto/` and `docs/plans/2026-08-16-trigger-reimagine/`.
- Do not touch the app, the design system, or `docs/proto/drum-elevation.html` itself.
- No screenshots/ui-shot needed — these are static files, open them in a browser yourself to
  sanity-check interactions before pushing.

---

# Option map (delivered 2026-08-16, branch `proto/trigger-reimagine`)

Four self-contained files in `docs/proto/`. Open any of them with `file://` — no server, no build.
Each ends with a localStorage-backed verdict panel (radio = winner, textarea = notes per option;
"Clear verdict" wipes the key). Note one deviation from the brief: `drum-elevation.html`'s verdict
panel is static prose with a blank to fill in — it does **not** persist. These four implement a real
persisted panel, which is what "persist to localStorage like the original" was asking for.

### 1. `trigger-canvas-controls.html` — which controls leave the Inspector, and in what shape

Opens with a **candidate table** derived from the real view before proposing any layout: colour
(hue/sat/bri), decay/life, speed, chance %, delay time, modifier bypass — each with its source file.
Play mode / layer are listed and rejected. "Fire to test" is included and explicitly marked
**ASSUMED** — there is no `fireNode`, mute or solo anywhere in the trigger store on `main`; it comes
from the brief, not from the code.

| Option | Pitch | Forced from |
| --- | --- | --- |
| **1 · Face Params** | Two or three params promoted into the node card's own footer slot — the one the card already uses for modulation rows. Always visible, no selection needed. | The app's own `NodeCard` footer + an Ableton device rack: the control lives on the device. |
| **2 · Satellite** | Cards ship unchanged; selecting a node floats a small param cluster beside it that follows the selection and dissolves on canvas click. | Figma's floating selection toolbar — chrome that exists only while something is selected. |
| **3 · Wire Tap** | Chance / delay / bypass stop being node properties and become draggable pills **on the wire**. Drag sideways to scrub, click to open in place. | Max/MSP patch cords + Blender reroute nodes — the edge as a first-class editable object. |
| **4 · Corner HUD** | One translucent panel pinned to a canvas corner, retargeted by selection, never moving. Positional muscle memory instead of spatial. | A hardware transport / DaVinci-style corner inspector — a fixed cockpit, not floating chrome. |

### 2. `trigger-inspector-drawer.html` — which slideover

Includes today's docked Node Editor as **baseline 0** so each option is judged against the thing it
replaces. Ends with a behaviour matrix (canvas geometry / node-select / canvas-click / what "closed"
shows / occlusion / Escape / width / where the Add palette goes). Drive each stage: click a node,
click empty canvas, toggle the pin, press Escape.

| Option | Pitch | Forced from |
| --- | --- | --- |
| **0 · Docked** (baseline) | What ships: permanent full-height panel, two tabs, resizable, never closes. | The app as merged — the control, not an option. |
| **1 · Auto Overlay** | Closed means gone. Node-select opens it *over* the canvas (no reflow); canvas click or Escape dismisses. Selection **is** the open state. | A mobile sheet / Gmail's contextual side panel — summoned by content, dismissed by tapping away. |
| **2 · Peek Rail** | Collapses to a 44px rail that still names the selected node. Pin toggles the mechanic: pinned **pushes** the canvas, unpinned **overlays** and auto-closes. | VS Code's activity bar + Linear's issue panel — a persistent edge that is a control, not a wall. |
| **3 · Focus Panel** | Selection does nothing; you summon with Enter / double-click into a 460px panel over a scrim. Select and edit stop competing for one gesture. | Notion's peek modal / Figma "open in full" — editing as a mode you enter. |

### 3. `trigger-effect-inspector.html` — common section + effect-specific section

Opens with the **counted** derivation, not an assumed one: across the 45 generators in
`packages/core/src/effects/impl/`, `saturation` 49, `brightness` 49, `hue` 40, `speed` 30, then a
cliff. The decay/life family is 16 declarations in four spellings (`decayMs`/`lifeMs`/`lifeBeats`/
`life`) across three units — flagged as the case that makes this a core change, not a UI change. The
hue caveat is called out too: a common colour block bound to `hue` silently skips Confetti Burst
(`baseHue` + `hueSpan`) and Temp Sweep (`warmHue`). One effect switcher at the top drives all four
panels, populated with real paramSpecs from comet-trails, radial-wash and confetti-burst, so you can
watch what stays put and what changes.

| Option | Pitch | Forced from |
| --- | --- | --- |
| **1 · Fixed common header** | Colour · Time · Motion pinned and never scrolled away; the effect's own params scroll underneath. | An Ableton device header / a console's fixed strip top. |
| **2 · Tabbed** | Common / This effect / Node as full-height panes; the tab persists across effect switches. | Photoshop's Layer Style dialog / devtools panes. |
| **3 · Channel strip** | A module rail — common modules in fixed slots, effect modules below a divider; content on the right. | A mixing-console channel strip: fixed slots, swappable contents. |
| **4 · Progressive disclosure** | One list, common on top, effect params in a fold that remembers its state, filter box above both. Degrades without a core rename. | macOS System Settings / Blender's collapsible panels. |

### 4. `trigger-envelope-param.html` — life/decay as an envelope by default

Frames what is being replaced (`velocity · exp(−ageMs / decayMs)`, one scalar) and what already
exists (`EnvelopeEditor.svelte` → `EnvelopeEditorView`, geometry in `envelope-editor-geom.ts` — a
480×160 **opt-in modal**, i.e. a good editor in the wrong place). All four are drawn inside a mock
param row at Inspector width, all sample from one transport (Fire / Loop / Life 10–4000 ms), and each
draws today's `exp(−t/τ)` as a dashed ghost so you can see what you are beating. Every widget drives
a live preview: a drum's four hoops glowing at Whole Drum's "Punch" hue, plus a meter and a ms
readout.

| Option | Pitch | Forced from |
| --- | --- | --- |
| **A · Two-handle rail** | Trent's shape, built: one rail over the hit's life, a start handle and an end handle, each owning a **named profile** — and picking a *timed* profile (Hold) visibly splits that handle into a start marker and a stop marker. | The brief, verbatim — a 2-handle range slider where the handle owns a profile. |
| **B · Gradient stops** | The life is a live gradient band; stops sit under it, click the band to add, drag a ◇ **midpoint** to bias the curve between two stops without bezier handles. | The Photoshop / Figma gradient editor. |
| **C · Mini curve** | The existing ADSR editor shrunk into the row: breakpoints, click-to-add, double-click to remove, per-segment easing. | FM8 / After Effects speed graphs — and the app's own `EnvelopeEditorView`, miniaturised. |
| **D · Levels** | Keeps the exponential, adds three handles to reshape it: in-point, gamma triangle, out-point. The current scalar is a valid state of it (in 0, γ 1, out 1), so nothing migrates. | Lightroom / Photoshop Levels — reshape a distribution, don't author one. |

Canonical-pattern research before designing (house rule for domain-standard UI): ADSR stage editors
(Omnisphere's simple↔complex switch when an envelope exceeds four stages; FM8's multi-breakpoint
drawable curve with loopable sections), gradient stop editors, Lightroom levels. Sources —
[Omnisphere ADSR controls](https://support.spectrasonics.net/manual/Omnisphere/edit_page/envelopes/page02.html),
[FM8 envelope editor](https://www.adsrsounds.com/fm8-tutorials/fm8s-powerful-envelopes/),
[AudioNodes ADSR envelope editor](https://www.audionodes.com/docs/adsr-envelope-editor/).

### Verification

Not screenshot-gated (static files), but each file was loaded headless (Chromium via
`playwright-core`), driven through its interactions — every card, chip, tab, module button, fold and
the envelope transport — and checked for console errors: **all four clean**. Three defects were found
and fixed that way: node-card titles ellipsising at 176px (the real `NodeCard` grows to fit a
thumbnail, so the mocks are drawn at 208px), the drawer mock's canvas silently scrolling sideways
because a closed drawer at `translateX(100%)` is real overflow inside an `overflow:hidden` shell, and
option B's gradient band sitting on top of its own plot instead of above it.
