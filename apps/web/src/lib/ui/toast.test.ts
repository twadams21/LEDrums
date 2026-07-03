import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { toastStore, pushToast } from './toast.svelte';

/* The toast store (S44): push adds an item with a tone, dismiss/clear remove them, ttl:0 keeps a
   toast until dismissed, and the default ttl auto-dismisses on a timer. Pure state + timers, no DOM. */

beforeEach(() => {
  toastStore.clear();
});
afterEach(() => {
  toastStore.clear();
  vi.useRealTimers();
});

describe('toast store', () => {
  it('pushes a toast with its message + tone and returns an id', () => {
    const id = pushToast('Pasted graph.', { tone: 'success', ttl: 0 });
    expect(toastStore.items).toHaveLength(1);
    expect(toastStore.items[0]).toMatchObject({ id, message: 'Pasted graph.', tone: 'success' });
  });

  it('defaults to the info tone', () => {
    pushToast('Heads up', { ttl: 0 });
    expect(toastStore.items[0]!.tone).toBe('info');
  });

  it('dismiss removes one toast; others survive', () => {
    const a = pushToast('a', { ttl: 0 });
    pushToast('b', { ttl: 0 });
    toastStore.dismiss(a);
    expect(toastStore.items.map((t) => t.message)).toEqual(['b']);
  });

  it('ttl:0 keeps a toast until dismissed by hand', () => {
    vi.useFakeTimers();
    pushToast('sticky', { ttl: 0 });
    vi.advanceTimersByTime(60_000);
    expect(toastStore.items).toHaveLength(1);
  });

  it('auto-dismisses after its ttl', () => {
    vi.useFakeTimers();
    pushToast('transient', { ttl: 1000 });
    expect(toastStore.items).toHaveLength(1);
    vi.advanceTimersByTime(1001);
    expect(toastStore.items).toHaveLength(0);
  });

  it('clear drops everything', () => {
    pushToast('a', { ttl: 0 });
    pushToast('b', { ttl: 0 });
    toastStore.clear();
    expect(toastStore.items).toHaveLength(0);
  });
});
