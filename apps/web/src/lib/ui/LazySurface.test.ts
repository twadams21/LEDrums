// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/svelte';
import { flushSync } from 'svelte';
import { lazyResource } from './lazy-resource.svelte';
import Harness from './LazySurface.test.svelte';

function deferred() {
  let resolve!: (value: string) => void;
  let reject!: (reason: Error) => void;
  const promise = new Promise<string>((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}

afterEach(() => vi.useRealTimers());

describe('LazySurface', () => {
  it('reserves busy space immediately, but only announces a genuine wait after 200ms', async () => {
    vi.useFakeTimers();
    const work = deferred();
    const resource = lazyResource(() => work.promise);
    render(Harness, { resource });
    flushSync();
    const busy = screen.getByLabelText('Editor');
    expect(busy.getAttribute('aria-busy')).toBe('true');
    // The live region is mounted at once, empty, beside the busy reserve — never
    // inside it, where assistive tech may suppress the announcement.
    const status = screen.getByRole('status');
    expect(status.textContent?.trim()).toBe('');
    expect(status.closest('[aria-busy]')).toBeNull();
    expect(busy.querySelector('[role]')).toBeNull();
    await vi.advanceTimersByTimeAsync(199);
    expect(screen.getByRole('status').textContent?.trim()).toBe('');
    await vi.advanceTimersByTimeAsync(1);
    expect(screen.getByRole('status')).toBe(status);
    expect(status.textContent).toContain('Loading Editor');
    work.resolve('Ready');
    await resource.load();
    flushSync();
    expect(screen.getByTestId('loaded').textContent).toBe('Ready');
    expect(screen.queryByRole('status')).toBeNull();
  });

  it('never flashes a fallback when cached code is remounted', async () => {
    const resource = lazyResource(async () => 'Warm');
    await resource.load();
    const first = render(Harness, { resource });
    expect(screen.getByTestId('loaded').textContent).toBe('Warm');
    await first.unmount();
    render(Harness, { resource });
    expect(screen.getByTestId('loaded').textContent).toBe('Warm');
    expect(screen.queryByLabelText('Editor')).toBeNull();
    expect(screen.queryByRole('status')).toBeNull();
  });

  it('ignores stale completion after rapid navigation and warms it for a later return', async () => {
    const a = deferred(), b = deferred();
    const first = lazyResource(() => a.promise), second = lazyResource(() => b.promise);
    const view = render(Harness, { resource: first, label: 'A' });
    flushSync();
    await view.rerender({ resource: second, label: 'B' });
    a.resolve('stale A');
    await first.load();
    flushSync();
    expect(screen.queryByTestId('loaded')).toBeNull();
    expect(screen.getByLabelText('B')).toBeTruthy();
    expect(screen.getByRole('status').textContent?.trim()).toBe('');
    b.resolve('current B');
    await second.load();
    flushSync();
    expect(screen.getByTestId('loaded').textContent).toBe('current B');
    await view.rerender({ resource: first, label: 'A' });
    expect(screen.getByTestId('loaded').textContent).toBe('stale A');
  });

  it('contains a late rejection after unmount and clears the feedback timer', async () => {
    vi.useFakeTimers();
    const work = deferred();
    const resource = lazyResource(() => work.promise);
    const view = render(Harness, { resource });
    flushSync();
    await view.unmount();
    work.reject(new Error('offline'));
    await resource.load();
    await vi.advanceTimersByTimeAsync(300);
    expect(screen.queryByRole('alert')).toBeNull();
    expect(screen.queryByRole('status')).toBeNull();
    expect(resource.state.status).toBe('error');
  });

  it('offers safe reopen guidance instead of a fake retry for an unrecoverable import', async () => {
    const resource = lazyResource(async () => { throw new SyntaxError('broken module'); }, () => false);
    render(Harness, { resource });
    expect((await screen.findByRole('alert')).textContent).toContain('Reopen the app when it’s safe to interrupt. Saved edits are kept.');
    expect(screen.queryByRole('button', { name: 'Try again' })).toBeNull();
  });

  it('shows an accessible failure and actually retries on the button', async () => {
    const importer = vi.fn<() => Promise<string>>()
      .mockRejectedValueOnce(new Error('network')).mockResolvedValueOnce('Recovered');
    const resource = lazyResource(importer);
    render(Harness, { resource });
    expect((await screen.findByRole('alert')).textContent).toContain('Couldn’t load Editor');
    await fireEvent.click(screen.getByRole('button', { name: 'Try again' }));
    await resource.load();
    flushSync();
    expect(screen.getByTestId('loaded').textContent).toBe('Recovered');
    expect(importer).toHaveBeenCalledTimes(2);
  });
});
