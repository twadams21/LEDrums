/** Pixel output transport (Art-Net / sACN). Behind this interface, `core` and the
 * server are oblivious to the wire protocol. */
export interface PixelOutput {
  /** Advance the per-frame sequence counter; call once before sending a frame's universes. */
  nextFrame(): void;
  /** Send one universe's channel bytes. Fire-and-forget. */
  send(universe: number, channels: Uint8Array): void;
  close(): void;
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
