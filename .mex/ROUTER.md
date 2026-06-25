---
name: router
description: Session bootstrap and navigation hub. Read at the start of every session before any task. Contains project state, routing table, and behavioural contract.
edges:
  - target: context/architecture.md
    condition: when working on system design, integrations, or understanding how components connect
  - target: context/stack.md
    condition: when working with specific technologies, libraries, or making tech decisions
  - target: context/conventions.md
    condition: when writing new code, reviewing code, or unsure about project patterns
  - target: context/decisions.md
    condition: when making architectural choices or understanding why something is built a certain way
  - target: context/setup.md
    condition: when setting up the dev environment or running the project for the first time
  - target: patterns/INDEX.md
    condition: when starting a task — check the pattern index for a matching pattern file
  - target: ../PRODUCT.md
    condition: when designing, restyling, or building UI — brand, register, users, and design principles (visual system in ../DESIGN.md once generated)
last_updated: 2026-06-21
---

# Session Bootstrap

If you haven't already read `AGENTS.md`, read it now — it contains the project identity, non-negotiables, and commands.

Then read this file fully before doing anything else in this session.

## Design Context

UI / visual work is governed by Impeccable design context, not the `context/` files:

- **`../PRODUCT.md`** — register (`product`), the two operators (rig-builder + performer), brand personality (*engineered, expressive, fast*), anti-references, and 5 design principles.
- **`../DESIGN.md`** — the visual system (tokens, type, components). Generated via `/impeccable document`; may be absent until then.

Read these before any redesign, restyle, or new-UI task, and drive the work with the `/impeccable` skill.

## Current Project State

**In progress: full UI redesign** (Impeccable `/craft`). Brief + locked decisions in [PRODUCT.md](../PRODUCT.md) and `docs/plans/2026-06-21-ui-redesign.md`.

**Active exploration (2026-06-21): trigger-model pivot.** Arrange is being rethought from the flat `(drum,slot)→clip` binding into a **trigger behavior tree** (Play one-shot/loop · All/Random/Sequence/Switch · Chance/Toggle) over **voice buses** (layers with a mono/poly polyphony rule + crossfade), plus section **morph/blend** (cut/morph/live two-deck). A throwaway probe lives at `apps/web/src/lib/trigger-lab/` — run `?proto=trigger` (no engine needed; see its `NOTES.md`). Three branches are under decision before the slice-3 core model refactor: voice model · block set · section blend.

**Working:**
- Engine, IO, core, WS protocol, existing panels — unchanged and functional.
- **New design foundation (done):** OKLCH token system at `apps/web/src/styles/tokens.css` (graphite canvas, AA-verified ink via `apps/web/scripts/contrast-check.mjs`, signal-flow role colours, state colours, motion/space/type scales). Geist + Geist Mono self-hosted. Base controls rebuilt in `apps/web/src/app.css`. Back-compat token aliases keep existing panels rendering on the new palette during migration. Living styleguide at `/?style`.
- **Locked decisions:** accent = phosphor lime; shells = mode-split (Perform HUD / Authoring Workbench); views = Perform · Arrange · Settings(Patch/Output/Kit); taxonomy = Content → Effects → Clip(+Preset), Blend on Layer.

**Unified shell (done — 2026-06-25, branch `feat/unified-shell`):** the cohesive app reconciling the prototype with the original control app, in `apps/web/src/lib/app/` on the `TriggerLab` store — now the default `App.svelte`. Mode-split Perform/Author crossfade, view router (Trigger/Patch/Sections/Kit), right-dock Inspector/Monitor, Layers/Buses dock, engine link + overlays reused. Pure `shell-nav` reducer (unit-tested) + thin rune store. Gates green. See `docs/plans/2026-06-21-ui-redesign.md` → "Unified application shell".

**Section-aware engine playback (done — 2026-06-25, branch `feat/unified-shell`):** `recallSection` InputEvent (deterministic, queued like other inputs) sets the engine's active song/section. On a pad hit the engine resolves the active section's per-drum slot graphs and fires them layered (in slot order), each with its own graph-key state prefix so PRNG/sequence state doesn't collide. Falls back to flat `graphs[padKey(drumId,zone)]` when no section/slots (back-compat). Web store mirrors locally + sends `recallSection` to server on section change or WS open. 8 new core tests (240 total). `Show.songs?` added to core types; `buildShow` passes songs through. Remaining: add/remove songs + setlist persistence, unify looks-recall vs slot-arrangement section notions.

**Not yet built (redesign):**
- `packages/core` model refactor: Content vs Effect split + per-instance Clip presets.
- Unified-shell view internals: Patch freeform node canvas, Kit geometry editor, Setlist persistence.

**Known issues:**
- Existing panels still use legacy token names via aliases; migrate per-view, then drop aliases.

## Routing Table

Load the relevant file based on the current task. Always load `context/architecture.md` first if not already in context this session.

| Task type | Load |
|-----------|------|
| Understanding how the system works | `context/architecture.md` |
| Working with a specific technology | `context/stack.md` |
| Writing or reviewing code | `context/conventions.md` |
| Making a design decision | `context/decisions.md` |
| Setting up or running the project | `context/setup.md` |
| Designing, restyling, or building UI | `../PRODUCT.md` (brand, register, principles) + `../DESIGN.md` (visual system, once generated); drive with `/impeccable` |
| Any specific task | Check `patterns/INDEX.md` for a matching pattern |

## Behavioural Contract

For every task, follow this loop:

1. **CONTEXT** — Load the relevant context file(s) from the routing table above. Check `patterns/INDEX.md` for a matching pattern. If one exists, follow it. Narrate what you load: "Loading architecture context..."
2. **BUILD** — Do the work. If a pattern exists, follow its Steps. If you are about to deviate from an established pattern, say so before writing any code — state the deviation and why.
3. **VERIFY** — Load `context/conventions.md` and run the Verify Checklist item by item. State each item and whether the output passes. Do not summarise — enumerate explicitly.
4. **DEBUG** — If verification fails or something breaks, check `patterns/INDEX.md` for a debug pattern. Follow it. Fix the issue and re-run VERIFY.
5. **GROW** — After meaningful work, run this binary checklist:
   - **Ground:** What changed in reality? Name the changed behavior, system, command, dependency, or workflow.
   - **Record:** If project state changed, update the "Current Project State" section above. If documented facts changed, update the relevant `context/` file surgically.
   - **Orient:** If this task can recur and no pattern exists, create one in `patterns/` using `patterns/README.md`, then add it to `patterns/INDEX.md`. If a pattern exists but you learned a gotcha, update it.
   - **Write:** Bump `last_updated` in every scaffold file you changed. If the why matters, run `mex log --type decision "<what changed and why>"` or `mex log "<note>"`.
