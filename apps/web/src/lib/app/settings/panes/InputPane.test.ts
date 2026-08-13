// @vitest-environment jsdom
import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/svelte';
import type { TriggerLab } from '../../../trigger-lab/store.svelte';
import type { InputMap } from '@ledrums/core';
import InputPane from './InputPane.svelte';

/* Locks what the pane keeps after the section split (S4a §2.1 sections 1–2): the MIDI
   channel filter on its `setMidiChannel` path, the connected-device list with its empty
   state, and the OSC panel. Zone lists and global controls are their own panes now, with
   their own tests — this pane must NOT re-render them. */

const INPUT_MAP = {
  midiNotes: [],
  midiChannel: null,
  oscMap: [],
  zones: [],
  globalControls: {},
} as unknown as InputMap;

function mockStore(over: Partial<Record<string, unknown>> = {}): TriggerLab {
  return {
    project: { inputMap: INPUT_MAP, kit: { drums: [{ id: 'kick', label: 'Kick' }] } },
    drums: [{ id: 'kick', label: 'Kick' }],
    patchLabels: {},
    canEdit: true,
    midiChannel: null,
    midiAvailable: true,
    midiUnavailableReason: undefined,
    midiDevices: [],
    oscLearnTarget: null,
    oscListen: null,
    oscHeardBadge: null,
    inputBadge: () => null,
    setMidiChannel: vi.fn(),
    setInputMap: vi.fn(),
    startOscLearn: vi.fn(),
    cancelOscLearn: vi.fn(),
    ...over,
  } as unknown as TriggerLab;
}

describe('InputPane', () => {
  it('shows the MIDI-devices empty state when nothing is connected', () => {
    render(InputPane, { props: { store: mockStore() } });
    expect(screen.getByText(/No MIDI devices detected/)).toBeTruthy();
  });

  it('lists connected devices with their link state', () => {
    const devices = [
      { id: 'a', name: 'SPD-SX', state: 'connected' },
      { id: 'b', name: 'Old Pad', state: 'disconnected' },
    ];
    render(InputPane, { props: { store: mockStore({ midiDevices: devices }) } });
    expect(screen.getByText('SPD-SX')).toBeTruthy();
    expect(screen.getByText('Disconnected')).toBeTruthy();
  });

  it('shows the store channel filter, and "All channels" when unfiltered', () => {
    const { unmount } = render(InputPane, { props: { store: mockStore() } });
    expect(screen.getByText('All channels')).toBeTruthy();
    unmount();
    render(InputPane, { props: { store: mockStore({ midiChannel: 3 }) } });
    expect(screen.getByText('Channel 3')).toBeTruthy();
  });

  it('leaves zone lists and global controls to their own panes', () => {
    render(InputPane, { props: { store: mockStore() } });
    expect(screen.queryByRole('button', { name: 'Add zone' })).toBeNull();
    expect(screen.queryByLabelText('Global controls')).toBeNull();
  });
});
