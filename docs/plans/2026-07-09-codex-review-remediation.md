# Codex-change review & remediation plan — 2026-07-09

**Range reviewed:** `6c9f79f5..HEAD` on `codex/gen3-graph-authoring` (~40 commits, 127 files, +8.4k/−0.8k) — the Gen3 graph-authoring batch (Add pane v2, Scope inspector, Slice, Mix, sections drag-and-drop, stabilisation, render-plan compiler) plus OTA fixes.
**Method:** five parallel review agents (graph UI polish · effect picker + drag-and-drop · wiring semantics vs core · PixLite diagnosis · code health), findings verified on the main thread, trivial fixes dispatched to twux implementation agents in the same session.
**Related:** issue #79 (Gen3 typed active-route render plan — implemented in `6cef34e`; this doc builds on it), `docs/ui-shots-hardening-2026-07-08.md` (implementation in flight this session).

## Verdict in one paragraph

The batch's **architecture is good and its UI is unfinished**. Core Gen3 semantics (render-plan compiler, output-gated eval, scope intersection, Mix collectors) are sound, deterministic, and match the #79 PRD — no blocking correctness bug found. On the graph surface, the review initially flagged the commented-out wire/handle colour CSS in `GraphCanvas.svelte` as an unfinished refactor — **correction from Trent: the wire-edge de-colouring is deliberate (wires stay grey)**; the handle treatment and dead-CSS cleanup were settled directly with the fix agent. Beyond that, the new surfaces are *functionally* correct but thin on affordances (no drop indicators, no drag cursors, no lint/warning surface, flat inspectors), and the render-plan compiler computes every warning a confused user would need — **nothing in the web app consumed any of it**.

---

## 1. Already fixed this session

Dispatched to a twux opus implementation agent (branch `codex/gen3-graph-authoring`); status/commits recorded at the end of this doc.

| # | Fix | Files |
|---|-----|-------|
| 1 | **Graph canvas cleanup per Trent's direction** (wire edges stay grey by design — the de-colouring was Trent's own change, not codex leftovers): dead commented-out CSS removed, handle treatment as agreed in-pane, handle `aria-label`s naming what each port accepts | `GraphCanvas.svelte`, `TriggerNode.svelte` |
| 2 | **Broken tokens in the gold-standard Scope UI**: `--surface-1` (doesn't exist) killed the hoop-number chip background; `--danger` (doesn't exist) left the empty-scope error readout uncoloured (app red is `--live`) | `ScopeHoopPreview.svelte:188`, `ScopeNodeInspector.svelte:173` |
| 3 | Inspector markup hygiene (stray blanks, broken indentation) | `Inspector.svelte` |
| 4 | **Modulation-source inspector regression**: envelope/LFO/CC/note/OSC/random nodes lost their role headers ("Envelope source" etc.) and gained a generic kind-dropdown that offers semantically-wrong conversions (envelope→play); restored | `Inspector.svelte` |
| 5 | Effect picker polish: "Clear filters" action in the empty state; raw px/ms values tokenised; hover/active transforms gated behind reduced-motion | `EffectGallery.svelte` |
| 6 | Add pane: Prettier pass (shipped double-quoted/unformatted); `grab`/`grabbing` cursors on the draggable node previews | `AddPalette.svelte` |
| 7 | Inspector label-column alignment (`--field-label-col` on hand-rolled label spans) | `OutputNodeInspector.svelte`, `ScopeNodeInspector.svelte` |
| 8 | **PixLite: disabled HTTP keep-alive** (spec §4.4 — see §4 below) + hardware probe script committed | `packages/io/src/pixlite/client.ts`, `scripts/pixlite-probe.mjs` |

Also in flight this session: the **ui-shot hardening implementation** (§5).

---

## 2. Wrong and needs fixing — wants your eye before landing

Ranked by how badly each confuses a first-time user. These are the "you wire something up and expect one thing to happen and it doesn't" cases: core semantics are *correct* per #79; the UI just never tells the user.

### 2.1 A freshly added Effect renders nothing until wired to Output (worst)
`store.addNode` (`store.svelte.ts:~2791`) just pushes the node — no auto-wire; only legacy migration auto-wires leaves. The node's animated thumbnail actively implies it's live; it's silent. **Recommendation:** auto-wire a new Effect to the Output anchor on add (matches legacy-leaf behaviour; user can rewire); alternatively a "not reaching Output" node badge. Decision: auto-wire, badge, or both?

### 2.2 No graph lint surface — everything needed already exists, nothing consumes it
`compileRenderPlan` already emits typed issues (`missing-trigger`, `missing-output`, `flow-cycle` + fatal flag); `validateTriggerGraphIntegrity` emits a richer set; `canReach` exists for reachability; the Scope inspector already computes an "effective scope is empty" flag. **None of it is imported anywhere in `apps/web`** (verified). **Proposal:** a lint strip under the canvas + per-node badges (the `NodeCard` badge snippet slot already exists), fed by: compile issues → Effects with no path to Output (2.1) → transform/collector nodes whose input can never carry a layer → empty scope intersections (promoted from the inspector to the node face, and added to the Output inspector). This one feature converts every silent-render case into a visible, node-anchored warning. Meaningful UI addition — copy/placement wants your review.

### 2.3 Illegal connections draw, then silently vanish
`TriggerGraphView` passes no `onBeforeConnect` (the `GraphCanvas` prop exists); xyflow draws the wire, `store.connect` validates via `canConnect` and drops it, the rebuild erases it. Feels like a glitch. **Fix:** wire `onBeforeConnect` → `canConnect` so illegal targets reject *during* the drag, plus a one-line reason (direction / cycle / duplicate).

### 2.4 Add Node pane: search was deleted behind a two-stage category gate
The old pane was one searchable grouped list; the new drawer is well-built (real NodeCard previews, a11y, empty states — keep it) but you must already know which category holds what you want, and there is no way to scan or search the vocabulary. **Recommendation:** restore a search field above Stage 1 that filters across all categories (flat grouped results while a query is active; category browse otherwise).

### 2.5 Drag-and-drop affordances (sections view + add-pane→canvas)
- Sections: the only feedback is a whole-list glow; there's **no insertion-point indicator** for graph rows and **no target feedback at all** for section (column) reordering. Fix: 2px accent insertion line at the hovered gap; column outline for section drops.
- Add-pane→canvas: drop math is correct (`screenToFlowPosition`), but the canvas shows zero drag-over state. Fix: highlight the canvas while an add-node drag is over it.
- `SectionGraphRow` shows a permanent `grab` cursor on a click-to-open row — move the affordance to a grip icon.

### 2.6 Semantic decisions to lock (product calls, then tests)
- **Delay into Mix splits temporally:** Effect A→Mix + Effect B→Delay→Mix composites A alone now and B alone later (`delayMs 0` vs `>0` differ in Mix membership). Probably unavoidable without buffering, but it contradicts "delay one layer of the mix". Decide intended semantics; at minimum an inspector note + an explicit test.
- **Fan-in to an Effect duplicates the layer** (two flow edges into one Effect → two identical tokens → double brightness). Decide: coalesce per fire, or keep and surface it.
- **Mix/plan ordering is canvas-y-order** — dragging a node vertically reorders composite stacking. Existing convention; document it in the Mix inspector.
- Optional: "armed/cold" ticks on switch/chance child branches (the node state preview infra exists).

---

## 3. Not wrong, but should be improved

- **Inspectors are flat where they could be distinctive** (your hoop-selector standard): `RandomModNodeInspector` picks a distribution with no curve preview even though `NodeSignalPreview kind="random"` exists and the Add palette already renders distribution thumbnails; same opportunity for Note (gate/velocity) and OSC (live value bar). Cheap, high-value: reuse the existing previews in the inspectors.
- **Migrate hand-rolled inspector label rows to the `Field` primitive** (one row rhythm) — the width fix in §1.7 is the band-aid.
- Keep list (don't churn): effect-picker information architecture (category sections, count pills, scope filter — genuinely better than the locked browser); AddPalette build quality; `NodeSignalPreview`; `TriggerNode` face composition; pure `moveSection`/`moveGraphPlacement` helpers; live-drag repaint + projection desync self-heal; the shell layout changes.

---

## 4. PixLite — root cause and fix

The integration speaks the **documented PixLite Mk3 HTTP API** (JSON over HTTP; the request layer is in `packages/io/src/pixlite/`). Findings:

- The recent diff is **not** the cause — it only changed failure *reporting* (`controller-monitor.ts`: "stats unavailable" instead of instant disconnect). Stats reads have failed since the client was built; tests pass because Node's test HTTP server tolerates what the controller doesn't.
- The `statisticRead` request verifies **byte-for-byte against the spec**: body shape + strict member order, POST method, `/v1.7/?user=…&auth=…` path, empty-password auth hash (independently reproduced), `Content-Type`, nonzero id. The request queue is sound.
- **Most likely root cause: HTTP keep-alive socket reuse.** Spec §4.4: *"Upon receiving an HTTP response, an HTTP based client should close its connection if it does not have another request ready to send."* The controller closes per-response; Node ≥19's default agent keeps sockets alive. So `GET /ver` (adopt) succeeds, then the first `statisticRead` POST reuses the dead socket → timeout/ECONNRESET. Exactly matches "detects, then fails when it doesn't receive a response".
- **Fix applied (§1.8):** `agent: false` + `Connection: close` in `nodeHttpTransport` — spec-compliant regardless of root cause.
- **Confirm on hardware:** `node scripts/pixlite-probe.mjs <controller-ip>` — runs the exact app requests five ways (keep-alive vs fresh socket, trailing-slash variants, GET vs POST, the adopt→poll reuse sequence) and prints which succeeds. Runner-up causes if keep-alive isn't it: trailing slash in the mgmt URL (`/v1.7/?` vs `/v1.7?` — the spec is internally inconsistent), or the controller having a non-empty admin password (the app currently always hashes the empty password on first adopt — worth a settings field regardless).
- Also useful: the Monitor event `detail` string after a failed poll already discriminates the hypotheses (timeout vs ECONNRESET vs HTTP 4xx vs PixLite `err`).

---

## 5. ui-shot: convention over maintenance

`docs/ui-shots-hardening-2026-07-08.md` is being implemented this session by a twux agent (brief: `docs/prompts/2026-07-09-ui-shot-hardening-impl.md`): generic `--target` resolver (`data-shot` → `data-ui` → role/name → aria-label → text → CSS), `--discover`, a dev-only `window.__LEDRUMS_SHOT__` state seam replacing click choreography, `shots.json` demoted to presets.

Additional recommendations beyond the doc:

1. **The convention is accessibility, not registration.** The enforcement point should be the design system: every `lib/ui` primitive that renders a meaningful region/dialog/button must have an accessible name derived from its props, and may emit `data-ui` automatically. Then *every future component is capturable for free* — and the same names power the graph-handle labels (§1.1) and screen readers. One rule, three payoffs.
2. **Make `--discover` the review loop, not just a locator helper**: a `pnpm ui-shot --discover --all-views` sweep doubles as an accessibility audit — any surface that doesn't appear in discovery is by definition unnamed, which is a design-system violation. Consider a CI-adjacent check that diffs discovery output so new unnamed surfaces fail loudly.
3. **State seam over choreography also fixes flake**: `__LEDRUMS_SHOT__` functions are thin adapters over the store API, so shots stop breaking when DOM click-paths change — the harness's maintenance burden moves to exactly the seam (store API) that's already contract-tested.
4. **Presets earn their place only as locked baselines** (CI sweep + design-system captures). Anything an agent wants ad hoc should be expressible as `--state` + `--target` — if it isn't, that's a missing adapter function, not a missing preset.

---

## 6. Code health opportunities

### 6.1 Dead code — ~560 duplicated lines (recommended first)
The legacy recursive eval path is unreachable in production: every graph is normalised to v3 before eval (engine `setShow` and every store hydrate/edit). Delete `eval-graph.ts:595-810` + helpers (~280 lines) **and** its hand-copied mirror in `sim.ts:479-765` (~280 lines) — the exact keep-in-lockstep-by-hand duplication this repo's conventions warn about. `evalGraph` collapses to the Gen3 path. Gate: sign off that no persisted pre-v3 graph reaches eval un-normalised (verified: both entry points normalise).

### 6.2 Type seam — delete the `as unknown as` cast at the core↔web boundary
`sim.ts` keeps parallel local `TriggerGraph`/`Action`/`PlayDraft` mirror types, forcing `voice.evalChildren as unknown as (…)` — the compiler is defeated at exactly the seam that must not drift. Import the types from `@ledrums/core`, delete the mirrors. Pairs naturally with 6.1.

### 6.3 Perf — cache the render-plan compile
`compileRenderPlan` runs on **every trigger hit** and **again per delay drain** (4 maps + sorts + DFS cycle check per hit; multiplies on rolls/delay fan-outs). Issue #79 explicitly deferred caching. Note: a naive `WeakMap` is unsafe for the web sim (the store mutates graphs in place) — key by a structure signature or invalidate on edit. Also verify `planNodesById`/`nodeCategory`/`incomingFlowEdgesById` are actually consumed by eval; if not, compute lazily. Not per-frame (compositor unaffected), so this is a per-hit win, not a 60fps emergency.

### 6.4 God files
- **`store.svelte.ts` (3,833 lines, ~150 methods, ≥11 concerns)** — extract constructor-injected controllers on the existing `SaveStatusController`/`EngineLinkSync` prior art: monitor(+filters), MIDI input/learn, controller test/discovery, shows/setlist CRUD, section arrangement. Target ~1,200-line orchestrator.
- **`eval-graph.ts` (859 → ~450 after 6.1)** — split the survivor: worklist driver / route-node handlers / value-switch / draft+mix assembly.
- **`sim.ts` (1,084 → ~500 after 6.1)** — voices + pending-drain modules; sim stays the Gen3-delegating façade.
- Honourable mention: `ControllerStatusPanel.svelte` (23KB) next time it's touched.

### 6.5 Minor
- Verify the store persists per-input Mix opacity on the *stored* edge (the UI remaps mix rows to synthetic handle ids).
- Add the delay-into-Mix membership test (2.6) once semantics are locked.
- Compositor `Object.keys` churn per voice/frame is bounded by design — noted, no action.

---

## 7. Suggested sequencing

1. **Land this session's fix batch** (§1) — review the ui-shot captures it produced.
2. **Wiring-comprehension slice** (§2.1–2.3): auto-wire/badge decision + lint strip + connection-time rejection. This is the highest-leverage answer to "any user should understand where nodes wire up" — one slice, all detection primitives already exist.
3. **Interaction-affordance slice** (§2.4–2.5): add-pane search + DnD indicators + drop feedback.
4. **Code health pair** (6.1 + 6.2), then **6.3 caching**, each mechanical and test-gated.
5. **Inspector-distinctiveness pass** (§3) — previews in Random/Note/OSC inspectors.
6. **Semantic decisions** (2.6) whenever convenient — they're product calls, not code.
7. Store split (6.4) opportunistically, one controller at a time.

---

## Session fix-batch results

**ui-shot hardening: DONE** — `4f73ebf` (dev-only `__LEDRUMS_SHOT__` state seam), `9d68f3d` (semantic `--target` resolver + `--state` driver + `--discover` + presets), `a40f143` (exact-match resolver fix). Verified live: capture-without-registration works, `--discover --view trigger` lists 68 targets (+ HTML overlay), full 30/30 preset sweep green, typecheck green, README rewritten around the conventions. Deviations to review: gallery-tab presets capture the base "All" gallery (tabs are component-local — candidate `gallery:<tab>` seam op); song-library/section-detail/sections-arrangement degraded to base views; blank-pixel validation skipped (bbox + clean-console kept).

**Trivial fixes #1–8: DONE, all gates green** (typecheck 0; full `pnpm test` exit 0 — web 1292, io pixlite 10 incl. new `Connection: close` test; design-system regenerated `41e2c21`; ui-shots trigger-graph / node-editor-add / gen3-scope-inspector / effect-gallery clean):

- `87da0d1` #1 wires stay grey per Trent (modulation the sole coloured wire) + handle aria-labels
- `54eaa2c` #2 Scope inspector broken tokens (`--surface-1`→`--surface`, `--danger`→`--live`)
- `79075b4` + `5f66f24` #3/#4 mod-source inspector headers restored + hygiene; `output` kept out of KIND_OPTS as a protected anchor
- `cd4dd93` #5 effect-gallery clear-filters empty state, tokenised values, reduced-motion gating
- `c0df4e1` #6 add-palette quoting + grab cursor
- `c293540` #7 inspector label-column width
- `5e12aad` #8 PixLite HTTP keep-alive disabled (spec §4.4) + `scripts/pixlite-probe.mjs` + regression test

**Open question for Trent:** in the grey-wires cleanup the agent also deleted the `edge-hot` rule, so **node-hover no longer lights connected wires** (direct wire hover/select still lights accent). The June graph-interaction contract said hover highlights node border + connected wires instantly — if that still stands, restoring just `edge-hot` (accent stroke on connected wires during node hover) is a one-liner; if the grey-wires decision supersedes it, nothing to do.

**Pre-existing quirk noted (out of scope):** Output nodes render the generic kind Select with no matching option — shipped before this batch.

**PixLite next step (hardware):** `node scripts/pixlite-probe.mjs <controller-ip>` against the real PixLite to confirm keep-alive was the cause (row 2 succeeds / row 5 fails ⇒ confirmed).
