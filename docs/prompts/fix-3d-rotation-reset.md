# Fix: 3D kit preview rotation resets on every key press

Implementer agent. Use **/diagnose**. Branch **`feat/unified-shell`** (checked out). Report to your
parent orchestrator (`--session parent`). No push/PR/merge.

## The bug
In the unified shell (web :5173, voice server :4321 already running — hot-reloads), the **3D Kit
Preview camera rotation/zoom resets whenever a key is pressed**. Pressing number keys 1–9 fires pads
(`App.svelte` `onKey` → `store.hit`), which updates `store.previewFrame`/`store.model` every frame.
The Three/Threlte scene must NOT reset its OrbitControls/camera when the frame (or other reactive
props) updates — only the pixel COLORS should update.

## Where to look
- `apps/web/src/lib/visualizer/Scene.svelte` — the Threlte scene. Likely causes: camera/controls
  recreated on a reactive prop change; a `{#key ...}` wrapping the canvas/scene that remounts on
  frame/model change; camera position bound to a value that re-derives; or the whole `<Canvas>`
  keyed on something that changes per hit. Make camera + OrbitControls state persistent across frame
  updates; decouple the per-frame color buffer update from scene/camera construction.
- It's also reused by `lib/app/docks/Visualizer.svelte` + `lib/app/views/KitView.svelte` + the lab —
  prefer a fix INSIDE `Scene.svelte` so all callers benefit.
- `apps/web/src/App.svelte` `onKey` — only touch this if the reset is provably caused by a remount it
  triggers AND it can't be fixed in Scene. If you must edit App.svelte, note it in your report (a
  sibling agent owns `lib/app/**`, so coordinate — keep any App.svelte change minimal + isolated to
  the keydown path).

## Feedback loop / verify
Reproduce against the running stack: rotate the 3D preview, press a number key, watch the camera snap
back. A headless 3D assertion is impractical — instead verify by reasoning about the reactive graph +
manual check, and describe what you changed and why it can no longer reset. Keep `pnpm --filter
@ledrums/web typecheck` clean (run package-scoped; sibling agents are editing other web files — ignore
errors outside `Scene.svelte`/your changes, re-run if a sibling is mid-edit). If a Svelte MCP
autofixer is available, run it on Scene.svelte.

## Report
```
twux send-message --session parent --slice-status "<short>" --body "<root cause (what reset the camera), the fix in Scene.svelte, any App.svelte touch, how you verified, pasted web typecheck output>"
```
