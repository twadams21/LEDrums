// @vitest-environment jsdom
import { describe, expect, it, vi } from 'vitest';
import { render, fireEvent, waitFor } from '@testing-library/svelte';
import { createDesktopBridge, type DesktopAdapter } from '../desktop-bridge.svelte';
import type { TauriBootPayload } from '../boot-reducer';
import UpdateBadge from './UpdateBadge.svelte';

/* The startup badge surfaces desktop-bridge updateAvailable (set by the Rust startup check now that
   the native dialog is gone) and opens Settings — the shared install flow. */

function fakeAdapter(snapshot: TauriBootPayload | null): { adapter: DesktopAdapter; emit: (p: TauriBootPayload) => void } {
  let handler: ((p: unknown) => void) | null = null;
  const adapter: DesktopAdapter = {
    invoke: async <T>(command: string): Promise<T> => (command === 'get_boot_status' ? (snapshot as T) : (undefined as T)),
    listen: async (name, h) => {
      if (name === 'boot://status') handler = h;
      return () => (handler = null);
    },
  };
  return { adapter, emit: (p) => handler?.(p) };
}

describe('UpdateBadge', () => {
  it('is hidden until an update is available, then appears (startup check)', async () => {
    const fake = fakeAdapter({ stage: 'running' });
    const bridge = createDesktopBridge();
    await bridge.start(async () => fake.adapter);

    const { queryByRole } = render(UpdateBadge, { props: { bridge, onOpen: () => {} } });
    expect(queryByRole('button')).toBeNull();

    // Rust startup check publishes availability onto the boot event.
    fake.emit({ updateAvailable: true, updateVersion: '2.0.0' });
    await waitFor(() => expect(queryByRole('button')).not.toBeNull());
  });

  it('opens the settings flow when clicked', async () => {
    const fake = fakeAdapter({ stage: 'running', updateAvailable: true, updateVersion: '2.0.0' });
    const bridge = createDesktopBridge();
    await bridge.start(async () => fake.adapter);
    const onOpen = vi.fn();

    const { getByRole } = render(UpdateBadge, { props: { bridge, onOpen } });
    await fireEvent.click(getByRole('button'));
    expect(onOpen).toHaveBeenCalledOnce();
  });

  it('stays hidden while a download is in flight (dialog owns progress)', async () => {
    const fake = fakeAdapter({ stage: 'updating', progressPct: 30, updateAvailable: true });
    const bridge = createDesktopBridge();
    await bridge.start(async () => fake.adapter);
    const { queryByRole } = render(UpdateBadge, { props: { bridge, onOpen: () => {} } });
    expect(queryByRole('button')).toBeNull();
  });

  it('renders nothing in a plain browser', async () => {
    const bridge = createDesktopBridge();
    await bridge.start(async () => null);
    const { queryByRole } = render(UpdateBadge, { props: { bridge, onOpen: () => {} } });
    expect(queryByRole('button')).toBeNull();
  });
});
