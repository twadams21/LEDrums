import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createDiscordNotifier, DISCORD_TIMEOUT_MS } from '../src/discord';
import { row } from './report-fixture';

const WEBHOOK = 'https://discord.invalid/api/webhooks/123/PRIVATE_TOKEN';
beforeEach(() => {
  vi.useFakeTimers();
  vi.spyOn(console, 'warn').mockImplementation(() => {});
});
afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe('Discord bounded best-effort transport', () => {
  it('does nothing when unconfigured (no fetch or timer)', async () => {
    const fetchFn = vi.fn<typeof fetch>();
    await createDiscordNotifier(undefined, fetchFn)(row());
    expect(fetchFn).not.toHaveBeenCalled();
    expect(vi.getTimerCount()).toBe(0);
  });

  it('posts the compatible payload, accepts 204 and cleans up its timeout', async () => {
    const fetchFn = vi.fn<typeof fetch>().mockResolvedValue(new Response(null, { status: 204 }));
    await createDiscordNotifier(WEBHOOK, fetchFn)(row());
    const [, init] = fetchFn.mock.calls[0]!;
    expect(init).toMatchObject({ method: 'POST', redirect: 'error', headers: { 'content-type': 'application/json' } });
    expect(JSON.parse(String(init?.body))).toEqual({ content: '🚨 **New error** on `rig-1` (v1, voice/web)\n> boom\ndedup: `boom`' });
    expect(init?.signal?.aborted).toBe(true);
    expect(console.warn).not.toHaveBeenCalled();
    expect(vi.getTimerCount()).toBe(0);
  });

  it.each([400, 429, 500])('handles HTTP %i without reading/logging the response body or retrying', async (status) => {
    const response = new Response(WEBHOOK, { status });
    const read = vi.spyOn(response, 'text');
    const fetchFn = vi.fn<typeof fetch>().mockResolvedValue(response);
    await createDiscordNotifier(WEBHOOK, fetchFn)(row());
    expect(console.warn).toHaveBeenCalledTimes(1);
    expect(console.warn).toHaveBeenCalledWith(`[error-ingest] Discord HTTP ${status}`);
    expect(read).not.toHaveBeenCalled();
    expect(fetchFn).toHaveBeenCalledTimes(1);
    expect(vi.getTimerCount()).toBe(0);
  });

  it.each(['reject', 'throw'])('contains fetch %s without logging credential-bearing errors', async (kind) => {
    const fetchFn = vi.fn<typeof fetch>().mockImplementation(() => {
      if (kind === 'throw') throw new Error(WEBHOOK);
      return Promise.reject(new Error(WEBHOOK));
    });
    await expect(createDiscordNotifier(WEBHOOK, fetchFn)(row())).resolves.toBeUndefined();
    expect(console.warn).toHaveBeenCalledTimes(1);
    expect(console.warn).toHaveBeenCalledWith('[error-ingest] Discord request failed');
    expect(vi.getTimerCount()).toBe(0);
  });

  it.each(['honors', 'ignores'])('settles at the deadline when fetch %s abort', async (mode) => {
    let signal: AbortSignal | null | undefined;
    let rejectLate!: (reason: Error) => void;
    const fetchFn = vi.fn<typeof fetch>().mockImplementation((_, init) => {
      signal = init?.signal;
      return new Promise((_, reject) => {
        rejectLate = reject;
        if (mode === 'honors') signal?.addEventListener('abort', () => reject(new Error(WEBHOOK)));
      });
    });
    let settled = false;
    const task = createDiscordNotifier(WEBHOOK, fetchFn)(row()).then(() => { settled = true; });
    await vi.advanceTimersByTimeAsync(DISCORD_TIMEOUT_MS - 1);
    expect(settled).toBe(false);
    expect(signal?.aborted).toBe(false);
    await vi.advanceTimersByTimeAsync(1);
    await task;
    expect(settled).toBe(true);
    expect(signal?.aborted).toBe(true);
    expect(console.warn).toHaveBeenCalledTimes(1);
    expect(console.warn).toHaveBeenCalledWith('[error-ingest] Discord timed out');
    expect(vi.getTimerCount()).toBe(0);
    // Losing the race must still consume a later rejection (Vitest catches unhandled rejections).
    rejectLate(new Error(WEBHOOK));
    await Promise.resolve();
    expect(fetchFn).toHaveBeenCalledTimes(1);
  });
});
