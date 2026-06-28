# Context Menu primitive — `lib/ui/ContextMenu.svelte`

Prefactor/foundation slice for the CRUD initiative (PRD:
`docs/plans/2026-06-27-crud-context-perform-prd.md`). Branch base
`feat/unified-shell`; you run in a worktree — read `docs/prompts/_worktree-note.md`.
**This is file-disjoint from every other slice** — you own exactly one new file.

## What this delivers
A reusable right-click **ContextMenu** wrapper in `apps/web/src/lib/ui/` that wraps the
**bits-ui `ContextMenu`** primitive (confirmed present in bits-ui v2.18.1) on the
project's oklch/green design tokens — mirroring the existing `Select.svelte` /
`Dialog.svelte` / `Tooltip.svelte` wrappers exactly. CRUD slices (section/song/graph/show)
will hang their verbs off it.

## Interface (small on purpose — a deep module)
```ts
type ContextMenuAction = {
  label: string;
  icon?: Component;            // optional @lucide/svelte icon
  onSelect: () => void;
  disabled?: boolean;
  danger?: boolean;            // destructive styling (e.g. Delete) — optional but include it
};
type Props = {
  actions: ContextMenuAction[];
  disabled?: boolean;          // disable the whole trigger
  class?: string;
  children: Snippet;           // the right-click target
};
```
Flat `actions` list — NOT a compositional/slotted API. No submenus/checkboxes (YAGNI for
the CRUD verbs). Right-click the `children` target → menu at cursor; action fires +
closes; Escape closes; keyboard nav is bits-ui's.

## Scope (ONE file)
- `apps/web/src/lib/ui/ContextMenu.svelte` — the wrapper. Compose bits-ui
  `ContextMenu.Root → Trigger (child snippet, like Tooltip's trigger) → Portal → Content →
  Item`, rendering each `action` as an `Item` with optional icon + label, `disabled`, and
  `danger` styling. Import `import { ContextMenu } from 'bits-ui';` (no barrel — siblings
  import bits-ui directly).
- **Tokens / classes** (match `Select.svelte`'s portaled-content styling): local prefix
  `.ctx-` + global `:global(.lab-ctx-…)` for portaled Content/Item. Use
  `--surface-3` (menu bg), `--border` (edge), `--radius-2`, `--shadow-3`, `--text-muted`
  (item rest), `--surface-inset` + `--ink` on `[data-highlighted]`, `0.4` opacity +
  `pointer-events:none` on `[data-disabled]`. `danger` items use the project's danger/red
  token (find it in `tokens.css`/`app.css`; reuse — don't invent). z-index ≥ Select's.
- Do **NOT** touch any other file — no integrations here (the CRUD slices integrate).

## Validation
- `pnpm --filter @ledrums/web typecheck` 0 errors; **Svelte MCP / svelte-file-editor
  mandatory** for the `.svelte` file; autofixer clean.
- No unit test for the component itself (behavior is bits-ui's + covered by the live
  spot-check). Include a short usage example **in a comment** at the top of the file so
  the CRUD slices have a copy-paste reference.

## Gate discipline
Full `pnpm typecheck && pnpm test` should stay green (you add an unreferenced new file, so
it will). Commit on your branch; do not merge.

## Acceptance
- `ContextMenu.svelte` exists, wraps bits-ui ContextMenu on tokens, mirrors the
  Select/Dialog/Tooltip convention, exposes the `actions` + `children` interface above,
  typecheck + autofixer clean. (Live spot-check of right-click behavior owed — flag it.)

## Report back
Report to parent (`twux send-message --session parent`) with commit SHA, the final
interface (any deviation from the shape above + why), the danger token used, gate result,
and the usage snippet. Commit before reporting; leave ROUTER to the orchestrator.
