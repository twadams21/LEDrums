import type { WSClient, WSCallbacks } from '../ws/client';
import type { ClientMessage } from '../ws/protocol-types';

/* Union of the two historical harness shapes: sent-recording (controller,
   server-library, patch-clipboard, song-library) and reconnect-recording (pin).
   Both extra recorders are inert unless a test asserts on them. */
export interface Harness {
  cb: WSCallbacks | null;
  sent: ClientMessage[];
  reconnects: string[];
}

export function newHarness(): Harness {
  return { cb: null, sent: [], reconnects: [] };
}

/** A WSClient that captures the callbacks the store registers and records every send, so a test
    can drive the connect handshake (onConnection/onState) and assert what the store pushes. */
export const harnessClient =
  (h: Harness): (() => WSClient) =>
  () =>
    ({
      on(cb: WSCallbacks) {
        h.cb = cb;
      },
      connect() {},
      close() {},
      send(m: ClientMessage) {
        h.sent.push(m);
      },
      reconnectWithPin(pin: string) {
        h.reconnects.push(pin);
      },
    }) as unknown as WSClient;
