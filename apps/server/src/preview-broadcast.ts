import type WebSocket from 'ws';

/** Binary preview frames are replaceable; authoritative JSON messages use a separate path. */
export function broadcastPreview(
  clients: Iterable<Pick<WebSocket, 'readyState' | 'OPEN' | 'bufferedAmount' | 'send'>>,
  rgb: Uint8Array,
): void {
  for (const ws of clients) {
    // A slow viewer must not retain every historical frame on the render thread.
    // Resume with the next live frame once its existing binary/JSON traffic drains.
    if (ws.readyState === ws.OPEN && ws.bufferedAmount === 0) ws.send(rgb, { binary: true });
  }
}
