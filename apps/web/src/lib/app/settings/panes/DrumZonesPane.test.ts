// @vitest-environment jsdom
import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/svelte';
import type { TriggerLab } from '../../../trigger-lab/store.svelte';
import type { InputMap } from '@ledrums/core';
import DrumZonesPane from './DrumZonesPane.svelte';

/* Locks the zone wiring this pane inherited from Input: one DrumZonesList per kit drum on
   the ONE `setInputMap` mutation path, drum headers honouring `drum:<id>` rename overrides,
   and the Inspector's fieldset read-only gate for viewers. The list's own editing behaviour
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
    midiLearnTarget: null,
    oscLearnTarget: null,
    inputBadge: () => null,
    setInputMap: vi.fn(),
    startMidiLearn: vi.fn(),
    cancelMidiLearn: vi.fn(),
    startOscLearn: vi.fn(),
    cancelOscLearn: vi.fn(),
    ...over,
  } as unknown as TriggerLab;
}

describe('DrumZonesPane', () => {
  it('renders one zone list per kit drum, in kit order', () => {
    render(DrumZonesPane, { props: { store: mockStore() } });
    const adds = screen.getAllByRole('button', { name: 'Add zone' });
    expect(adds).toHaveLength(DRUMS.length);
    for (const d of DRUMS) expect(screen.getByText(`· ${d.label}`)).toBeTruthy();
  });

  it('reads drums from the project kit (authoritative), not the build-time fixture', () => {
    render(DrumZonesPane, { props: { store: mockStore() } });
    expect(screen.queryByText('· Stale Fixture')).toBeNull();
  });

  it('falls back to the fixture drums only when offline (no project)', () => {
    render(DrumZonesPane, { props: { store: mockStore({ project: null }) } });
    expect(screen.getByText('· Stale Fixture')).toBeTruthy();
    expect(screen.queryByText('· Kick')).toBeNull();
  });

  it('drum headers honour a drum:<id> rename override', () => {
    const store = mockStore({ patchLabels: { 'drum:kick': 'Left Kick' } });
    render(DrumZonesPane, { props: { store } });
    expect(screen.getByText('· Left Kick')).toBeTruthy();
    expect(screen.queryByText('· Kick')).toBeNull();
  });

  it('adding a zone goes through store.setInputMap with the declared slot and an empty name', async () => {
    const store = mockStore();
    render(DrumZonesPane, { props: { store } });
    await fireEvent.click(screen.getAllByRole('button', { name: 'Add zone' })[0]!);
    expect(store.setInputMap).toHaveBeenCalledWith({
      ...INPUT_MAP,
      zones: [{ drumId: 'kick', slot: 0, label: '' }],
    });
  });

  it('keeps adding past the old 8-zone cap — the next add takes the next free slot', async () => {
    const zones = Array.from({ length: 9 }, (_, slot) => ({ drumId: 'kick', slot, label: '' }));
    const store = mockStore({ project: { inputMap: { ...INPUT_MAP, zones }, kit: { drums: DRUMS } } });
    render(DrumZonesPane, { props: { store } });

    await fireEvent.click(screen.getAllByRole('button', { name: 'Add zone' })[0]!);

    const written = (store.setInputMap as unknown as { mock: { calls: Array<[{ zones: Array<{ slot: number }> }]> } }).mock.calls[0]![0];
    expect(written.zones).toHaveLength(10);
    expect(written.zones.at(-1)).toEqual({ drumId: 'kick', slot: 9, label: '' });
  });

  it('shows a zone name, and its binding on one line while collapsed', () => {
    const store = mockStore({
      project: {
        inputMap: {
          ...INPUT_MAP,
          zones: [{ drumId: 'kick', slot: 0, label: 'Beater' }],
          midiNotes: [{ note: 36, drumId: 'kick', slot: 0 }],
        },
        kit: { drums: DRUMS },
      },
    });
    render(DrumZonesPane, { props: { store } });

    expect(screen.getByText('Beater')).toBeTruthy();
    expect(screen.getByText('C2')).toBeTruthy(); // the collapsed summary — no field is open
    expect(screen.queryByLabelText('Zone name')).toBeNull();
  });

  it('expands a zone to its fields, and renames through setInputMap', async () => {
    const store = mockStore({
      project: { inputMap: { ...INPUT_MAP, zones: [{ drumId: 'kick', slot: 0, label: '' }] }, kit: { drums: DRUMS } },
    });
    render(DrumZonesPane, { props: { store } });

    await fireEvent.click(screen.getByRole('button', { name: /center/ }));
    const name = screen.getByLabelText('Zone name') as HTMLInputElement;
    await fireEvent.input(name, { target: { value: 'Beater' } });
    await fireEvent.blur(name);

    expect(store.setInputMap).toHaveBeenCalledWith(
      expect.objectContaining({ zones: [{ drumId: 'kick', slot: 0, label: 'Beater' }] }),
    );
  });

  it('arms an OSC learn on a zone — the address no longer has to be typed', async () => {
    const store = mockStore({
      project: { inputMap: { ...INPUT_MAP, zones: [{ drumId: 'kick', slot: 0, label: '' }] }, kit: { drums: DRUMS } },
    });
    render(DrumZonesPane, { props: { store } });

    await fireEvent.click(screen.getByRole('button', { name: /center/ }));
    await fireEvent.click(screen.getByRole('button', { name: 'Learn zone OSC address' }));

    expect(store.startOscLearn).toHaveBeenCalledWith({ kind: 'zone', drumId: 'kick', slot: 0 });
  });

  it('a viewer gets natively-disabled zone controls (fieldset gate)', () => {
    render(DrumZonesPane, { props: { store: mockStore({ canEdit: false }) } });
    for (const add of screen.getAllByRole('button', { name: 'Add zone' })) {
      // The gate is the ancestor fieldset (Inspector idiom): natively disables
      // every nested control, DrumZonesList's included.
      expect(add.closest('fieldset')?.disabled).toBe(true);
    }
  });
});
