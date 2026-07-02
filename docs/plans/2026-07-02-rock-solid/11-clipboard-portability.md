# 11 — Clipboard portability: copy/paste graphs, sections, songs, and the patch across servers

> Part of the 2026-07-02 "rock solid" initiative. See [INDEX.md](INDEX.md).

## Problem / workflow

Trent runs his own dev server to author content while the drummer's server is offline, then wants
to move work across when online. Needed: copy/paste of **trigger graphs**, **whole sections or
songs**, and **the patch graph** — where "paste" can land in a different browser session talking
to a different server. The system clipboard is the transfer medium (works across
machines/sessions because the payload is just text).

## Current state

- In-app section copy/paste already exists but is **transient store state only**:
  `store.sectionClipboard` + `copySection`/`pasteSection`/`duplicateSection` (U5, `bc7cbd6…`) —
  it can't cross a reload, let alone a server.
- Sections/songs reference graphs by key; a graph's play nodes reference effects/presets (+ doc
  10 modulation nodes are just graph nodes, they travel with the graph) — so section/song copy
  needs the **dependency closure**, which is exactly the machinery doc 07's Song Library builds
  (`exportSongToLibrary` closure extraction). Build it once, share it.
- The patch is a different document entirely: the server-authoritative `Project` (kit geometry +
  routing/outputs + inputMap + output settings; `packages/core/src/model/project-schema.ts`,
  zod-validated). The web edits it via granular WS messages (`setKitTransform`/`setRouting`/
  `setInputMap`/`setOutput`); there is **no bulk-set message** today.
- ID safety on paste: PR #37's nid-reservation (boot-time reservation of persisted IDs) is the
  precedent — pasted content must be re-keyed through the same discipline.

## Design

### One envelope format for everything

```ts
interface ClipDoc {
  app: 'ledrums'; v: 1;
  kind: 'graph' | 'section' | 'song' | 'patch';
  payload: …;                    // the object itself
  deps?: { graphs?, effects?, presets?, graphNames? };  // dependency closure (section/song/graph)
  meta: { exportedAt, appVersion, sourceShow? };
}
```

- Pure module `apps/web/src/lib/trigger-lab/clipdoc.ts`: `serialize(kind, id, authored) → string`
  and `parse(text) → ClipDoc | ParseError` — defensive like `deserializeShowLibrary` (never
  throws, versioned, unknown-field-tolerant). This module is the seam; the system clipboard and a
  future file export/import are two adapters over the same format (file export is a trivial later
  add — same envelope, `.ledrums.json`).
- Closure extraction shared with doc 07 (`store/song-library.ts` helpers): a graph's closure =
  its effects/presets (+ names); a section's = its graphs' closures; a song's = its sections'.

### Paste semantics (authored kinds)

- Parse → validate kind against the paste context (pasting a song into the song rail, a section
  into a song, a graph into a section or the graph list).
- **Re-key by default, reuse on identical**: every incoming id is remapped through `nid()`
  (reservation-safe), EXCEPT a dep whose id already exists locally with deep-equal content —
  reuse it (clean round-trips: copy A→B→A creates no duplicates). Built-in effect ids
  (registry-backed) are shared vocabulary and never re-keyed.
- All refs inside the payload (section graph lists, play-node effect/preset ids, modulation
  edges' `toPort`, modifier wiring) rewritten through the remap table — one pure
  `remapClipDoc(doc, existing) → materialized` function, heavily tested.
- UI: ContextMenu "Copy" on graph rows / section headers / song rows (writes the envelope via
  `navigator.clipboard.writeText`), "Paste" entries enabled by clipboard inspection where the
  browser allows (else always-enabled + friendly error toast on non-ClipDoc content). Keep the
  existing in-app section clipboard as a fast path; system clipboard is written in parallel.

### Patch copy/paste (server Project)

- Copy: serialize the relevant `Project` slices (`kit` incl. outputs, `inputMap`, `output`) into
  `kind:'patch'`.
- Paste: **bulk apply needs a new protocol message** `{ t:'setProject'; project }` — server
  zod-validates against `projectSchema`, voice host does one `reloadKit()`+`setKitOutputs()`+…
  (granular-message replay would race the autosaver and emit N rebuilds). Guarded by a
  **confirm dialog that diffs the incoming patch** (drum count, pixel totals, output hosts) —
  pasting a patch mid-show-day is the most dangerous single action this initiative adds; make the
  user read what changes. Monitor event on apply (persistence/system category).
- Version/kit mismatch (paste a 4-drum patch onto a 5-drum kit): the diff dialog shows it; apply
  is whole-document (the Project schema is self-consistent), no partial merge in v1.

## Touch list

- new `apps/web/src/lib/trigger-lab/clipdoc.ts` (+ `remapClipDoc`), closure helpers shared with
  doc 07
- store: `copyToClipboard(kind, id)` / `pasteFromClipboard(context)`; keep `sectionClipboard`
- `packages/protocol` `setProject`; `apps/server` handler + validation + single-apply;
  `voice-engine-host.ts` bulk adopt
- UI: ContextMenu entries (graph rows in SectionsView/Objects, section headers, song rows,
  Patch view toolbar), patch-diff confirm dialog

## Tests

- clipdoc: serialize/parse round-trip per kind; malformed/foreign clipboard text → ParseError
  (never throws); version tolerance.
- remap: re-key + ref rewrite (incl. modulation `param:*` ports and modifier edges); identical-
  content reuse; double-paste creates exactly one duplicate set; A→B→A round-trip no-dup.
- server: `setProject` validates, applies once, persists, broadcasts state; invalid payload
  rejected with error message.
- closure equivalence with doc 07's extraction (same fixture → same closure).

## Decisions needed (PRD)

- Whether "paste song" should offer "import to Song Library" vs "into this show" (recommend:
  dialog with both, since doc 07 makes library the canonical home).
- Clipboard permission fallback UX (Safari/Firefox read restrictions): a paste-into text field
  fallback in the dialog.
