# PRD — CRUD completeness · Context Menu · Kit→Perform shell (2026-06-27)

> **Process note (read first).** This PRD was produced via `/codebase-design` →
> `/to-prd` → `/to-issues` from the orchestrator's audit of `feat/unified-shell`,
> then executed autonomously overnight by the orchestrator (Trent asleep; sign-off
> captured before sleep). **Tracker = `docs/*`**: this PRD lives in `docs/plans/`,
> the per-slice issues live as briefs in `docs/prompts/*.md` (the project's
> established twux `--doc` convention; GitHub Issues intentionally not used).
> Live state of the build is tracked in `docs/handoff/2026-06-27-orch-status.md`.

## Problem Statement

As the rig-builder/performer operating LEDrums, many things I can *create* I cannot
later *rename* or *delete*, and some things I cannot create at all:

- I can add a **section** and copy/paste it, but I can't **rename** or **delete** one.
- I can't **add a song**, **rename** a song, or **delete** a song — only select between
  whatever songs were seeded.
- I can rename an **authored graph** only by finding the one field buried in the
  trigger Inspector, and I can never **delete** an authored graph — orphans accumulate
  forever.
- A **show** (the whole setlist document — songs + sections + graphs + buses + presets
  + effects) has no identity: I can't name it, and I can't keep more than one. There is
  one implicit auto-saved blob and no way to start a new show, open a different one, or
  save the current one under a name.
- There is no consistent, discoverable way to reach these actions — every CRUD verb is a
  bespoke button (or missing), so the UI feels half-finished.

Separately, the shell still carries a **Perform/Author mode toggle** and a **Kit** view
that don't pull their weight: "Author" isn't really a mode, it's just whichever editor
view I'm in, and Kit duplicates what the Patch graph + a focused performance layout
should cover.

## Solution

Three coordinated pieces, from the operator's point of view:

1. **Full CRUD across the things I manage.** Sections, songs, and authored graphs each
   gain the create/rename/delete verbs they're missing. Shows become real, named
   documents I can create, open, save, rename, delete, and switch between. (Effects,
   presets, buses, and drums are intentionally left as they are — see Out of Scope.)

2. **A right-click context menu** that surfaces the relevant verbs wherever I am — on a
   section header, a song row, a graph node — so CRUD is discoverable and consistent
   instead of a scatter of bespoke buttons.

3. **A single, mode-less shell.** The Perform/Author toggle disappears. The view rail
   becomes **Trigger · Patch · Sections · Perform**. Perform is just another view — it
   hides the editing chrome (Layers/Buses drawer + right Inspector dock) for a focused
   performance layout with the visualizers + pads + section recall. The old Kit view is
   removed.

## User Stories

**Sections**
1. As a performer, I want to rename a section, so its label matches the part of the set it drives.
2. As a performer, I want to delete a section I no longer use, so my song stays tidy.
3. As a performer, I want rename/delete/duplicate available from one right-click on a section, so I don't hunt for buttons.

**Songs**
4. As a performer, I want to add a new song to my set, so I can build out a full performance.
5. As a performer, I want to rename a song, so its name reflects the track it accompanies.
6. As a performer, I want to delete a song, so retired material leaves my set.
7. As a performer, I want to right-click a song to rename/delete/duplicate it, so song management is consistent with sections.

**Authored graphs**
8. As an author, I want to rename an authored graph from where I see it (not just one buried Inspector field), so naming is discoverable.
9. As an author, I want graph rename to go through the same persisted path as every other edit, so a rename always survives reload.
10. As an author, I want to delete an authored graph I no longer reference, so orphans don't accumulate; deleting one removes it from any section that listed it.
11. As an author, I do NOT want to rename pad/kit graphs (they derive from the kit) — only authored graphs are renamable/deletable.

**Shows (full document model)**
12. As a performer, I want my current work to be a named **show**, so I can tell my shows apart.
13. As a performer, I want to create a **new** show, so I can start fresh without destroying my current one.
14. As a performer, I want to **open** a previously saved show, so I can return to it.
15. As a performer, I want to **save** the current show (and Save-As under a new name), so I deliberately persist a version.
16. As a performer, I want to **close** the current show (return to a clean state), so I can start over.
17. As a performer, I want to **rename** and **delete** shows from a show browser, so I can curate my library.
18. As a performer, I want the active show's name visible in the top bar and editable in place, so identity is always present.
19. As a performer, I want my existing implicit auto-saved work to become my first named show on upgrade, so nothing is lost.

**Context menu (foundation)**
20. As a user, I want a consistent right-click menu styled to the app's palette, so contextual actions feel native.
21. As a user, I want the menu to support an icon + label + disabled state per action, so destructive/unavailable actions read clearly.

**Shell (mode-less, Kit→Perform)**
22. As a user, I want one shell with no Perform/Author toggle, so the app stops asking me which "mode" I'm in.
23. As a user, I want a **Perform** view in the rail beside Trigger/Patch/Sections, so performance is one click away.
24. As a performer, I want the Perform view to hide the editing drawer + Inspector and show the 3D/2D visualizers + pads + section recall, so I get a focused performance layout.
25. As a user, I want the **Kit** view gone, since the Patch graph + Perform cover its ground.
26. As a user, I want view + selection state to survive the change (deep-link `?view=` still works), so nothing regresses.

## Implementation Decisions

**Seam discipline (codebase-design).** No new architectural seams. Three deep modules,
each extending an interface that already exists; the interface is the test surface.

- **CRUD lives behind the existing `TriggerLab` store + the existing `setlist` pure
  module.** The store is the deep module: each new mutator hides autosave + server-sync
  behind one call. New pure helpers (e.g. section remove; song-collection ops) join the
  `setlist` module and are tested through it. New store mutators are tested through the
  store. Callers (UI) and tests cross the same seam.
  - Section verbs: `renameSection`, `removeSection` (a new `setlist` pure helper for
    remove; rename already has an unwired pure helper to reuse).
  - Song verbs: `createSong`, `renameSong`, `removeSong` over the `songs` collection.
  - Graph verbs: `renameGraph` (a real store mutator that **replaces** the Inspector's
    current direct `graphNames` assignment) and `deleteGraph` (removes the graph from
    `graphs` + `graphNames` and from every section's graph list — orphan cleanup).
  - Each verb routes through the existing autosave; pad/kit graphs reject rename/delete.

- **Shows are a document layer over the existing authored state.** A **show** is the
  authored content (`graphs`, `graphNames`, `songs`, `buses`, `presets`, `effects`)
  given an identity. The persisted shape becomes a **show library** + an active-show
  pointer; the store's authored content is the active show's content; autosave writes the
  active show back. The server `Project` (routing/geometry/output, machine-local) is
  **orthogonal** and untouched — shows are authored-state documents only.
  - Decision shape (from the audit, not a literal API): a show ≈
    `{ id, name, authored: AuthoredState }`; persistence holds
    `{ shows: Record<id, Show>, activeShowId }`. Store API:
    `newShow`, `openShow(id)`, `saveShow` / `saveShowAs(name)`, `closeShow`,
    `renameShow(id,name)`, `deleteShow(id)`, plus `shows` (list) + `activeShow`.
  - **Migration:** an existing single persisted `AuthoredState` becomes one show
    ("Default Show" or carried name) in the new library, set active. Idempotent,
    defensive — same spirit as the existing hydrate migrations.

- **The context menu is one new `lib/ui/` wrapper** over bits-ui `ContextMenu`
  (confirmed in bits-ui v2.18.1), styled on the oklch tokens, mirroring the existing
  Select/Dialog/Tooltip wrappers. **Small interface:** an `actions` list
  (`{ label, icon?, onSelect, disabled? }`) + a trigger `children` snippet. Flat actions,
  not a compositional API (no submenus needed for the CRUD verbs — YAGNI). CRUD slices
  hang their verbs off it.

- **The shell de-modes through the existing pure `shell-nav` reducer.** Drop `Mode`
  entirely; rename the `View` member `kit`→`perform`; the rail becomes
  `Trigger · Patch · Sections · Perform`. `App.svelte` stops crossfading between
  Perform/Author shells and renders one unified shell. The unified shell hides the
  Layers/Buses drawer + right Inspector dock when `view === 'perform'`. **Perform becomes
  a workspace view** (a `PerformView`) mined from the retired `PerformShell` content
  (3D/2D visualizers + pad grid + section recall strip). `KitView`, `ModeSwitch`, and the
  old mode-split `PerformShell` are deleted. The reducer change + its unit tests move in
  **one commit** (it's the seam; tests cross it).

**Build order / prefactor.** "Make the change easy, then make the easy change."
1. Prefactor: the `ContextMenu` primitive (small, file-disjoint) lands first so the CRUD
   slices can hang verbs off it.
2. The shell de-mode is file-disjoint from all CRUD/store work and runs in parallel.
3. Section/song/graph CRUD follow (share the store + setlist module; worktree-isolated,
   orchestrator-merged, placement localized to keep merges clean).
4. The show document model lands **after** the CRUD slices (it restructures
   persistence + store init — high blast radius, so it wraps a settled authored-state
   surface rather than racing it). The show browser UI follows it.

## Testing Decisions

**What a good test is here:** exercise external behavior through the module's interface,
not its internals. The store and `setlist` module are pure/observable enough to test
directly; Svelte components are verified by typecheck + svelte-check + the autofixer, with
a live `:5173` spot-check owed at the end (no agent drives a browser).

- **`setlist` pure helpers** — new `removeSection` + song-collection helpers tested in
  `setlist.test.ts` alongside the existing `addSection`/`cloneSection`/`renameSection`
  tests (prior art: the existing flat-list + clone tests).
- **Store CRUD mutators** — section/song/graph verbs: each verb's effect on store state +
  that it persists (autosave) + that pad/kit graphs reject rename/delete + that
  `deleteGraph` purges the graph from sections. Prior art: existing store section/U4
  tests.
- **Show document model** — persistence migration (single `AuthoredState` → one-show
  library, idempotent), library serialize/deserialize roundtrip, store
  new/open/save/close/rename/delete switching the active authored content. Prior art:
  `persistence.test.ts` roundtrip + migration tests.
- **`shell-nav` reducer** — updated `shell-nav.test.ts`: no `Mode`; `View` includes
  `perform` not `kit`; `parseSearch` no longer parses mode; legacy mode-alias tests
  removed. Prior art: the existing reducer tests (the file is the seam).
- **`ContextMenu`** — verified via typecheck + svelte-autofixer + a usage site; behavior
  (right-click opens, action fires, Escape closes) is bits-ui's, covered by the spot-check.
- Full sweep (`pnpm typecheck && pnpm test`) green after every merge, on the merged clean
  tree, run by the orchestrator.

## Out of Scope

- **Effects / presets CRUD** beyond what exists (create-effect stays; no
  effect-delete/rename, no preset create/delete) — immutable-by-design today, low value.
- **Buses & drums create/delete** — the kit is fixed; geometry + poly/crossfade updates
  stay as the only mutations.
- **Server `Project` per-show** — routing/geometry/output stays machine-local and
  orthogonal to shows.
- **Cloud/remote show storage, import/export files** — shows persist to localStorage only.
- **The owed live `:5173` spot-check** of the whole prior initiative (trigger-source,
  sections, patch geometry) — tracked separately in ROUTER; this PRD adds its own
  spot-check debt, not pays the old one.

## Further Notes

- This is executed by orchestrated **git-worktree impl agents**, merged by the
  orchestrator, full-sweep-verified after each merge — the pattern that ran the prior
  initiative cleanly. Slices and their dependency order are the briefs in
  `docs/prompts/` (see the orch-status doc for the live wave/state mapping).
- `packages/core` non-negotiables are untouched: all of this is web-layer
  (`apps/web`) + the pure web modules; no core/IO changes are required.
- Every new `.svelte` file goes through the Svelte MCP / svelte-file-editor; autofixer
  must be clean.
- A live browser spot-check of CRUD + shows + the Perform view is owed and flagged at the
  end; gates/typecheck verify structure, not runtime feel.
