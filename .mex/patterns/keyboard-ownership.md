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
last_updated: 2026-09-06
---

# Keyboard Ownership

## Context

LEDrums has a live Perform surface and authoring controls built with native elements and Bits UI.
The rule must be about the event's current semantic target, not about focus-blur side effects.

## Steps

1. Define a pure decision helper that returns exactly one action or no ownership.
2. Make the product surface part of the decision. Keep authoring views free to use their controls.
3. Add a small DOM adapter for stable semantics: editable targets, open popup roles/state,
   roving radio/toggle/segmented markers, and any canvas that owns arrow movement.
4. Install the decision in the window capture handler. If the app owns the event, call both
   `preventDefault()` and `stopPropagation()` before performing the action.
5. If the action crosses the WebSocket boundary, check the server's authorization table and test
   the intended editor/viewer policy at both the gate and the handler.

## Gotchas

- Do not globally stop propagation from the app shell: Bits Select typeahead and segmented
  roving focus need the event.
- A Bits popup can be portalled, so inspect listbox/option roles as well as its open trigger.
- Do not use blur or focus history as the correctness mechanism; it discards user focus and races
  component state.
- Test repeated keys, Enter/Escape aftermath, native text controls, component popups, and canvas
  movement. A key that is yielded must not also trigger a hidden app action.

## Verify

- [ ] Pure mapping tests cover owned keys, yielded keys, views, and settings.
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
