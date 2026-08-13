// @vitest-environment jsdom
import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/svelte';
import type { TriggerLab } from '../../trigger-lab/store.svelte';
import { ShellStore } from '../shell-store.svelte';
import { SETTINGS_PANES } from '../shell-nav';
import SettingsModal from './SettingsModal.svelte';

/* Locks the modal's close path: EVERY dismissal must disarm any pending MIDI/OSC
   learn. An arm that survives the modal close is invisible, and the next stray
   input would silently bind it (adversarial-review BLOCKER). The System pane is
   the cheapest to render, so the shell opens there.

   Also locks the shell around the sections: every route is reachable from the sidebar,
   and only the ACTIVE pane is mounted — the Controller pane's watch/unwatch lifecycle
   gates the server's poll loop, so a shell that keeps inactive panes alive is a defect
   (S4a §2.4). */

function mockStore(over: Partial<Record<string, unknown>> = {}): TriggerLab {
  return {
    // SystemPane needs
    backups: [],
    isViewer: false,
    link: 'open',
    refreshBackups: vi.fn(),
    restoreBackup: vi.fn(),
    // GlobalControlsPane needs (the pane the routing test switches to)
    project: null,
    drums: [],
    canEdit: true,
    globalControls: {},
    midiLearnTarget: null,
    oscLearnTarget: null,
    inputBadge: () => null,
    setGlobalControlBinding: vi.fn(),
    startMidiLearn: vi.fn(),
    startOscLearn: vi.fn(),
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

  it('offers every routed section in the sidebar', async () => {
    render(SettingsModal, { props: { store: mockStore(), shell: new ShellStore({ settings: 'system' }) } });
    const nav = await screen.findByLabelText('Settings sections');
    const labels = [...nav.querySelectorAll('button')].map((b) => b.textContent?.trim());
    expect(labels).toEqual([
      'Input',
      'Drum trigger zones',
      'Global controls',
      'Drums & Hoops',
      'Outputs & Chains',
      'Controller',
      'System',
    ]);
    expect(SETTINGS_PANES).toHaveLength(labels.length);
  });

  it('routes a sidebar click and mounts ONLY the pane it selected', async () => {
    const shell = new ShellStore({ settings: 'system' });
    render(SettingsModal, { props: { store: mockStore(), shell } });

    await fireEvent.click(await screen.findByRole('button', { name: 'Global controls' }));

    expect(shell.settingsPane).toBe('controls');
    expect(screen.getByLabelText('Global controls')).toBeTruthy();
    // System's content is gone, not merely hidden — inactive panes must unmount.
    expect(screen.queryByRole('button', { name: /Browse backups/ })).toBeNull();
  });
});
