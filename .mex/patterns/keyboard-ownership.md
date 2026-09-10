---
name: keyboard-ownership
description: Add or change global keyboard shortcuts while preserving native and component keyboard accessibility
triggers:
  - "global keyboard shortcut"
  - "keyboard ownership"
  - "preventDefault"
edges:
  - target: "../context/decisions.md"
    condition: "when the shortcut changes which surface owns a physical key"
  - target: "../../PRODUCT.md"
    condition: "when deciding which operator surface should claim a shortcut"
last_updated: 2026-09-11
---

# Keyboard Ownership

## Context

LEDrums has a live Perform surface and authoring controls built with native elements and Bits UI.
The rule must be about the event's current semantic target, not about focus-blur side effects.

## Steps

1. Define a pure decision helper that returns exactly one action or no ownership.
2. Decide per key FAMILY whether the view matters. Graph digits are claimed in every view -
   authoring a graph means firing it to hear it - and the yield set below, not a view gate, is
   what keeps authoring controls safe. Section arrows are Perform-only, because every authoring
   view has its own arrow owner. A view gate is a last resort: check first whether the yield set
   already covers the case, and never add one that removes the only way to exercise a feature.
3. Add a small DOM adapter for stable semantics: editable targets, open popup roles/state,
   roving radio/toggle/segmented markers, and any canvas that owns arrow movement.
4. Install the decision in the window capture handler. If the app owns the event, call both
   `preventDefault()` and `stopPropagation()` before performing the action.
5. If the action crosses the WebSocket boundary, check the server's authorization table and test
   the intended editor/viewer policy at both the gate and the handler.
6. Define repeat policy per key family: graph digits are edge-triggered; section arrows may repeat
   while held. Yield modified chords before deciding ownership.

## Gotchas

- Do not globally stop propagation from the app shell: Bits Select typeahead and segmented
  roving focus need the event.
- A Bits popup can be portalled, so inspect listbox/option roles as well as its open trigger.
- Mark reusable keyboard-owning control roots explicitly (`data-keyboard-owner`) and retain their
  native/ARIA roles; do not grow an unbounded role exception list.
- Treat every open modal/dialog as a global ownership boundary, including portalled content, and
  detect it through composed paths plus modal state.
- Do not use blur or focus history as the correctness mechanism; it discards user focus and races
  component state.
- Before scoping a shortcut to one view, ask what else can still reach the action in the views you
  are excluding. The 2026-09-06 Perform-only gate stranded the Trigger view with no fire path at
  all, because the view's Play Surface had separately been replaced by a select-only graph rail.
  Two safe-looking changes removed a capability neither of them mentioned.
- Test repeated keys, Enter/Escape aftermath, native text controls, component popups, and canvas
  movement. A key that is yielded must not also trigger a hidden app action.

## Verify

- [ ] Pure mapping tests cover owned keys, yielded keys, views, and settings - including that each
      key family still fires in every view it is meant to.
- [ ] Browser/component tests cover native inputs, open Select/combobox/listbox, segmented/toggle,
      graph canvas, and Enter/Escape.
- [ ] Server tests cover the chosen authorization policy and the real action path.
- [ ] Run focused tests, full typecheck, full test, and strict ui-shot captures for affected views.
- [ ] Run `git diff --check`.

## Debug

If a control changes and the app also acts, log the event target's semantic markers and inspect the
pure decision inputs. If a control stops responding, first check whether the popup/control marker
is present at the actual event target, including a portalled popup.

## Update Scaffold

- [ ] Update `.mex/ROUTER.md` "Current Project State" if what's working/not built has changed
- [ ] Update any `.mex/context/` files that are now out of date
- [ ] If this is a new task type without a pattern, create one in `.mex/patterns/` and add to `INDEX.md`
