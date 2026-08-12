// @vitest-environment jsdom
import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/svelte';
import type { TriggerLab } from '../../trigger-lab/store.svelte';
import { ShellStore } from '../shell-store.svelte';
import SettingsModal from './SettingsModal.svelte';

/* Locks the modal's close path: EVERY dismissal must disarm any pending MIDI/OSC
   learn. An arm that survives the modal close is invisible, and the next stray
   input would silently bind it (adversarial-review BLOCKER). The System pane is
   the cheapest to render, so the shell opens there. */

function mockStore(over: Partial<Record<string, unknown>> = {}): TriggerLab {
  return {
    // SystemPane needs
    backups: [],
    isViewer: false,
    link: 'open',
    refreshBackups: vi.fn(),
    restoreBackup: vi.fn(),
    // the learn-disarm seam under test
    cancelMidiLearn: vi.fn(),
    cancelOscLearn: vi.fn(),
    ...over,
  } as unknown as TriggerLab;
}

describe('SettingsModal', () => {
  it('closing via the X disarms any pending MIDI/OSC learn and closes the shell route', async () => {
    const store = mockStore();
    const shell = new ShellStore({ settings: 'system' });
    render(SettingsModal, { props: { store, shell } });

    await fireEvent.click(await screen.findByLabelText('Close settings'));

    expect(store.cancelMidiLearn).toHaveBeenCalledTimes(1);
    expect(store.cancelOscLearn).toHaveBeenCalledTimes(1);
    expect(shell.settingsPane).toBeNull();
  });

  it('closing via Escape (the Dialog dismissal path) also disarms the learns', async () => {
    const store = mockStore();
    const shell = new ShellStore({ settings: 'system' });
    render(SettingsModal, { props: { store, shell } });

    await screen.findByLabelText('Close settings'); // wait for the portal'd dialog
    await fireEvent.keyDown(document.activeElement ?? document.body, { key: 'Escape' });

    expect(store.cancelMidiLearn).toHaveBeenCalledTimes(1);
    expect(store.cancelOscLearn).toHaveBeenCalledTimes(1);
    expect(shell.settingsPane).toBeNull();
  });
});
