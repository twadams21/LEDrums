// @vitest-environment jsdom
import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/svelte';
import type { TriggerLab } from '../../../trigger-lab/store.svelte';
import type { InputMap } from '@ledrums/core';
import InputPane from './InputPane.svelte';

/* Locks the pane's re-homing wiring (S4e): one DrumZonesList per kit drum on the ONE
   `setInputMap` mutation path, drum headers honouring `drum:<id>` rename overrides, and
   the Inspector's fieldset read-only gate for viewers. The list's own editing behaviour
   is DrumZonesList's (shared with the Trigger-graph source editor), not re-tested here. */

const INPUT_MAP = {
  midiNotes: [],
  midiChannel: null,
  oscMap: [],
  zones: [],
  globalControls: {},
} as unknown as InputMap;

const DRUMS = [
  { id: 'kick', label: 'Kick' },
  { id: 'snare', label: 'Snare' },
  { id: 'tom1', label: 'Tom 1' },
];

function mockStore(over: Partial<Record<string, unknown>> = {}): TriggerLab {
  return {
    // The zone lists must follow the AUTHORITATIVE kit, not the build-time fixture —
    // `drums` here is deliberately stale so any fixture read is visible in a test.
    project: { inputMap: INPUT_MAP, kit: { drums: DRUMS } },
    drums: [{ id: 'stale', label: 'Stale Fixture' }],
    patchLabels: {},
    canEdit: true,
    midiChannel: null,
    midiAvailable: true,
    midiUnavailableReason: undefined,
    midiDevices: [],
    midiLearnTarget: null,
    oscLearnTarget: null,
    oscListen: null,
    oscHeardBadge: null,
    globalControls: {},
    inputBadge: () => null,
    setMidiChannel: vi.fn(),
    setInputMap: vi.fn(),
    startMidiLearn: vi.fn(),
    cancelMidiLearn: vi.fn(),
    startOscLearn: vi.fn(),
    cancelOscLearn: vi.fn(),
    setGlobalControlBinding: vi.fn(),
    ...over,
  } as unknown as TriggerLab;
}

describe('InputPane', () => {
  it('renders one zone list per kit drum, in kit order', () => {
    render(InputPane, { props: { store: mockStore() } });
    const adds = screen.getAllByRole('button', { name: 'Add zone' });
    expect(adds).toHaveLength(DRUMS.length);
    for (const d of DRUMS) expect(screen.getByText(`· ${d.label}`)).toBeTruthy();
  });

  it('reads drums from the project kit (authoritative), not the build-time fixture', () => {
    render(InputPane, { props: { store: mockStore() } });
    expect(screen.queryByText('· Stale Fixture')).toBeNull();
  });

  it('falls back to the fixture drums only when offline (no project)', () => {
    render(InputPane, { props: { store: mockStore({ project: null }) } });
    expect(screen.getByText('· Stale Fixture')).toBeTruthy();
    expect(screen.queryByText('· Kick')).toBeNull();
  });

  it('drum headers honour a drum:<id> rename override', () => {
    const store = mockStore({ patchLabels: { 'drum:kick': 'Left Kick' } });
    render(InputPane, { props: { store } });
    expect(screen.getByText('· Left Kick')).toBeTruthy();
    expect(screen.queryByText('· Kick')).toBeNull();
  });

  it('adding a zone goes through store.setInputMap with the declared slot', async () => {
    const store = mockStore();
    render(InputPane, { props: { store } });
    await fireEvent.click(screen.getAllByRole('button', { name: 'Add zone' })[0]!);
    expect(store.setInputMap).toHaveBeenCalledWith({
      ...INPUT_MAP,
      zones: [{ drumId: 'kick', slot: 0 }],
    });
  });

  it('a viewer gets natively-disabled zone controls (fieldset gate)', () => {
    render(InputPane, { props: { store: mockStore({ canEdit: false }) } });
    for (const add of screen.getAllByRole('button', { name: 'Add zone' })) {
      // The gate is the ancestor fieldset (Inspector idiom): natively disables
      // every nested control, DrumZonesList's included.
      expect(add.closest('fieldset')?.disabled).toBe(true);
    }
  });

  it('shows the MIDI-devices empty state when nothing is connected', () => {
    render(InputPane, { props: { store: mockStore() } });
    expect(screen.getByText(/No MIDI devices detected/)).toBeTruthy();
  });
});
