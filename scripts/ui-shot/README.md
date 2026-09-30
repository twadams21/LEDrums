# ui-shot — semantic app screenshots

Headless captures of the running app via system Chrome (playwright-core, `channel:'chrome'` — no browser downloads). Starts `pnpm dev` automatically if the default server isn't up. With `UI_SHOT_BASE` set, the preview must already be running: an unreachable custom URL fails without spawning a detached default stack. Use the exact reachable hostname (`localhost` can bind IPv6 while `127.0.0.1` is unreachable). Output: `.ui-shots/<name>.png` (gitignored). Console/page errors during capture are printed per shot.

The interface is **semantic**, not maintenance-driven. You capture a surface by its accessible name and put the app into the state you need with a tiny state string — you do **not** register a screenshot name or hand-write a click chain.

```bash
pnpm ui-shot --view trigger --target "main.center"                       # by accessible name / CSS
pnpm ui-shot --state "view:trigger,cell:kick:0,add-effect:wave:radial" --target "main.center" --name wave
pnpm ui-shot --discover --view trigger                                    # what can I capture here?
pnpm ui-shot grid-selected                                                # a named preset
pnpm ui-shot --all --strict                                               # sweep, fail on console errors
```

Set `UI_SHOT_OFFLINE=1` for an isolated web-only preview. It disables WebSocket connections and supplies empty MIDI ports. Pair it with `configured-zones` to inspect configured zone controls without a server.

## `--target` — the generic resolver

One flag resolves an element through a chain, accessibility first, raw CSS last:

```
[data-shot] → [data-ui] → role+name → [aria-label] → visible text → [title] → CSS
```

A **bare** string walks the whole chain. A **prefix** forces one resolver:

| prefix     | example                                             | resolver |
| ---------- | --------------------------------------------------- | -------- |
| `role:`    | `role:grid[name='Effects grid']`                    | `getByRole(role, { name })` |
| `dialog:`  | `dialog:Settings`                                   | dialog by accessible title |
| `text:`    | `text:Kick`                                         | visible text |
| `node:`    | `node:controller`                                   | svelte-flow node containing that text (graph-era: no flow canvas remains, so it resolves nothing) |
| `button:`  | `button:Add Modifier`                               | button by name |
| _(none)_   | `main.center`, `.top`, `#device-strip`              | walk the chain (CSS if all else fails) |

If a surface has an accessible name, it is screenshot-able — no registration.

## `--state` — state fixtures instead of click choreography

The hard part of a screenshot is not cropping the element; it is getting the app into the state where the element exists. Drive that with a comma-separated state string, consumed by the dev-only `window.__LEDRUMS_SHOT__` seam (`apps/web/src/lib/app/shot-seam.ts`):

```bash
pnpm ui-shot --state "view:trigger,cell:kick:0,effect-stack:3" --target "main.center" --name stacked
```

| op          | effect |
| ----------- | ------ |
| `view:<v>`  | switch workspace view (`perform` · `objects` · `sections` · `trigger` (Effects) · `monitor`) |
| `section:<s>`| activate a section of the active song by 1-based position or name (`section:2`) — the same recall a Sections-bar chip fires |
| `configured-zones` | Offline fixture: default kit with Kick zone 0 named Head center (and zone 2 Rim). Uses the real input-map mutation. |
| `cell:<row>:<col>`| select an Effects-grid cell — `<row>` is a row id or label (`kit`, `kick`, `Snare`); `<col>` a column index, `always` / `clock` / `cue`, or `z<slot>` |
| `add-effect:<kind>[:style]`| add an Effect of that Generator into the selected cell (`add-effect:wave:radial`) |
| `effect-stack:<n>`| fill the selected cell with `n` demo Effects of varied Generators |
| `master`    | select the Master cell (the section's master modifier chain) |
| `map-mode[:armed]`| MIDI-map mode on; `:armed` also arms the first visible mappable control |
| `fire[:<drum>]`| fire a pad hit through the real hit path (`fire:kick`; bare `fire` = the first pad) |
| `wait:<ms>` | hold the op sequence — for state that lands asynchronously (the debounced show sync) |
| `settings[:<pane>]`| open the app Settings dialog, optionally on a pane (`settings:outputs`) |
| `velocity-curve[:<drum>]`| author a non-identity velocity sensitivity curve on a drum and open Settings › Drum trigger zones (`velocity-curve:kick`; bare = the first drum) — pair with `fire:<drum>` to catch the live hit marker |
| `global-controls` · `global-control-learn[:osc]` | open Settings with representative global-control bindings / with a Learn armed |
| `controller[:needs\|:discover]` | inject a synthetic PixLite status and open Settings › Controller |
| `expanded[:off]` | flip the controller's expanded mode (8 / 4 output ports) |
| `audio-meter[:<state>]` | stage the Settings › Input audio meters without a microphone (`running` · `denied` · `lost` · `unsupported` · `off`) |
| `backups`   | seed representative local backups and open the Backups dialog |
| `sections-reorder` | pin the Sections view's section-reorder insert line |
| `canonical-readonly[:sections]` | switch the active song to a canonical library reference (read-only), on the Effects view or `:sections` |
| `viewer`    | seed a viewer presence state (authoring disabled) and open Sections |
| `toast[:<tone>]` | push pinned toast(s) (`info` · `success` · `error`; bare = one of each) |
| `reset`     | close summoned surfaces, leave map mode, drop the selection |

The seam is a **thin adapter over the existing store API** (no logic duplication) and ships **only in dev** (`import.meta.env.DEV`, dynamically imported in `App.svelte`) — it is dead-code-eliminated from production bundles.

## `--discover` — ask the app what's capturable

```bash
pnpm ui-shot --discover --view trigger
```

Lists regions / dialogs / buttons / nodes from the DOM + accessibility tree with ready-to-paste `--target` strings, and writes an overlay (`.ui-shots/discover-<view>.html`) that boxes each target on a screenshot. Combine with `--state` to discover a summoned surface (e.g. `--discover --state "view:trigger,cell:kick:0,add-effect:wave"`).

## `--click` / `--rightclick` — surfaces that only exist after a gesture

A dialog behind a button and a right-click menu have no store state to summon them, so open them
the way a user does and capture what appears:

```bash
pnpm ui-shot --route "?style#device-strip" --click "button:Add Modifier" --target ".lab-add-device" --name add-modifier
pnpm ui-shot --state "view:trigger" --rightclick ".cell" --target ".lab-ctx-content" --name cell-menu
```

Both take the same target syntax as `--target`, and both are also preset fields (`click`,
`rightclick`). `--click` runs before `--rightclick` when both are given.

A surface two gestures deep takes a chain, clicked left to right:

```bash
pnpm ui-shot --click "button:Shows >> button:New" --target "dialog:New show" --name new-show
```

## Presets (`shots.json`)

Presets are **for CI/sweep stability and locked baselines only** — not a registry you must feed for every new component. Each is a record:

```json
{ "grid-selected": { "state": "view:trigger,cell:kick:0,add-effect:wave:radial", "target": "main.center" } }
```

Fields: `state`, `target`, optional `name` (defaults to the key), optional `viewport` (`"1280x800"`), optional `settle` (ms — for animated canvases: visualizer, effect thumbnails). Run one by name (`pnpm ui-shot grid-selected`), list them (`--list`), or sweep all (`--all`).

## Conventions — capturable by convention, not maintenance

The rule is **not** "register every component." It is:

- **Every meaningful UI surface must have an accessible name** — a role + name, or an `aria-label`. If a surface is accessible, it is screenshot-able. (the Effects grid carries `role="grid"` + `aria-label="Effects grid"`; that is all `--target "role:grid[name='Effects grid']"` needs.)
- **Reusable primitives may optionally emit `data-ui`** derived from their existing props — a stable hook that costs no new state.
- **`data-shot` is reserved** for the rare surface that genuinely can't get a stable accessible name. Adding one is a smell — prefer fixing the accessible name.
- **New app state a shot needs = extend `__LEDRUMS_SHOT__`** with one adapter method (`shot-seam.ts`), never a bespoke click script in a preset.
- **Presets are baselines**, not the way you reach a new surface. Reach it ad-hoc with `--state` + `--target`; promote to a preset only when you want a stable name for CI.

## Options

`--full` (full page) · `--strict` (exit 1 on any console/page error — the clean-console gate) · `--viewport WxH` (default 1600×1000) · `--settle MS` (extra pre-capture wait) · `--name` (output basename for ad-hoc/CLI captures).

Ad-hoc raw route is still supported for edge cases: `pnpm ui-shot --route "?view=sections" --target "main.center" --name my-shot`.

## Validation

Each capture checks: the target resolved, its bounding box exists and is non-zero, and (with `--strict`) the console stayed clean. Blank-pixel detection is not yet implemented — eyeball canvas-heavy shots, and give animated surfaces a `settle`.
