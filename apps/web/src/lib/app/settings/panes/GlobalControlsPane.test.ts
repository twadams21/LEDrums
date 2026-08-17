// @vitest-environment jsdom
import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/svelte';
import type { TriggerLab } from '../../../trigger-lab/store.svelte';
import type { InputMap } from '@ledrums/core';
import GlobalControlsPane from './GlobalControlsPane.svelte';

/* Locks the pane's re-homing wiring: the catalogue-driven binding rows are here (not on
   Input any more) and a Learn arm still reaches the store from this pane — the seam the
   modal's close path disarms. */

const INPUT_MAP = { midiNotes: [], midiChannel: null, oscMap: [], zones: [], globalControls: {}, velocityCurves: {} } as unknown as InputMap;

function mockStore(over: Partial<Record<string, unknown>> = {}): TriggerLab {
  return {
    project: { inputMap: INPUT_MAP, kit: { drums: [] } },
    drums: [],
    canEdit: true,
    globalControls: {},
    midiLearnTarget: null,
    oscLearnTarget: null,
    inputBadge: () => null,
    setGlobalControlBinding: vi.fn(),
    startMidiLearn: vi.fn(),
    cancelMidiLearn: vi.fn(),
    startOscLearn: vi.fn(),
    cancelOscLearn: vi.fn(),
    ...over,
  } as unknown as TriggerLab;
}

describe('GlobalControlsPane', () => {
  it('hosts the catalogue binding rows', () => {
    render(GlobalControlsPane, { props: { store: mockStore() } });
    expect(screen.getByText('Next song')).toBeTruthy();
    expect(screen.getByLabelText('Next song MIDI note')).toBeTruthy();
  });

  it('arms a MIDI learn against the store from this pane', async () => {
    const store = mockStore();
    render(GlobalControlsPane, { props: { store } });
    await fireEvent.click(screen.getByLabelText('Learn Next song MIDI note'));
    expect(store.startMidiLearn).toHaveBeenCalledWith({ kind: 'global-control', action: 'nextSong' });
  });

  it('titles itself from the section registry', () => {
    render(GlobalControlsPane, { props: { store: mockStore() } });
    expect(screen.getByRole('heading', { name: 'Global controls' })).toBeTruthy();
  });
});
