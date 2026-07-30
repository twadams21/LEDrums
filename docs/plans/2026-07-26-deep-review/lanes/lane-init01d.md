# Lane: INIT-01 chunk 01D — tail (S14, S15)

Read `lanes/COMMON.md` and the **Chunk 01D** section of `lanes/init01-chunks.md` —
both bind. Branch: `init/01d-tail` off `review/impl` (01A/01B/01C all merged;
re-measure baseline at your starting HEAD, expect ~3161).
Steps from `09-synthesis/INIT-01-single-render-stack.json`: S14 then S15.

- S14: unresolved-id diagnostic on the existing VoiceDiagnostic channel
  (server-scoped). Anchor-check first: 01C relocated EngineStats to
  packages/core/src/engine/stats.ts and InputEvent to apps/server/src/input-router.ts.
- S15: rename packages/core/src/engine/ → render/ (only render primitives remain:
  framebuffer, render-context, transport, stats). Mechanical; barrel + all
  importers updated in one commit; grep proves no `src/engine/` path survives.
  Note engine/transport.ts is LIVE (voice-engine-host uses advanceTransport) —
  the rename must carry it, not drop it.
- Report: per-step shas + gates numbers to parent.
