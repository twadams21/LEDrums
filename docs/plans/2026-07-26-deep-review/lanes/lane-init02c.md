# Lane: INIT-02 chunk 02C — seams + honesty tail (S14–S23)

Read `lanes/COMMON.md` and the **Chunk 02C** section of `lanes/init02-chunks.md` —
both bind. Branch: `init/02c-tail` off `review/impl` (02A+02B merged: all five
controllers public — controllerTest / midi / controllerMonitor / arrangement /
library — zero forwarders; ratchet at 318 members / 3223 LOC. Re-measure
baseline at your starting HEAD, expect ~3175). Steps from
`09-synthesis/INIT-02-store-decomposition.json`: S14–S23. Sequencing within the
chunk: S14/S15/S17/S19 are independent of each other; S16 after S15; S18 after
S17; S20 after S19; S21→S22; S23 LAST.

ANCHOR WARNING: plan line numbers predate INIT-01/02A/02B — verify every symbol
first. 02B corrections that bind you: the plan's `satisfies *Host` anchors at
store.svelte.ts:397/:538 have moved or changed shape; `showSource` is now a
public getter (02B S8 residue fix); the ratchet counts NAMES (get+set = one).

- S14: five Host seams made real — construct each controller against a stub
  host in tests, no store. Host interfaces STAY exported (11-decisions.md).
- S15→S16: characterization matrix over ShowLibrarySync/SongLibrarySync FIRST
  (pin viewer-follow, once-per-session gate, local-wins seed, echo suppression,
  serverStateSeen push gate as direct unit tests), THEN collapse into generic
  `LibrarySync<L, W>` + `LibraryCodec` in store/library-sync.ts. If the matrix
  reveals the two classes genuinely diverge, STOP and report — do not force
  the unification.
- S17: inline shell-nav transitions into ShellStore; shell-nav.ts keeps only
  View/PatchNodeId/Selection/VIEWS/parseSearch.
- S18: liveRouting/patchRouting → PatchRoutingChannel
  (patch-routing-channel.svelte.ts); ShellStore stops owning it.
- S19→S20: pin the reverse-drag wire-validation call shape (TriggerGraphView's
  deliberate end-swap) BEFORE signatures move; then WireEnds named object —
  `toPort` is the ToPort union, NOT string.
- S21→S22: localStorage writers return StorageWriteResult (callers ignore it) →
  THEN the honest save-indicator 'error' state. S22 is UI-GATED: "Saved" =
  local write only (11-decisions.md); apply /make-interfaces-feel-better and
  verify with ui-shot (pin UI_SHOT_BASE + LEDRUMS_WEB_PORT/WS_PORT to the
  lane's ports — see 02B's harness note in the parent's records; ui-shot
  defaults to :5173 and will false-fail on WS handshake otherwise).
- S23 LAST: tighten ratchet caps to measured values + emit the tracked
  follow-on (authoring-document store) as a docs entry per plan text.
- Opportunistic (in-fence, small): add a shot-seam takeover op so controller
  TAKEOVER renders are capturable (02A flagged this; shot-seam.ts is yours).
  Skip if it grows beyond ~30 lines.
- Report: per-step shas, gates numbers, ratchet trajectory, characterization
  matrix outcome, deviations.
