import type { PixelModel } from '../geometry/pixel-model';

export interface TransportState {
  /** Absolute engine time, ms. */
  timeMs: number;
  /** Total beats elapsed since start (float). */
  beat: number;
  /** Integer bar index. */
  bar: number;
  /** Beat position within the current bar (float, 0..beatsPerBar). */
  beatInBar: number;
  bpm: number;
  beatsPerBar: number;
  playing: boolean;
}

/** A drum hit, surfaced to effects with monotonically increasing `seq` and live `ageMs`. */
export interface Trigger {
  /** Monotonic id so stateful effects can detect newly-arrived hits exactly once. */
  seq: number;
  drumId: string;
  note: number;
  /** Normalized hit strength, 0..1. */
  velocity: number;
  /** Engine time the hit landed, ms. */
  timeMs: number;
  /** Age of the hit at render time, ms. */
  ageMs: number;
}

/** Everything an effect needs to render a frame — a pure, read-only context. */
export interface RenderContext {
  model: PixelModel;
  /** Absolute engine time, ms. */
  timeMs: number;
  /** Delta since previous tick, ms. */
  dt: number;
  transport: TransportState;
  /** Active/recent triggers, newest last. */
  triggers: readonly Trigger[];
}
