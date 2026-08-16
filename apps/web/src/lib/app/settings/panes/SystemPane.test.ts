// @vitest-environment jsdom
import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/svelte';
import type { TriggerLab } from '../../../trigger-lab/store.svelte';
import SystemPane from './SystemPane.svelte';

/* Locks the pane's re-homing wiring (S4e): the update flow is present and the Backups
   entry opens the existing BackupsDialog (whose refresh-on-open/restore behaviour is
   locked by its own test). */

function mockStore(over: Partial<Record<string, unknown>> = {}): TriggerLab {
  return {
    backups: [],
    isViewer: false,
    link: 'open',
    refreshBackups: vi.fn(),
    restoreBackup: vi.fn(),
    ...over,
  } as unknown as TriggerLab;
}

describe('SystemPane', () => {
  it('renders the update flow and a closed backups entry', () => {
    render(SystemPane, { props: { store: mockStore() } });
    expect(screen.getByText('Updates')).toBeTruthy();
    expect(screen.getByRole('button', { name: /Browse backups/ })).toBeTruthy();
    // Dialog closed until asked for — no refresh yet.
    expect(screen.queryByText(/No backups yet/)).toBeNull();
  });

  it('the backups entry opens BackupsDialog (which pulls the listing)', async () => {
    const store = mockStore();
    render(SystemPane, { props: { store } });
    await fireEvent.click(screen.getByRole('button', { name: /Browse backups/ }));
    expect(store.refreshBackups).toHaveBeenCalledTimes(1);
    expect(screen.getByText(/No backups yet/)).toBeTruthy();
  });

  it('stacks the backups dialog ABOVE the settings modal (layer 2)', async () => {
    render(SystemPane, { props: { store: mockStore() } });
    await fireEvent.click(screen.getByRole('button', { name: /Browse backups/ }));
    // Layer 2 = z-index modal+4 (Dialog steps 4 per layer), so its scrim covers the
    // Settings modal (layer 1, z-index modal+0) instead of fighting it in DOM order.
    const content = document.querySelector<HTMLElement>('.dlg-backups');
    expect(content?.style.zIndex).toBe('calc(var(--z-modal) + 4)');
  });
});
