# Impl brief: ui-shot hardening — semantic targets, discovery, state fixtures

**Branch:** `codex/gen3-graph-authoring` (work directly on it, small logical commits)
**Spec:** `docs/ui-shots-hardening-2026-07-08.md` — read it in full first. It is the design; this brief adds constraints, conventions, and acceptance criteria.
**Also read:** `scripts/ui-shot/README.md`, the current `scripts/ui-shot/` implementation, `scripts/ui-shot/shots.json`, and `AGENTS.md`.

## Mission

Reshape `pnpm ui-shot` so future UI surfaces are capturable **by convention instead of maintenance**:

1. **Generic target resolver** — one `--target` interface resolving in order:
   `[data-shot]` → `[data-ui]` → Playwright `getByRole(name)` → `aria-label` → visible text → title → raw CSS fallback. Prefixed forms (`role:…`, `dialog:…`, `text:…`, `node:…`, `button:…`) select a resolver explicitly; bare strings walk the chain.
2. **Discovery** — `--discover` (with `--view`/`--route`) lists capturable targets from the accessibility tree + DOM landmarks, printing ready-to-paste `--target` strings. A `.ui-shots/discover-<view>.html` overlay (boxes + generated target strings) is a nice-to-have; do it only if it falls out cheaply.
3. **State fixtures instead of click choreography** — a dev-only `window.__LEDRUMS_SHOT__` control seam (reset / setView / openGraph / addNode / selectNode / openGallery / openSettings, extend as needed), consumed via `--state "view:trigger,add:scope,select:scope"`. Gate it so it does not ship in prod bundles (`import.meta.env.DEV` or equivalent build-time guard). Implement it as a thin adapter over the existing store API — no logic duplication.
4. **Demote `shots.json` to named presets** — `{ state, target, name, viewport }` records. Every existing preset must keep working (rewrite entries onto the new fields; keep the CLI name-invocation path).

Pipeline shape (from the spec): CLI → shot request `{view?, route?, state?, target?, name?, viewport?}` → state driver → target resolver → capture validator (bbox exists, non-zero, non-blank pixels, clean console — keep the existing console-error surfacing).

## Conventions to establish (write these into `scripts/ui-shot/README.md`)

- **The rule is not "register every component."** The rule: every meaningful UI surface must have an accessible name (role + name, or `aria-label`); reusable primitives may optionally emit `data-ui` derived from existing props. If a surface is accessible, it is screenshot-able — no registration.
- `data-shot` is reserved for the rare surface that genuinely can't get a stable accessible name; treat additions of it as a smell.
- New app state that shots need = extend `__LEDRUMS_SHOT__` (one adapter function), never a bespoke click script.
- Presets in `shots.json` are for CI/sweep stability and locked baselines only.

## Fences

- You OWN `scripts/ui-shot/**`.
- You MAY add `aria-label`/role names/`data-ui` to web components where discovery needs them — minimal, mechanical, no restyling, no markup restructuring.
- Do NOT touch `packages/core`, the stores' business logic (the shot seam is additive), or any visual styling.
- Other agents may be committing to this branch concurrently — pull/rebase before each commit; your file fence should make conflicts rare.

## Acceptance criteria

- `pnpm ui-shot --view trigger --target "Node editor"` captures without any `shots.json` entry.
- `pnpm ui-shot --discover --view trigger` lists regions/dialogs/buttons/nodes with ready-to-run target strings.
- `--state` drives at least: view switching, opening a graph, adding a node kind, selecting a node, opening the effect gallery.
- Full existing preset sweep still passes (run the strict sweep per `scripts/ui-shot/README.md`; dev server via `pnpm dev`).
- `pnpm typecheck` green; any touched web tests green.
- `scripts/ui-shot/README.md` rewritten around the new interface + conventions.

## Report

When done (or blocked), report to your parent:
`twux send-message --session parent --status done|blocked --body "<commits, what works, sweep results, any deviations>"`.
