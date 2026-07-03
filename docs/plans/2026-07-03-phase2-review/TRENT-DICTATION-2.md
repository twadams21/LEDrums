# Trent dictation #2 — 2026-07-03 (Phase 0 kickoff)

Captured faithfully from Trent while kicking off the Phase 0 plan-vs-reality audit. Extends `HANDOFF.md` (items A–I). These are observations from live use of the app on `rock-solid` — treat every bug below as reproduced-by-Trent, not speculative.

## Trigger graph — bugs observed live (feeds item A)

- **Node cards look good** (keep the look) — but **modifier handle placement isn't great**.
- **Wire physics weirdness:**
  - When a wire is released, the curve **changes slightly** (drag-preview vs committed path mismatch).
  - **Duplicate wires** can be created between the same ports.
  - **Selection of some wires doesn't work.**
  - **Hover states inconsistent** across all graph elements.
- **Node XY position is buggy / not reliable.**
- **Z / stacking order** of wires and nodes **changes based on what is selected** — wrong.
- **Adding nodes drops them in the middle of the screen, overlapping** — "yuck".
- **Node-add corruption:** adding a modifier/modulation node once **semi-replaced an existing Delay node**; the node was broken and had to be deleted. (Feeds the item-A add/insert edge-case review.)
- **Determinism distrust (feeds item B):** nodes with the **exact same settings, playing a different hoop on the same drum, can look different** → "I don't trust the parameters in those cases."
- **Thumbnails: generic and free-looping** rather than reactive to the actual trigger(s) (feeds item G — TouchDesigner-style live-on-trigger).

## Trigger graph — design directions (to explore/explain, some may need a short grill)

- **Trigger-started envelopes:** consider wiring a **trigger input into a modulation effect (envelope mainly)** so it begins on that trigger, and a **delay input** to shift when the envelope starts. (Extends item C's temporal model.)
- **Zoom/fit/lock palette** needs UI/UX work.
- **Add palette could be changed completely.** The **modal on the modifier/modulation add buttons is liked** — keep that pattern.
- **Drag-and-drop-to-add** may make more sense than click-to-add (we already have DnD; also eliminates the stacked-on-add problem). Implies a **chrome rethink** — maybe a **sticky right slide-over drawer**.
- Trent also wants the graph's **node-interaction semantics explained** (e.g. what happens when multiple modifiers are chained together) — the behaviour must be understandable, not just implemented.

## Inspector (applies to BOTH Trigger graph and Patch graph)

- **Too vertically short.** Consider a **full-height right rail** or a **slide-over sticky drawer**.
- **Bug: inspector sometimes doesn't follow the newly selected node** — you have to click the node again; very confusing when it doesn't match the active selection.

## Component / design-language unification (feeds item D)

- Standing preference confirmed: **icons + tooltips, never text labels** for controls.
- **Three different title styles exist** for the same class of thing: (a) the visualiser "Kit preview" title, (b) the **tabbed inspector/monitor** header, (c) the "Views" title + Section titles in the trigger graph's section rail. **The tabbed design wins** — its size, accent flash, and icon size (doesn't need to be tabbed everywhere; the scale/treatment is what's right). Unify.
- The **overall scale of the app needs review** (ties into item D scaling).
- **The logo sucks** — needs a redo.

## Regressions

- **The Share button (cloudflare tunnel) has disappeared from the top bar.** Find what removed/unmounted it and restore.

## Design north star

- The UI is **very important** to Trent; he is highly opinionated about it.
- **Linear-inspired** — continue leaning into that approach.
- **As dark as Resend** (which is Linear-like with coloured icons, pills, badges).

## New tooling initiative — agent UI verification (pre-req for the P2 design pass)

Build a really good way for agents to **view their UI changes and verify them**: confirm the change works, added what it was meant to, removed nothing it shouldn't. Shape:

- A set of **reusable scripts / a CLI wrapper** around Playwright or Puppeteer, **headless**.
- Agent specifies a **route, page, or section** to capture.
- **Token cost of capturing screenshots must be as low as possible** — reusable scripts, not per-session bespoke headless-chrome driving.
- (A prior agent hand-rolled headless chrome; that per-session cost is what this eliminates.)

## Wave-3 reframe (Trent, post-audit)

- Wave 3 must be a **thorough design critique and improvement**, not lifting a few things: too many things are inconsistent or off screen.
- **Information density is wrong in both directions:** the app is too small to view on a small screen, yet displays too few pieces of information without scrolling. Density/scale is a first-class review axis, not polish.
- "One render truth" confirmed as the item-B direction (collapse the throwaway web sim onto the core engine rather than re-seeding it).

## Phase 0 status at capture time

- 7 haiku Explore agents dispatched to reconcile groups A/B/E/F/G/H/I/J/K + side-tasks vs the actual wired code, plus sweeps: determinism suspects, self-referential `$effect` recurrence, Share-button archaeology, thumbnail time-source inventory, graph-UX bug code location, title-style inventory, modifier/modulation chaining semantics.
- Live-app verification (dev server smoke) happens after the code-level audit lands.
