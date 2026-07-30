/**
 * The `stats` wire payload's engine block.
 *
 * This type lived in `engine/engine.ts` for historical reasons — the legacy Engine produced it — but
 * it was never legacy: it is the shape the `stats` ServerMessage carries, `packages/protocol` locks
 * its zod schema against it (`_LockEngineStats`), and `apps/web`'s ws client types its `onStats`
 * callback with it. INIT-01 S13 deleted that engine, so the type moved here rather than dying with
 * its former producer.
 *
 * Nothing produces it directly any more: the voice host reports its own richer stats and
 * `apps/server/src/stats-frame.ts` ADAPTS them onto this shape (voiceCount → activeTriggers, model
 * pixel count → pixelCount, `bar` derived from the transport's `beatsPerBar`, and `tickCount` left
 * as the literal 0 the wire has always carried). So the fields below are a client contract, not an
 * engine's internals — changing one is a wire change.
 */
export interface EngineStats {
  /** Engine clock, ms since start. */
  timeMs: number;
  /** Running beat position (fractional). */
  beat: number;
  /** Completed bars — `floor(beat / beatsPerBar)`. */
  bar: number;
  /** Active voices, surfaced to the drummer as "active triggers". */
  activeTriggers: number;
  /** Legacy tick counter. Not a concept the voice engine reports; always 0 on the wire. */
  tickCount: number;
  /** Pixels in the live model. */
  pixelCount: number;
}
