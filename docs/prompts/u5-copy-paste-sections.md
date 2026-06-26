# U5 — Copy / paste sections

Final slice of the trigger-source+sections rework. Builds on **U4** (sections are now `{ id, name, graphs: string[] }`, merged). You are in a **git worktree** — read `docs/prompts/_worktree-note.md` first. Branch base `feat/unified-shell`.

## Goal
Let the user **copy a section and paste it** — to duplicate an arrangement quickly. A section is now a flat ordered list of graph-key references (`SetlistSection.graphs`), so a copy is a deep copy of that list under a new id/name.

## Scope (disjoint — yours)
- `apps/web/src/lib/app/setlist.ts` — `cloneSection(section, newId, newName?)`: deep-copy `graphs` (the array of keys; references stay valid — same graphs), new `id`, name defaults to `"<name> copy"`. Add `addSection` usage as needed (exists).
- `apps/web/src/lib/trigger-lab/store.svelte.ts` — a section **clipboard** (`sectionClipboard = $state<SetlistSection | null>`) + `copySection(sectionId)` (deep-copy the section into the clipboard) and `pasteSection()` (append a clone of the clipboard as a new section to the active song, with a fresh id). A `duplicateSection(sectionId)` convenience (copy+paste in one) is welcome. Autosave already persists `songs`.
- `apps/web/src/lib/app/views/SectionsView.svelte` — UI: a copy + paste (and/or duplicate) affordance on each section header (use `IconButton` + lucide icons, tokens; the established patterns). Paste is enabled when the clipboard is non-empty.
- Use the **Svelte MCP** for the `.svelte` edit; autofixer clean.
- **Do NOT** touch core/server, `input-router`, `Inspector`, `TriggerGraphView`, patch-* — a sibling agent is concurrently editing `packages/core` integrity in a separate worktree; stay in the three files above.

## Tests
- `cloneSection` deep-copies graphs (mutating the copy doesn't touch the original), fresh id, default name; store `copySection`/`pasteSection` round-trip adds a new independent section to the active song; clipboard empty → paste is a no-op. Update any section tests as needed.

## Acceptance
- Copy a section, paste it → a new independent section with the same graph list appears in the active song; editing one doesn't affect the other. `pnpm --filter @ledrums/web typecheck` + `test` green; autofixer clean. (Live `:5173` spot-check owed — flag it.)

## Report back
Report to parent with commit SHA + files + gate output. Commit on your worktree branch (do NOT switch branches). Leave `.mex/ROUTER.md` to the orchestrator.
