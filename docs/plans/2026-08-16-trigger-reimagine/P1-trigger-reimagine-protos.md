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
