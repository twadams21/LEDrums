# ui-shot — semantic app screenshots

Headless captures of the running app via system Chrome (playwright-core, `channel:'chrome'` — no browser downloads). Starts `pnpm dev` automatically if the server isn't up. Output: `.ui-shots/<name>.png` (gitignored). Console/page errors during capture are printed per shot.

The interface is **semantic**, not maintenance-driven. You capture a surface by its accessible name and put the app into the state you need with a tiny state string — you do **not** register a screenshot name or hand-write a click chain.

```bash
pnpm ui-shot --view trigger --target "Node editor"                       # by accessible name
pnpm ui-shot --state "view:trigger,add:scope,select:scope" --target "Node editor" --name scope
pnpm ui-shot --discover --view trigger                                    # what can I capture here?
pnpm ui-shot gen3-scope-inspector                                         # a named preset
pnpm ui-shot --all --strict                                               # sweep, fail on console errors
```

## `--target` — the generic resolver

One flag resolves an element through a chain, accessibility first, raw CSS last:

```
[data-shot] → [data-ui] → role+name → [aria-label] → visible text → [title] → CSS
```

A **bare** string walks the whole chain. A **prefix** forces one resolver:

| prefix     | example                                             | resolver |
| ---------- | --------------------------------------------------- | -------- |
| `role:`    | `role:region[name='Trigger graph canvas']`          | `getByRole(role, { name })` |
| `dialog:`  | `dialog:Change effect`                              | dialog by accessible title |
| `text:`    | `text:Mix`                                          | visible text |
| `node:`    | `node:controller`                                   | svelte-flow node containing that text |
| `button:`  | `button:Add Scope`                                  | button by name |
| _(none)_   | `Node editor`, `main.center`, `.graphbar`           | walk the chain (CSS if all else fails) |

If a surface has an accessible name, it is screenshot-able — no registration.

## `--state` — state fixtures instead of click choreography

The hard part of a screenshot is not cropping the element; it is getting the app into the state where the element exists. Drive that with a comma-separated state string, consumed by the dev-only `window.__LEDRUMS_SHOT__` seam (`apps/web/src/lib/app/shot-seam.ts`):

```bash
pnpm ui-shot --state "view:trigger,add:mix" --target "Mix" --name mix-node
```

| op          | effect |
| ----------- | ------ |
| `view:<v>`  | switch workspace view (`perform` · `objects` · `sections` · `trigger` · `patch` · `monitor`) |
| `graph:<g>` | open a trigger graph by key / key-prefix (`snare`) / label; bare `graph` keeps the pre-selected pad |
| `new-graph` | author a fresh empty graph and select it — a clean slate for `add`/`select` free of authored-graph id clashes |
| `add:<kind>`| add a node (`scope`, `mix`, `effect`, `random`, `delay`, `lfo`, `cc`, …) to the open graph |
| `select:<k>`| select the node most recently `add`ed with that kind (flips the Node Editor to Inspector) |
| `gallery`   | open the effect gallery for the selected / last-added effect node |
| `settings`  | open the app Settings dialog |

The seam is a **thin adapter over the existing store API** (no logic duplication) and ships **only in dev** (`import.meta.env.DEV`, dynamically imported in `App.svelte`) — it is dead-code-eliminated from production bundles.

## `--discover` — ask the app what's capturable

```bash
pnpm ui-shot --discover --view trigger
```

Lists regions / dialogs / buttons / nodes from the DOM + accessibility tree with ready-to-paste `--target` strings, and writes an overlay (`.ui-shots/discover-<view>.html`) that boxes each target on a screenshot. Combine with `--state` to discover a summoned surface (e.g. `--discover --state "view:trigger,add:effect,select:effect,gallery"`).

## Presets (`shots.json`)

Presets are **for CI/sweep stability and locked baselines only** — not a registry you must feed for every new component. Each is a record:

```json
{ "gen3-scope-inspector": { "state": "view:trigger,add:scope,select:scope", "target": "Node editor" } }
```

Fields: `state`, `target`, optional `name` (defaults to the key), optional `viewport` (`"1280x800"`), optional `settle` (ms — for animated canvases: visualizer, patch, gallery). Run one by name (`pnpm ui-shot gen3-scope-inspector`), list them (`--list`), or sweep all (`--all`).

## Conventions — capturable by convention, not maintenance

The rule is **not** "register every component." It is:

- **Every meaningful UI surface must have an accessible name** — a role + name, or an `aria-label`. If a surface is accessible, it is screenshot-able. (`.node-editor` carries `aria-label="Node editor"`; that is all `--target "Node editor"` needs.)
- **Reusable primitives may optionally emit `data-ui`** derived from their existing props — a stable hook that costs no new state.
- **`data-shot` is reserved** for the rare surface that genuinely can't get a stable accessible name. Adding one is a smell — prefer fixing the accessible name.
- **New app state a shot needs = extend `__LEDRUMS_SHOT__`** with one adapter method (`shot-seam.ts`), never a bespoke click script in a preset.
- **Presets are baselines**, not the way you reach a new surface. Reach it ad-hoc with `--state` + `--target`; promote to a preset only when you want a stable name for CI.

## Options

`--full` (full page) · `--strict` (exit 1 on any console/page error — the clean-console gate) · `--viewport WxH` (default 1600×1000) · `--settle MS` (extra pre-capture wait) · `--name` (output basename for ad-hoc/CLI captures).

Ad-hoc raw route is still supported for edge cases: `pnpm ui-shot --route "?view=patch" --target "main.center" --name my-shot`.

## Validation

Each capture checks: the target resolved, its bounding box exists and is non-zero, and (with `--strict`) the console stayed clean. Blank-pixel detection is not yet implemented — eyeball canvas-heavy shots, and give animated surfaces a `settle`.
