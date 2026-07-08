# Spec: Gen3 authoring UX & engine remediation — phased

**Source:** `docs/plans/2026-07-09-codex-review-remediation.md` + Trent's decisions (2026-07-09 session). Supersedes the open items in that doc's §2–§6 with locked decisions.
**Status:** ready for slicing. One open question (edge-hot node-hover wire highlight) — see Further Notes.

## Problem Statement

As a rig builder I can author Gen3 trigger graphs, but the app silently surprises me: I add an Effect and nothing renders; I draw a wire and it vanishes with no explanation (sometimes reappearing after a refresh); graphs migrate and auto-wire behind my back with no indication anything happened; the Add pane hides the node vocabulary behind category tiles I have to guess at; drag-and-drop gives me no cue where things will land; a delayed branch into a Mix behaves nothing like the timeline model in my head; and two wires into one Effect doubles the brightness. Meanwhile the PixLite controller detects but stats reads fail, and the codebase carries duplicated dead evaluation code and god files that slow every future change.

## Solution

Make every silent behaviour visible and every interaction self-explanatory, then align the engine's composition semantics with the timeline mental model, then pay down the code debt. Invalid wiring is rejected visibly *during* the drag; anything the system does on the user's behalf (migration, auto-wiring) announces itself in a toast; a lint surface converts every renders-nothing state into a node-anchored warning with a next step; the Add pane becomes searchable and visually consistent with the nodes; delay behaves like shifting a clip on a timeline; fan-in coalesces.

## User Stories

1. As a rig builder, I want an invalid wire to turn red/dotted/dull while I'm still dragging it, so that I know before release that the connection won't take.
2. As a rig builder, I want a toast on releasing an invalid wire explaining why it was rejected (direction / cycle / duplicate), so that I can correct course instead of guessing.
3. As a rig builder, I want a newly added Effect auto-wired to the Output anchor, so that it makes light on the next hit instead of sitting silent.
4. As a rig builder, I want a toast whenever the app auto-wires or migrates anything (e.g. "Graph updated to Gen3 schema. Output node added and wired up."), so that nothing changes behind my back.
5. As a rig builder, I want to drop a node onto an existing wire to splice it in, with a clear pre-release indication that a splice will happen, so that insertion is one gesture with no surprises.
6. As a rig builder, I want Ctrl/Cmd+Z after a splice to undo the auto-wiring but keep the node where I dropped it, so that undo removes the surprise, not my intent.
7. As a rig builder, I want a lint strip and node badges for every wired-but-renders-nothing state (no path to Output, empty scope intersection, dead branch, missing anchors), with short copy that tells me what to do, so that a silent graph is always explained.
8. As a rig builder, I want to search the whole node vocabulary from the Add pane, so that I can type what I want instead of guessing which category tile hides it.
9. As a rig builder, I want the Add pane category tiles to carry the same icon-with-tinted-background treatment as the nodes themselves, so that categories read as part of the same visual language.
10. As a rig builder, I want the Add pane's empty state to be plain text without card chrome, so that the pane doesn't present an empty box as content.
11. As a rig builder, I want an insertion line when dragging graph rows and a target outline when reordering sections, so that I can predict where a drop lands before releasing.
12. As a rig builder, I want the canvas to highlight while I drag a new node over it, so that I can see the drop target is live.
13. As a rig builder, I want a delayed branch to behave like a clip shifted on a timeline — at frame 31 of A, B is at frame 1 and they compose per the Mix node's rules — so that delay means "later", not "separate".
14. As a rig builder, I want two wires into one Effect to coalesce into a single firing, so that fan-in doesn't double the brightness.
15. As a rig builder, I want Mix stacking order (canvas y-order) stated in the Mix inspector, so that layer order is discoverable, not folklore.
16. As a rig builder, I want the Random/Note/OSC inspectors to show live signal previews like the Scope inspector shows its hoops, so that I can see what a source does while I edit it.
17. As a performer, I want the PixLite integration confirmed against real hardware, so that stats and identify work at the gig, not just in tests.
18. As a rig builder, I want a wire I add to either exist or visibly fail — never vanish and reappear after a refresh — so that I can trust the canvas as the source of truth.
19. As a developer, I want the dead legacy eval path and its hand-copied web mirror deleted, so that one evaluator is the only evaluator.
20. As a developer, I want the web sim to import core's graph/action types instead of mirroring them behind an `as unknown as` cast, so that drift fails to compile.
21. As a developer, I want the render plan cached across trigger hits with edit invalidation, so that fast rolls don't recompile the graph per hit.
22. As a developer, I want the trigger-lab store split into focused controllers, so that navigation and testing stop paying the god-file tax.
23. As a developer, I want inspector rows on the shared Field primitive, so that label rhythm is one implementation, not four.

## Implementation Decisions

*(module names per the domain glossary; no file paths — they age fast)*

- **Connection-time validation (locked):** the wire-in-progress renders **red, dotted, and dull** the moment the pointer is over an invalid target (validation via the existing store connection validator, surfaced through the graph canvas's pre-connect hook); on release over an invalid target, a **toast names the reason** (direction / cycle / duplicate). No silently vanishing wires.
- **Auto-wire on add (locked):** a newly added Effect node is auto-wired to the terminal Output anchor. Undoable as one wiring action.
- **System-action toasts (locked):** every migration or auto-wire the system performs announces itself — e.g. *"Graph updated to Gen3 schema. Output node added and wired up."* One toast per user-visible event, plain language, states what changed.
- **Wire splice on drop (locked):** dragging a node over an existing wire arms a splice (wire visibly indicates the pending insert before release); release wires source→node→target. **Undo granularity:** Ctrl/Cmd+Z undoes the splice wiring but **not** the node's position — the wiring mutation is recorded as its own undo entry after the position commit.
- **Graph lint surface (approved):** a lint strip + per-node badges fed by the render-plan compiler's issues, a reachability pass (no path to Output; transform/collector with no possible layer input), and the effective-scope-empty flag (promoted to node face; also added to the Output inspector). **Copy: clear, short, and says what to do** (e.g. "Not reaching Output — wire this to Output to render").
- **Add pane (locked):** a search field filters across all categories (flat grouped results while a query is active; category browse otherwise); Stage-1 category tiles get **icons with tinted backgrounds matching the node icon-chip treatment**; the empty-state text loses its surrounding card.
- **Sections/canvas DnD (approved as proposed):** accent insertion line at the hovered gap for row drags; column outline for section reorder; canvas drag-over highlight for add-node drags; grip icon replaces the whole-row grab cursor.
- **Delay semantics (locked — timeline model):** a delayed layer is a clip shifted on the timeline. Composition membership at a Mix is **temporal overlap at render time**, not eval-batch membership: when the delayed layer starts, it composes with whatever upstream layers are still live, per the Mix node's blend rules; layers that have decayed are simply absent. `delay 0` must be indistinguishable from no delay.
- **Fan-in to Effect (locked):** multiple flow edges into one Effect **coalesce** to a single firing per trigger (no double brightness).
- **Mix ordering:** canvas y-order stacking stays; the Mix inspector documents it.
- **Vanishing-wire bug:** investigate before building on the affected code path — determine whether it's a duplicate edge the projection didn't render or a failed add later masked by refresh-time auto-wiring; fix at the root, and ensure the system-action toasts make any refresh-time normalisation visible.
- **Inspector previews:** Random distribution curve, Note gate/velocity, OSC live value reuse the existing node-face signal-preview component inside the inspectors.
- **Code health (all approved):** delete the legacy pre-Gen3 eval path in core and its duplicated web-sim mirror; replace the sim's mirrored types with core imports (removing the double-cast); cache the compiled render plan keyed by a structure signature invalidated on edit (in-place store mutation makes object-identity caching unsafe); verify-and-drop unused compile outputs; split the trigger-lab store into constructor-injected controllers (monitor, MIDI input/learn, controller test, shows/setlist, section arrangement) following the existing controller prior art; migrate hand-rolled inspector label rows to the Field primitive.
- **PixLite:** keep-alive disabled per API spec §4.4 (landed); confirm on hardware with the probe script; add an admin-password setting so non-empty-password controllers can authenticate.
- **Pre-existing quirk:** Output nodes render a kind selector with no valid option — give protected anchors (trigger/output) a proper header treatment instead.

## Testing Decisions

- Test external behaviour at the highest stable seam; never implementation details.
- **Core seam (canonical `TriggerGraph` → evaluated actions):** delay-overlap composition (delay 0 ≡ immediate; delay >0 composes with still-live layers per blend rules), fan-in coalescing, plan-cache invalidation on structural edit. Prior art: the existing Gen3 eval and Mix test suites in core's voice module.
- **Store seam (mutations + undo):** auto-wire on add, splice wiring, splice-undo-keeps-position, connection rejection reasons. Prior art: existing store wiring/undo tests.
- **Component seam:** Add pane search/tiles/empty state, lint strip rendering, toast emission on migration. Prior art: the existing testing-library component tests for the Add pane.
- **Visual seam:** ui-shot `--state`/`--target` captures per surface (the new convention — no preset registration required); lint strip and invalid-wire states get dedicated states in the shot seam.
- **IO seam:** PixLite transport tests already assert `Connection: close`; hardware probe is a manual gate, recorded in the tracker when run.

## Out of Scope

- Replacing node-graph authoring, the Add pane's two-stage drawer (it stays; search is additive), or any hardware output protocol/DMX mapping changes.
- Broadening Scope semantics (strict intersection stands).
- Re-colouring signal-flow wires (wires stay grey by explicit design; modulation remains the only coloured wire).
- Modulation UI rework and the "Graphs" renaming exploration.
- Arbitrary feedback loops / cycle support.

## Further Notes

- **Open question:** the grey-wires cleanup deleted the node-hover→connected-wires highlight (`edge-hot`). Restoring it is a one-liner if the June instant-hover contract still stands — Trent to rule.
- **Deferred follow-up:** a two-axis `/code-review` sweep (standards + spec fidelity) over the full batch was interrupted by the session limit (resets 9am Melbourne); re-run it and fold any additional findings into Phase 4 before slicing that phase.
- ui-shot gallery-tab coverage: candidate `gallery:<tab>` op in the shot seam if tab-level captures matter.

---

## Phases & task breakdown (grouped, ordered)

**Phase 1 — Graph trust (wiring comprehension)** *(highest leverage; do first)*
1.1 Connection-time validation: red/dotted/dull in-drag + reason toast on release
1.2 Auto-wire new Effect → Output (+ toast)
1.3 System-action toasts for all migrations/auto-wires
1.4 Diagnose + fix the vanishing/reappearing wire bug
1.5 Lint strip + node badges (compile issues, reachability, empty scope) with actionable copy
1.6 Wire-splice on node drop (pre-release indication + splice-only undo)

**Phase 2 — Interaction affordances**
2.1 Add pane search across categories
2.2 Category tiles: node-style icon chips; empty state de-carded
2.3 Sections DnD insertion line + section-target outline
2.4 Canvas drag-over highlight for add-node drags; grip icon on graph rows

**Phase 3 — Engine semantics (locked decisions → tests first)**
3.1 Delay = timeline shift: overlap-based Mix composition (+ delay-0 parity test)
3.2 Fan-in to Effect coalesces
3.3 Mix inspector documents y-order stacking

**Phase 4 — Code health** *(mechanical, test-gated; re-run /code-review first)*
4.1 Delete legacy eval path (core + sim mirror)
4.2 Sim imports core types; casts removed
4.3 Render-plan compile caching (signature-invalidated)
4.4 Drop unused compile outputs (verified)
4.5 Store controller split (one controller per slice)
4.6 Fold in /code-review findings

**Phase 5 — Inspector distinctiveness & polish**
5.1 Signal previews in Random/Note/OSC inspectors
5.2 Field-primitive migration for inspector rows
5.3 Protected-anchor header treatment (Output/Trigger kind quirk)

**Parallel / hardware**
H.1 PixLite hardware probe run + record result
H.2 PixLite admin-password setting
