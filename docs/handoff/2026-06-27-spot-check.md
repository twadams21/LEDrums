# Live `:5173` spot-check — CRUD · Context Menu · Kit→Perform (owed)

All 7 slices were verified by **typecheck + svelte-check + the Svelte autofixer + unit
tests** only — **no agent drove a browser**. This is the owed manual pass. Dev stack:
web `:5173`, voice server `:4321` (`LEDRUMS_ENGINE=voice`). HEAD `2b2c651` on
`feat/unified-shell`.

## Context Menu (foundation)
- [ ] Right-click a section header / song row / authored-graph row → menu opens **at the
      cursor**, on the oklch surface, with the hover highlight + the `--live` red on
      `danger` (Delete) items. Esc / outside-click / select closes it. Keyboard nav works.

## Section CRUD (SectionsView)
- [ ] Right-click a section header → **Rename** focuses an inline input; Enter commits,
      Esc cancels. Double-click also starts rename.
- [ ] **Duplicate** clones the section; **Delete** (danger) removes it and the active
      section re-points sensibly (left neighbour → first → none). Existing copy/paste still works.
- [ ] Reload (`:5173`) — rename/delete persisted.

## Song CRUD (SongRail)
- [ ] The `+` adds a new song (auto-named, becomes active). Right-click a song row →
      Rename (inline) / Duplicate / Delete (danger). Selecting a row still activates it.
- [ ] Deleting the active song re-points; deleting the **last** song is a no-op (never
      zero songs). Reload — persisted.

## Authored-graph CRUD
- [ ] Rename an authored graph from the Inspector AND from the SectionsView graph-row menu
      — both go through `store.renameGraph`, survive reload. Pad/kit graphs are NOT renamable.
- [ ] **Delete graph** (danger) on an authored row removes it from **every** section across
      **all** songs and clears it if it was open. "Remove from section" only unlinks (graph survives).

## Shows (full document lifecycle)
- [ ] TopBar shows the active show name; click → inline edit → renames (persists).
- [ ] "Shows" opens the browser Dialog: **New** (blank active show), **Save** ("Saved ✓"
      flash), **Save As…** (inline name → new show), **Close show** (→ fresh Untitled).
- [ ] The show list opens a show on row-click (active row marked). **⚠ Right-click a show
      row INSIDE the dialog → Rename / Delete** — confirm the portaled ContextMenu (z-95)
      sits above the Dialog (z-71) and works under the dialog's focus trap (the one
      interaction structure can't verify).
- [ ] Switching shows fully swaps content — **no authored bleed** between shows. Reload
      restores the active show. Existing pre-upgrade work appears as one "Default Show"
      (legacy `ledrums:authored:v1` migrated; library at `ledrums:shows:v1`).

## Shell — mode-less + Kit→Perform
- [ ] No Perform/Author toggle anywhere. Rail = **Trigger · Patch · Sections · Perform**.
- [ ] **Perform** view hides the Layers/Buses drawer + right Inspector/Monitor dock and
      shows the 3D/2D visualizers (resizable split) + pad grid (pads fire) + section-recall strip.
- [ ] Other views keep the drawer + dock. Deep-link `?view=trigger|patch|sections|perform`
      still works; `?view=kit` no longer resolves (Kit removed).

## Engine (voice mode, if hardware/sim available)
- [ ] Switching shows / sections still drives the engine (the swap rides the existing
      debounced `setShow`/`recallSection` autosave path — verify a section recall after a
      show switch actually re-syncs, no double-send).

> Note: this is **separate** from the prior initiative's owed spot-check (trigger-source
> editing, velocity→value migration, patch geometry/dense-straddle on hardware) — see the
> earlier ROUTER "INITIATIVE COMPLETE" entry.
