import { describe, expect, it, vi } from 'vitest';
import { lazyResource } from './lazy-resource.svelte';

describe('lazyResource', () => {
  it('does no work before requested, shares pending imports and retains warm code', async () => {
    let resolve!: (v: string) => void;
    const importer = vi.fn(() => new Promise<string>((r) => { resolve = r; }));
    const resource = lazyResource(importer);
    expect(importer).not.toHaveBeenCalled();
    expect(resource.state.status).toBe('idle');
    const first = resource.load();
    expect(resource.load()).toBe(first);
    await Promise.resolve();
    expect(importer).toHaveBeenCalledTimes(1);
    resolve('component');
    await first;
    expect(resource.state).toEqual({ status: 'ready', value: 'component' });
    await resource.load();
    await resource.retry();
    expect(importer).toHaveBeenCalledTimes(1);
  });

  it('handles failures, does not retry on navigation, and deduplicates rapid explicit retries', async () => {
    const importer = vi.fn<() => Promise<string>>()
      .mockRejectedValueOnce(new Error('offline')).mockResolvedValueOnce('ready');
    const resource = lazyResource(importer);
    await resource.load();
    expect(resource.state.status).toBe('error');
    await resource.load();
    expect(importer).toHaveBeenCalledTimes(1);
    const retry = resource.retry();
    expect(resource.retry()).toBe(retry);
    await retry;
    expect(resource.state).toEqual({ status: 'ready', value: 'ready' });
    expect(importer).toHaveBeenCalledTimes(2);
  });

  it('contains synchronous throws and keeps repeated failure retryable', async () => {
    const resource = lazyResource(() => { throw new Error('import failed'); });
    await expect(resource.load()).resolves.toBeUndefined();
    await expect(resource.retry()).resolves.toBeUndefined();
    expect(resource.state.status).toBe('error');
  });
});
