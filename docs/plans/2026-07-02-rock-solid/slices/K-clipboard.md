# Group K — Clipboard portability

Context: [doc 11](../11-clipboard-portability.md) · Parent PRD: #45 · Stories: 44–46

## S43 — clipdoc module `plumbing`

**Blocked by:** S40 (shares closure extraction).

**What to build:** The pure ClipDoc module: versioned envelope (kind graph/section/song/patch +
payload + dependency closure + meta), defensive parse (never throws, version-tolerant), and
remap-on-materialize: every incoming id re-keyed through the id-reservation discipline EXCEPT
deps whose id exists locally with deep-equal content (reuse; built-in effect ids never re-keyed);
all internal refs (section graph lists, effect/preset ids, modifier wiring, modulation
param-ports) rewritten through the remap table. No UI yet — module + tests.

**Acceptance criteria:**
- [ ] Serialize/parse round-trip per kind; malformed/foreign text ⇒ typed error, never a throw
- [ ] Remap: A→B→A round-trip creates no duplicates; double-paste creates exactly one duplicate
      set; modulation/modifier ports survive remap (fixtures)
- [ ] Closure equivalence with the S40 extraction (shared code, verified by test)

## S44 — Clipboard copy/paste UI `ui-light`

**Blocked by:** S43.

**What to build:** Copy on graph rows, section headers, and song rows writes the ClipDoc envelope
to the system clipboard (in-app section clipboard kept as fast path, written in parallel). Paste
entries in the matching contexts materialize via remap; paste-song offers Library vs this-show
destination (doc 11 open item — dialog with both); friendly error toast on non-ClipDoc content;
a paste-text-field fallback where clipboard read permission is unavailable.

**Acceptance criteria:**
- [ ] Copy in one browser session, paste in another against a different server: graph, section,
      and song all arrive playable (closure intact)
- [ ] Non-ClipDoc clipboard content ⇒ toast, no state change
- [ ] Paste-song destination dialog works for both destinations

## S45 — Patch copy/paste: setProject + diff dialog `plumbing` `ui-light`

**Blocked by:** S43.

**What to build:** Copy-patch serializes the server Project slices (kit incl. outputs, input map,
output settings) as a ClipDoc. Paste applies via a new bulk set-project message — schema-validated
server-side, applied once (single kit reload, no granular-message replay), persisted, broadcast —
behind a confirm dialog that diffs the incoming patch (drum count, pixel totals, output hosts,
protocol) before apply. Monitor event on apply.

**Acceptance criteria:**
- [ ] Patch round-trips across servers; engine transmits correctly after one apply (server test
      with fakes: validate → apply-once → persist → broadcast)
- [ ] Invalid payload rejected with a user-visible error; no partial apply
- [ ] Diff dialog shows the change summary and requires explicit confirm
