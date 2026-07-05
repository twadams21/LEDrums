---
name: ui-shot-sweep
description: Run and repair the LEDrums ui-shot screenshot sweep, especially for gallery and shell close-out tasks.
triggers:
  - "ui-shot"
  - "screenshot sweep"
  - "gallery close-out"
  - "visual regression"
edges:
  - target: context/conventions.md
    condition: when changing shot manifests, app state, or test expectations
last_updated: 2026-07-05
---

# ui-shot Sweep

## Context

The screenshot harness lives in `scripts/ui-shot/`. It drives the running app and writes
generated captures to `.ui-shots/`. The harness often runs against a dev server that already
has local authored state, so shots should establish their own navigation and graph context
instead of assuming the app starts from a pristine route.

Gallery shots are especially sensitive because typed play nodes lock the gallery to the
selected node's play type. If a shot needs a specific collection, first select or create a
node of the matching play type.

## Steps

1. Read `scripts/ui-shot/README.md` and `scripts/ui-shot/shots.json`.
2. Run the smallest relevant subset first, for example
   `pnpm ui-shot effect-gallery-collection effect-gallery-filtered --strict`.
3. If a shot depends on editor mode, make the "Take over" click optional so the shot also
   passes when the app is already taken over.
4. Navigate to a known graph before opening node-editor tabs or locked galleries.
5. Use the Add tab to create/select a node whose play type matches the gallery state being
   captured.
6. Run `pnpm ui-shot --all --strict` before calling the sweep complete.
7. Visually inspect the key captures, especially populated gallery states and any changed
   controls, rather than relying only on file creation.

## Gotchas

- The app may already be in editor mode; a mandatory "Take over" click can fail.
- The node editor may open on Inspector, not Add. Shots that add nodes must switch tabs
  explicitly.
- Gallery collection tabs are not enough when the selected node's play type locks the
  gallery. The selected node has to be the right type.
- Persisted local app state can leave an unexpected graph selected after previous manual
  browser work or earlier ui-shot runs.
- Strict mode only proves that selectors ran and screenshots were written. It does not prove
  the capture is visually meaningful.

## Verify

- `pnpm ui-shot --all --strict` passes.
- Key generated captures under `.ui-shots/` show non-empty, populated UI.
- If Canvas or live authoring behavior changed, run a browser spot-check on `:5173`:
  author or tweak a scene, bind it to a Canvas play node, reload, and verify the node still
  renders a lit thumbnail.
- Run the relevant functional gates (`pnpm typecheck`, focused tests, or full non-desktop
  tests) when shot fixes touch app behavior or test harness code.

## Debug

- If a selector times out, inspect whether the shot is on the expected workspace, graph, and
  node-editor tab before changing selectors.
- If a gallery shot opens the wrong collection, confirm the selected node's `playType`.
- If the dev server is stale, restart `pnpm dev` or let the ui-shot command launch its own
  server, then rerun the failing shot only.

## Update Scaffold

- [ ] Update `.mex/ROUTER.md` "Current Project State" if the sweep changes what is considered verified.
- [ ] Update the relevant plan/report document with the exact command and result.
- [ ] If the harness behavior changes, update `scripts/ui-shot/README.md`.
