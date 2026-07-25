// @vitest-environment jsdom
import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/svelte';
import type { TriggerLab } from '../../trigger-lab/store.svelte';
import type { BackupSnapshotMeta } from '../../ws/protocol-types';
import BackupsDialog from './BackupsDialog.svelte';

/* The Dialog portals to <body>, so we query via `screen`. These lock the BackupsDialog→store
   wiring: refresh-on-open, the restore confirm gate, and the viewer read-only rule. */
const SNAPS: BackupSnapshotMeta[] = [
  { id: '3000-pre-risk', createdAt: Date.now() - 5 * 60_000, reason: 'pre-risk' },
  { id: '2000-cadence', createdAt: Date.now() - 2 * 3_600_000, reason: 'cadence' },
  { id: '1000-boot', createdAt: Date.now() - 26 * 3_600_000, reason: 'boot' },
];

function mockStore(over: Partial<Record<string, unknown>> = {}): TriggerLab {
  return {
    backups: SNAPS,
    isViewer: false,
    refreshBackups: vi.fn(),
    restoreBackup: vi.fn(),
    ...over,
  } as unknown as TriggerLab;
}

describe('BackupsDialog', () => {
  it('refreshes the listing when opened', () => {
    const store = mockStore();
    render(BackupsDialog, { props: { store, open: true, onClose: vi.fn() } });
    expect(store.refreshBackups).toHaveBeenCalledTimes(1);
  });

  it('renders a row per snapshot with its reason + relative time', async () => {
    render(BackupsDialog, { props: { store: mockStore(), open: true, onClose: vi.fn() } });
    expect(await screen.findByText('Before a big change')).toBeTruthy();
    expect(screen.getByText('Auto-saved')).toBeTruthy();
    expect(screen.getByText('Session start')).toBeTruthy();
    expect(screen.getByText('5m ago')).toBeTruthy();
    expect(screen.getByText('2h ago')).toBeTruthy();
    expect(screen.getByText('1d ago')).toBeTruthy();
  });

  it('shows an empty state when there are no backups', async () => {
    render(BackupsDialog, { props: { store: mockStore({ backups: [] }), open: true, onClose: vi.fn() } });
    expect(await screen.findByText(/No backups yet/)).toBeTruthy();
  });

  it('restore takes a confirm step, then calls the store with the snapshot id and dismisses', async () => {
    const store = mockStore();
    const onClose = vi.fn();
    render(BackupsDialog, { props: { store, open: true, onClose } });
    const restoreButtons = await screen.findAllByLabelText('Restore this backup');
    await fireEvent.click(restoreButtons[0]!); // opens the confirm — nothing restored yet
    expect(store.restoreBackup).not.toHaveBeenCalled();
    await fireEvent.click(await screen.findByRole('button', { name: 'Restore' }));
    expect(store.restoreBackup).toHaveBeenCalledWith('3000-pre-risk');
    await waitFor(() => expect(onClose).toHaveBeenCalledTimes(1));
  });

  it('disables restore + shows a hint for a viewer', async () => {
    render(BackupsDialog, { props: { store: mockStore({ isViewer: true }), open: true, onClose: vi.fn() } });
    expect(await screen.findByText(/only the editor can restore/)).toBeTruthy();
    const restoreButtons = screen.getAllByLabelText('Restore this backup');
    expect((restoreButtons[0] as HTMLButtonElement).disabled).toBe(true);
  });
});
