# App fixes & features — plan (2026-07-05)

Two workstreams from Trent's batch: **Project export/import** (a `.ledrums` file that cold-starts the whole app from nothing) and **Trigger-graph UX fixes** (6 items). Context gathered by three Haiku explore agents (persistence, trigger-graph UI, bus/layer rate). File:line refs below are the landing zones.

> The **bus/layer 2 Hz** item was investigated (root cause: server broadcasts stats on a 500 ms `setInterval`, `apps/server/src/main.ts:650`; commit `321b9cb` only added display smoothing, not a rate fix) but **Trent has already fixed it** — dropped from this plan.

---

## A. Project export / import (`.ledrums` — full cold start)

**Goal:** one self-sufficient `.ledrums` JSON file that captures the **entire app** — physical rig + every show + every song — so it can back up, share, and boot the app **from nothing** (blank machine, empty localStorage, fresh server). Not per-show: a full Project snapshot.

### What exists today
The complete app state is split across three persistence homes — an export has to bundle **all three**:

| Domain | Where it lives | Persistence |
|---|---|---|
| **Kit geometry** (drums, hoops, `pixelsPerHoop`), **input map** (MIDI/OSC→drum), **output** (Art-Net/sACN, dataLines, universes, straddle, RGB order, fps), **controller** | core `Project` | server-authoritative (`default.local.json`) |
| **All shows** — trigger graphs, sections, buses, effects, presets, UI prefs, bpm | `ShowLibrary` (`Show[]` each with `AuthoredState`) | `ledrums:shows:v1` (localStorage) + server `default.shows.local.json` |
| **All songs** — canonical setlist songs shows reference | `SongLibrary` | `ledrums:songs:v1` + server `default.songs.local.json` |

The existing `clipdoc.ts` (versioned `ClipDoc` envelope, `CLIPDOC_VERSION`) is the pattern to mirror. Zod schemas already exist for `Project`/`kit`/`inputMap`/`output` in `@ledrums/core` (`project-schema.ts`); shows/songs coerce through the existing `deserializeAuthored`/`migrateSongs` paths.

### Design
Single versioned envelope holding the whole app:

```ts
interface LedrumsProjectFile {
  version: 1;
  kind: 'ledrums-project';
  meta: { exportedAt: string; appVersion?: string };
  project: {                          // the physical rig — the cold-start half
    name: string;
    kit: Kit;                         // geometry + outputs (dataLines/universes/straddle)
    inputMap: InputMap;
    output: OutputSettings;
    controller?: ControllerConfig;    // host + protocol; see open Q on auth hash
  };
  showLibrary: ShowLibrary;           // ALL shows + activeShowId
  songLibrary: SongLibrary;           // ALL canonical songs
}
```

Because it's the whole three-blob set, **import = restore**: apply the `project` to the server, replace the show + song libraries wholesale. A blank app fed this file comes up fully wired and playable.

### Slices
1. **Serializer/parser (pure, web).** `apps/web/src/lib/trigger-lab/project-file.ts`:
   `buildProjectFile(project, showLibrary, songLibrary) → LedrumsProjectFile` and `parseProjectFile(json) → { ok, value | error }` (validate `version`/`kind`, run `@ledrums/core` zod on `project`, coerce libraries via the existing deserialize/migrate paths). Unit-tested like `clipdoc`.
2. **Import apply (web store).** `store.importProjectFile(file)`: push the `project` half to the server (existing `setKitTransform`/`setKitOutputs`/`setInputMap`/`setOutput`, or the `setProject` bulk msg from the Rock-Solid clipboard doc if it lands first), then swap in the imported `showLibrary` + `songLibrary` (the same write-through the server already does on cold-load adopt) and re-point `activeShowId`. Since it's a full restore, default behaviour **replaces** current state — guard with a confirm dialog (this wipes the current rig + shows).
3. **Browser-side UX (no Tauri).** Export = `Blob` + anchor download (`<name>.ledrums`); Import = hidden `<input type=file accept=".ledrums">` + confirm. Wire into `ShowBrowser.svelte` (Export Project / Import Project rows) and/or a Settings surface. Runs in the plain web build too.
4. **Desktop native dialogs (Tauri).** Add `dialog` + `fs` plugins with Tauri-2 permissions (`apps/desktop/src-tauri/permissions/` is currently empty — the untracked dir in git status). New Tauri commands `export_project_file`/`import_project_file` → native save/open dialog → hand bytes to the webview (the web layer still owns serialize/parse). No native addons; stays cross-platform.

### Open questions
- **Controller auth hash** — include in export? Sharing a file would share the PixLite bond. Lean: export host/protocol, **re-pair on import** (don't ship the secret). For a personal backup you'd want it; for a shared file you wouldn't → possibly a "include controller credentials" export checkbox.
- **Import = full replace** — confirmed destructive (wipes current rig + all shows/songs). Worth a clear confirm ("Import will replace everything currently in this app"). A future "merge" mode (append shows, keep rig) is out of scope for v1.

---

## B. Trigger-graph UX fixes

All in `apps/web/src/lib/app/views/` + `docks/`. Must go through `/make-interfaces-feel-better` and use/extend the design system (regenerate `docs/design-system.html`); verify with `pnpm ui-shot`.

1. **Empty selection → Add tab.**
   `NodeEditor.svelte` (two tabs: Add + Inspector). `TriggerGraphView.svelte:66–68` flips `neTab='inspector'` when a node is selected. Add the inverse: when `shell.selection?.kind !== 'node'` (nothing/deselected), force `neTab='add'`. One-line `$effect` guard.

2. **Modifier + modulation wires get hover/selected states.**
   `GraphCanvas.svelte:194–203` styles `.edge-mod` (dashed pink) and `.edge-modulation` (dotted blue) but they have **no** `:hover`/selected rule, so they don't respond like flow wires do. Add `.edge-mod:hover .svelte-flow__edge-path` / `.edge-modulation:hover …` (and the `.selected` variants xyflow applies) around line 207 — brighten stroke, keep each wire's own hue rather than flipping to accent, so type stays legible.

3. **Modulation handle on the outer border of the node card.**
   Today the modulation param handles render **inside** the footer rows (`TriggerNode.svelte:226–239`, `param:${key}`, `.param-handle`), and the `mod` input sits inside the head (`204–211`). Requirement: move the modulation handle out to the card **perimeter**. Re-anchor the handle to the `NodeCard` (position:relative on the card, not the head/footer row) and place it on the outer edge aligned to its param row. Needs a quick live check to confirm "outer border" = card left/right perimeter vs bottom.

4. **Wires snap only to compatible handle type.**
   Currently xyflow snaps a drag to **any** handle and `canConnect`/`directionOk` (`graph-wiring.ts:20–83`) only **rejects** post-drop. There's an unused `onBeforeConnect` hook (`GraphCanvas.svelte:48,78`). Implement it: `onBeforeConnect(c) → directionOk(fromKind, toKind, toPortOf(c.targetHandle))`, threaded from `TriggerGraphView`, so incompatible handles don't accept the snap at all. Rules already encoded: `param:*` only from mod-source kinds; `mod` only from `modifier`; flow only between flow in/out.

5. **Modulation handles blue (match the pink modifier handles).**
   Per the explore, modifier handles are already `--role-mod` (pink) and modulation/param handles already `--role-modulation` (blue) (`GraphCanvas.svelte:209–217`, `TriggerNode.svelte:343–346`). So this may **already be satisfied** — or the perceived-wrong handle is a different one (e.g. an unstyled default handle reading grey). **Flag for a live `pnpm ui-shot` check first**; only restyle if the capture shows a non-blue modulation handle. Pairs naturally with #3 (moving that handle).

6. **Remove wire highlighting on node hover.**
   `TriggerGraphView.svelte:384` passes `onNodeEnter={(id) => hover.enter(id)}`; `graph-hover.svelte.ts:36–46` decorates connected wires with `.edge-hot` (`GraphCanvas.svelte:205–207`). Remove the `onNodeEnter` wiring (and the `.edge-hot` edge decoration) so hovering a node no longer lights its wires. Note memory `graph-interaction-prefs` currently says "hover highlights node border + connected wires instantly" — this request **supersedes** the wire half; keep the node-border hover, drop the wire highlight. Update that memory after.

---

## Sequencing & notes
- **B** is a tight UI batch (6 small edits, one shared explore) — one pass through `/make-interfaces-feel-better` + design-system regen + `pnpm ui-shot`. Do #5 as a *verify-then-maybe* (likely already correct). Cheapest to land first.
- **A** is the real feature — 4 slices, web-first (works in the plain build), then Tauri native dialogs. Resolve the two open questions (controller secret, replace-confirm) with Trent before slice 2 (import apply) since they change the apply semantics.
- Both owe the standing **live `:5173` spot-check** debt noted in ROUTER.md.
- (Bus/layer 2 Hz — already fixed by Trent; see the note under the title.)
