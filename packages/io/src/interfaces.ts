export type PixelOutputStatus =
  | { state: 'binding' | 'ready' | 'closed' }
  | { state: 'error'; phase: 'bind' | 'setup' | 'send' | 'socket' | 'close'; message: string; code?: string };

/** Completion means local UDP acceptance ONLY, never controller acknowledgement. */
export type PixelSendCallback = (error: Error | null) => void;

/** Pixel output transport (Art-Net / sACN). Behind this interface, `core` and the
 * server are oblivious to the wire protocol. */
export interface PixelOutput {
  /** Advance the per-frame sequence counter; call once before sending a frame's universes. */
  nextFrame(): void;
  /** Fire-and-forget: true = queued, false = skipped/rejected. Neither is acceptance.
   * Completion is reported separately. Legacy void-returning adapters remain supported,
   * but callers must treat their sends as unconfirmed, not successful. */
  send(universe: number, channels: Uint8Array, done?: PixelSendCallback): boolean | void;
  /** Latched status, immediately replayed; unsubscribe releases the callback.
   * Optional ONLY for legacy adapters. Production UDP outputs always implement this. */
  onStatus?(handler: (status: PixelOutputStatus) => void): () => void;
  /** Stop accepting work and release subscribers/send callbacks immediately. Queued datagrams
   * drain before socket disposal (bounded to 250ms); optional completion reports drain errors.
   * Calling close again is a no-op. Legacy adapters may ignore completion. */
  close(done?: PixelSendCallback): void;
}

export type OscArg = number | string | Uint8Array;

export interface OscEvent {
  address: string;
  args: OscArg[];
}

/** Event input transport (OSC over UDP). */
export interface EventInput {
  on(handler: (e: OscEvent) => void): void;
  close(): void;
}
