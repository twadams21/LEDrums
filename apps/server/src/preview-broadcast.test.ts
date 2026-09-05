import { describe, expect, it, vi } from 'vitest';
import type WebSocket from 'ws';
import { broadcastPreview } from './preview-broadcast';

function socket(bufferedAmount = 0, readyState: WebSocket['readyState'] = 1) {
  return { OPEN: 1 as const, readyState, bufferedAmount, send: vi.fn() };
}

describe('broadcastPreview', () => {
  it('sends the original RGB bytes as binary to open, drained clients', () => {
    const client = socket();
    const frame = new Uint8Array([1, 2, 3]);
    broadcastPreview([client], frame);
    expect(client.send).toHaveBeenCalledTimes(1);
    expect(client.send).toHaveBeenCalledWith(frame, { binary: true });
  });

  it('skips closing and closed clients', () => {
    const clients = [socket(0, 2), socket(0, 3)];
    broadcastPreview(clients, new Uint8Array(3));
    for (const client of clients) expect(client.send).not.toHaveBeenCalled();
  });

  it('does not build a stale-frame backlog or hold up healthy viewers', () => {
    const slow = socket(1);
    const fast = socket();
    for (let i = 0; i < 300; i++) broadcastPreview([slow, fast], new Uint8Array([i % 256, 0, 0]));
    expect(slow.send.mock.calls.length).toBe(0);
    expect(fast.send).toHaveBeenCalledTimes(300);

    // Once the socket drains, send only the new frame — no replay of skipped frames.
    slow.bufferedAmount = 0;
    const latest = new Uint8Array([4, 5, 6]);
    broadcastPreview([slow, fast], latest);
    expect(slow.send).toHaveBeenCalledTimes(1);
    expect(slow.send).toHaveBeenCalledWith(latest, { binary: true });
  });
});
