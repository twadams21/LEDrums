# Lane: INIT-01 chunk 01C — authority + the deletions (S8, S11+Decision-2, S12, S13)

Read `lanes/COMMON.md` and the **Chunk 01C** section of `lanes/init01-chunks.md` —
both bind. Branch: `init/01c-deletions` off `review/impl` (01A and 01B are merged;
re-measure baseline at your starting HEAD). Steps from
`09-synthesis/INIT-01-single-render-stack.json`: S8 → S11 → S12 → S13, strictly
serial, one green commit each. Highest-risk chunk of the initiative.

## Decision overrides and additions

- **Decision-2 added step (lands WITH S11):** remove `composition` + `setlist`
  from the project schema; relocate the one live bit (`composition.transport`)
  to its proper home; old files parse clean via zod strip. Greenfield — no
  migration machinery. NOTE 01A already gave the voice host transport authority
  (`setTransport`, `adoptProject` carrying composition.transport) — your
  relocation must land on that seam, not invent a second one.
- **Decision 1:** nothing depends on the legacy engine. The parity harness
  (engine-parity.test.ts, landed in 01A) pins a known drift: legacy
  setKitOutputs is a no-op — S12's deletion of the legacy runtime is the repair.
  S12 also RETIRES the parity harness into a voice-side suite per the plan.
- **S13 keeps `packages/core/src/engine/transport.ts`** — the render primitives'
  rename to `render/` is 01D's S15, not yours.

## Anchors to verify before editing

- main.ts moved under INIT-04 (ws-broadcast/ws-connection/stats-frame extracted;
  boot-project ladder; fatal-shutdown). S8's "one reducer, one project object"
  and S12's runtime deletion must be mapped onto TODAY's file layout first.
- 01B deleted the web sim mirror; store adopts stats.engine.{beat,timeMs}.
  S11's protocol deletions (14 dead composition messages) must not touch the
  stats shape the store now reads.
- The legacy `EngineHost` is deliberately NOT fault-guarded (INIT-04 left it so
  because you delete it).

## Watch

- Every deletion commit needs the import-graph/grep evidence the plan specifies —
  a green suite proves nothing about 0%-coverage legacy regions.
- `dead-code-0001` files stay HELD (PatchClipboardToolbar/PatchDiffDialog).
- Do NOT add the engine-panic protocol work (stopAll/stopBus) — it is a separate
  ticket; keep S11 to deletions + the Decision-2 relocation.
- Report: per-step shas + gates numbers + the grep/import evidence per deletion.
