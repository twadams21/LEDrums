# P1 verdicts — what Trent chose, and what to build

**Recorded 2026-08-17 from Trent directly (this machine).** The four prototypes on
`proto/trigger-reimagine` (head `b2b0328`) have been reviewed and judged. Prototyping on this
initiative is **closed** — "don't worry about more prototypes, let's just build this". This file is
the decision record; the prototypes remain as the visual reference for each winner.

Everything below is sourced from Trent's own words unless a line says **assumed** or **derived**.

---

## 1. Envelope param — **Option A, the two-handle rail**, with three changes

> "go with 1, but needs some tweaks."

Note on the label: Trent reviewed a downloaded copy (`trigger-envelope-param (1).html`) and said
"go with 1", meaning the **first option** — the file labels its options A–D, so this is **A, the
two-handle rail**. The three tweaks only make sense for A, which confirms the reading.

### The three changes

1. **Handles are not pinned to the rails.** In the prototype the start handle is anchored at t=0 and
   the end handle at t=1; only their level was free. Both handles must be placeable **anywhere** —
   free in time *and* level.
2. **The profile is global, not per-handle.** The prototype's "each handle owns its own profile" idea
   is dropped. One profile selection applies to **all** handles in the envelope.
3. **A vertical strength slider**, which **greys out when it is not valid for the selected profile.**

### Open question for the implementer (the only one)

"Strength" was not defined further. **Assumed reading:** strength is the depth/curvature of the
chosen profile — how hard an Exp bends, how steep an S-curve's shoulders are — and it is therefore
meaningless (→ disabled) for profiles that have no curvature to scale, i.e. **Linear** and **Snap**.
Confirm this with Trent before building the disable rule; everything else is unambiguous.

A second, softer ambiguity: change 2 says "apply to all handles", which reads as though the handle
count may exceed two. Change 1 ("each handle") is consistent with either. **Assumed:** build for N
handles with add/remove, defaulting to two — that satisfies both readings and is strictly more
capable. Flag it if that assumption is expensive.

### What this supersedes

The winning shape is no longer "a slider with two anchored ends"; it is **free handles + one global
profile + one strength control**. Option A's `hold`-splits-the-handle mechanic was a consequence of
the anchoring, and with anchoring gone it should be re-derived rather than ported.

---

## 2. Inspector slideover — **Option 1, auto overlay**, anchored to the window

> "go with 1" · "I want it over the top of all chrome from the very right hand side so that it
> overlaps the drum preview / bus / layer section."

This is a material change to what the prototype showed. The prototype's overlay was scoped to the
**graph canvas** — it slid over the graph and stopped at the view's edge. Trent wants it anchored to
the **right edge of the window**, in a layer **above all app chrome**, deliberately covering the drum
preview / bus / layer sections.

Implementation consequence: it is **not** a panel inside `TriggerGraphView`'s grid. It has to be
hoisted to the shell (alongside the other overlays — see `Overlays.svelte`) so it can paint over
docks it is not a sibling of. Everything else from option 1 stands: node-select opens it, canvas
click or Escape dismisses it, and the canvas geometry never changes.

Unresolved and inherited from the prototype's own notes: **the Add-node palette has no home** once
the Inspector becomes selection-keyed. Today they share one panel (`NodeEditor.svelte`, two tabs).
This needs a decision before the drawer lands.

---

## 3. Effect inspector — **Option 4, progressive disclosure + filter**

> "go with 4"

One list, no modes: common params always visible at the top, the effect's own params in a fold that
remembers its state, and a filter box narrowing both.

Carry the prototype's finding with it: this is the **only** winner that degrades correctly without a
core rename first. A common colour block bound to `hue` silently skips Confetti Burst (`baseHue` +
`hueSpan`) and Temp Sweep (`warmHue`). Option 4 renders whatever the generator actually declares, so
it ships without waiting on the key normalisation — but the normalisation is still worth its own
ticket, because the decay/life family is spelled four ways (`decayMs` ×9, `lifeMs` ×4, `lifeBeats`
×2, `life` ×1) across three units.

---

## 4. On-canvas controls — **Option 1, face params**, on the existing param-row mechanism

> "go with 1, but ride along the existing add parameters to the node to allow control with
> modulation nodes."

This is the important half of the verdict: the promoted params must **not** be a new bespoke row
type. They should be the **same exposed-param rows the modulation system already uses** — the
`node.modInputs` rows rendered in `TriggerNode.svelte`'s `paramFooter`, each carrying a
`param:<key>` target handle, managed by `ModulationParamsSection.svelte`.

So "add a param to the node face" and "expose a param for modulation" become **one gesture**: the row
you add to control a param inline is the same row a modulation node wires into. That kills the
duplication the prototype's plate-foot flagged ("do promoted params also stay in the Inspector?") —
there is one list of exposed params, visible on the card, editable in place, and wireable.

---

## 5. New: "now playing" indicators in the trigger graph list

> "the trigger graph list fire indicators need a tweak — they should almost have a 'now playing'
> indicator for toggles or loops where they are fired and keep playing. This would help us know that
> when lights are displaying on the kit, what graph might be controlling the lights."

Not part of the four prototypes; raised alongside them.

**What exists today** (`GraphsDock.svelte`): firing a graph stamps `store.lastSectionFire = {key, seq}`
and the card wears a **one-shot 520ms `.fireburst` overlay**, cleared by a `setTimeout`. It answers
"this graph *was* fired", never "this graph *is still* playing".

**What is being asked for:** a sustained state on the graph card for graphs whose output persists —
toggles (latched on until toggled off) and loop-mode plays — so the list answers "the kit is lit;
which graph is doing that?"

**Derived — this looks buildable from state that already exists, no engine change:**

- `store.voices` (`Voice[]`) is the live voice list, sourced from the sim offline and from the
  server's streamed voices when the engine link is open (`selectDockVoices` / `dockVoices`, already
  powering the Layers/Buses dock).
- **`Voice.pad` already carries the firing graph's KEY** — "Eval state prefix this voice was spawned
  under (the firing graph's KEY, or `'preview'`)". So `voices.some(v => v.pad === graphKey)` is a
  live per-graph liveness signal.
- `Voice.mode` (`PlayMode`) separates sustaining voices (`loop` / `hold`) from `oneshot`, which is
  exactly Trent's toggle/loop-versus-transient distinction.
- The sim already tracks latched toggles (`sim.ts` `private latched = new Map<...>`), if the toggle
  case needs more than voice liveness.

**Verify before relying on it:** `pad` is optional, and I did **not** trace the server-streamed
(engine-linked) path to confirm it populates `pad`. The field comment says it mirrors the core Voice
field, which suggests it does — but confirm, because if it is only populated offline the indicator
would silently die in exactly the situation it exists for (a real show, engine linked).

Design note, not a decision: keep the existing 520ms burst for the *fired* moment and add the
sustained state as a **separate** visual — they answer different questions and should not be the same
mark.

---

## 6. Bug found in the real app — SVG handle distortion

Trent: "that svg distortion affects the real app too … It is mainly on the existing envelope editors
(maybe only there)." **Verified — he is right, and it is only there.**

`preserveAspectRatio="none"` appears exactly **once** in `apps/web/src`:
`EnvelopeEditorView.svelte:197`, with `viewBox="0 0 480 160"` and CSS `width: 100%; height: 160px`.
The y-scale is therefore always exactly 1 and the x-scale is `renderedWidth / 480`, so every circular
handle is drawn as an ellipse whose distortion equals that ratio.

Severity depends entirely on which consumer is rendering it — there are two:

| Consumer | Rendered width | x-scale | Effect |
| --- | --- | --- | --- |
| `EnvelopeEditor.svelte` (the per-param modal, `width: min(520px, 94vw)`, ~488px inner) | ~488px | ~1.02 | ~2% — invisible in practice |
| `EnvelopeNodeInspector.svelte` (the Envelope node's editor, inside the Node Editor drawer, 280–460px, **default 320px**) | 320px | **0.67** | **33% squash** — an r=7 dot renders 9.3px wide × 14px tall; the r=16 hit circle renders 21px × 32px |

So the modal looks fine and the **node inspector is visibly wrong**, which is why it reads as "mainly
the envelope editors". It gets worse the narrower the drawer is dragged, and nearly disappears at the
drawer's 460px maximum.

**It is cosmetic, not functional.** `toUnit()` in `envelope-editor-geom.ts` divides by
`rect.width`, so the drag mapping stays correct at any scale — handles land where you drop them, they
just aren't round.

**Two fixes, pick one:**
1. *Cheap:* drop `preserveAspectRatio="none"` and let it scale uniformly. Handles become round; the
   plot letterboxes instead of filling the width.
2. *Right:* make the geometry width-responsive — measure the rendered box and set the viewBox width
   to the actual pixel width, so 1 user unit = 1px and nothing is ever scaled. Fills the width **and**
   keeps handles round, and it also makes hit targets honest. Costs more: `GEO.W` is a fixed export
   in `envelope-editor-geom.ts` and is baked into `envelope-editor-geom.test.ts`.

Fix 2 is what the prototype ended up doing (widgets at their native 320px, no scaling), and it is the
one to take if the envelope editor is being rebuilt for item 1 anyway — the two touch the same file.

---

## 7. The direction behind all of it

> "this different way of setting parameters was what I was thinking we could apply to a few common
> params — reimagine how we set and control the common settings to allow creative expression of
> lighting design."

The envelope work is not a fix for one param's editor. The intent is that the **common params**
(colour, decay/life, speed — the four that carry the whole library: `saturation` 49, `brightness` 49,
`hue` 40, `speed` 30 declarations) stop being number entry and become **expressive controls**, where
shaping the parameter over the life of a hit is the normal way to author, not an opt-in.

That reframes item 1 as the **first instance of a pattern**, not a one-off widget — worth designing
the envelope control so a second and third param can adopt it, and worth revisiting item 3's "common
section" in that light once the control exists.

---

## Prototype status

| File | Verdict |
| --- | --- |
| `docs/proto/trigger-canvas-controls.html` | **Option 1 — Face Params**, on the existing exposed-param row mechanism |
| `docs/proto/trigger-inspector-drawer.html` | **Option 1 — Auto Overlay**, hoisted to overlay all chrome from the window's right edge |
| `docs/proto/trigger-effect-inspector.html` | **Option 4 — Progressive disclosure + filter** |
| `docs/proto/trigger-envelope-param.html` | **Option A — Two-handle rail**, with free handles, a global profile, and a strength slider |

The verdict panels in the files are unused — verdicts were given verbally and are recorded here
instead. Branch `proto/trigger-reimagine`, head `b2b0328`, pushed. Nothing here has been implemented;
this is a decision record for the build.
