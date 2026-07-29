/** Transport status: bind, socket, multicast-setup, and send-completion outcomes. */
export interface PixelOutputStatus {
  state: 'ready' | 'error';
  /** Human-readable detail (message text varies; equality lives in (state, code)). */
  error?: string;
  /** Stable errno-style code, e.g. EADDRNOTAVAIL / EMCASTIFACE / EBROADCAST. */
  code?: string;
}

/** Pixel output transport (Art-Net / sACN). Behind this interface, `core` and the
 * server are oblivious to the wire protocol. Sends stay fire-and-forget, but transport
 * liveness is now observable via {@link PixelOutput.onStatus}, mirroring OscInput's
 * status channel — a dark rig says so instead of failing silently. */
export interface PixelOutput {
  /** Advance the per-frame sequence counter; call once before sending a frame's universes. */
  nextFrame(): void;
  /** Send one universe's channel bytes. Fire-and-forget. */
  send(universe: number, channels: Uint8Array): void;
  close(): void;
  /** Observe transport status (optional — test doubles need not implement it).
   * Latch-and-replay: the handler is invoked immediately with the current status if
   * one has been latched, then on every deduped, rate-floored status change. Emission
   * happens only from asynchronous socket callbacks, never on the send() call path. */
  onStatus?(handler: (s: PixelOutputStatus) => void): void;
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
