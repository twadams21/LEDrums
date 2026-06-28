// @vitest-environment jsdom
import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/svelte';
import type { TriggerLab } from '../../trigger-lab/store.svelte';
import ShowBrowser from './ShowBrowser.svelte';

/* The Dialog portals its content to <body>, so we query via `screen` (whole document).
   Row rename/select is the shared EditableRow primitive (tested separately); these lock
   the ShowBrowser→store wiring + the navigation-dismisses-the-browser behaviour. */
function mockStore(over: Partial<Record<string, unknown>> = {}): TriggerLab {
  return {
    shows: [
      { id: 'sh1', name: 'Show A' },
      { id: 'sh2', name: 'Show B' },
    ],
    activeShowId: 'sh1',
    activeShow: { id: 'sh1', name: 'Show A' },
    newShow: vi.fn(),
    saveShow: vi.fn(),
    saveShowAs: vi.fn(),
    closeShow: vi.fn(),
    openShow: vi.fn(),
    renameShow: vi.fn(),
    deleteShow: vi.fn(),
    ...over,
  } as unknown as TriggerLab;
}

describe('ShowBrowser', () => {
  it('lists every show as a row when open', async () => {
    render(ShowBrowser, { props: { store: mockStore(), open: true, onClose: vi.fn() } });
    expect(await screen.findByText('Show A')).toBeTruthy();
    expect(screen.getByText('Show B')).toBeTruthy();
  });

  it('creates a new show and dismisses the browser', async () => {
    const store = mockStore();
    const onClose = vi.fn();
    render(ShowBrowser, { props: { store, open: true, onClose } });
    await fireEvent.click(await screen.findByText('New'));
    expect(store.newShow).toHaveBeenCalledTimes(1);
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('closes the active show via Close show', async () => {
    const store = mockStore();
    const onClose = vi.fn();
    render(ShowBrowser, { props: { store, open: true, onClose } });
    await fireEvent.click(await screen.findByText('Close show'));
    expect(store.closeShow).toHaveBeenCalledTimes(1);
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('opens a non-active show row and dismisses', async () => {
    const store = mockStore();
    const onClose = vi.fn();
    render(ShowBrowser, { props: { store, open: true, onClose } });
    const rowButton = (await screen.findByText('Show B')).closest('button');
    await fireEvent.click(rowButton!);
    expect(store.openShow).toHaveBeenCalledWith('sh2');
    await waitFor(() => expect(onClose).toHaveBeenCalledTimes(1));
  });

  it('does not re-open the already-active show, but still dismisses', async () => {
    const store = mockStore();
    const onClose = vi.fn();
    render(ShowBrowser, { props: { store, open: true, onClose } });
    const rowButton = (await screen.findByText('Show A')).closest('button');
    await fireEvent.click(rowButton!);
    expect(store.openShow).not.toHaveBeenCalled();
    await waitFor(() => expect(onClose).toHaveBeenCalledTimes(1));
  });
});
