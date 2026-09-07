// @vitest-environment jsdom
import { beforeAll, describe, expect, it, vi } from 'vitest';
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
  velocityCurves: {},
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
    // Audio input (GH #214)
    audioStatus: 'idle',
    audioError: undefined,
    audioMessage: undefined,
    audioTrackLabel: undefined,
    audioSampleRate: undefined,
    audioMeter: { level: 0, bass: 0, mids: 0, highs: 0 },
    audioDevices: [],
    audioDeviceId: null,
    audioSettings: { gain: 1, noiseFloorDb: -60, attackMs: 15, releaseMs: 180 },
    audioSupported: true,
    audioUnsupportedReason: undefined,
    audioRunning: false,
    startAudio: vi.fn(async () => {}),
    stopAudio: vi.fn(),
    setAudioDevice: vi.fn(),
    setAudioSettings: vi.fn(),
    refreshAudioDevices: vi.fn(async () => {}),
    ...over,
  } as unknown as TriggerLab;
}

beforeAll(() => {
  // The audio panel's Sliders observe their track width; jsdom has no ResizeObserver.
  class ResizeObserverMock {
    observe() {}
    unobserve() {}
    disconnect() {}
  }
  vi.stubGlobal('ResizeObserver', ResizeObserverMock);
});

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

/* GH #214 — the Audio input section: explicit Enable, truthful status, four meters, and the
   routing help. Never requests capture on render. */
describe('InputPane › Audio input', () => {
  it('renders the section off by default with Enable, four meters and the routing help', () => {
    const store = mockStore();
    render(InputPane, { props: { store } });
    expect(screen.getByLabelText('Audio input')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Enable' })).toBeTruthy();
    expect(screen.getByText('Off')).toBeTruthy();
    expect(screen.getAllByRole('meter')).toHaveLength(4);
    expect(screen.getByRole('meter', { name: 'Bass' })).toBeTruthy();
    expect(screen.getByText(/Route Ableton to an audio-interface loopback/)).toBeTruthy();
    expect((store as unknown as { startAudio: ReturnType<typeof vi.fn> }).startAudio).not.toHaveBeenCalled();
  });

  it('Enable starts capture through the store; Stop while running stops it', async () => {
    const store = mockStore();
    const { unmount } = render(InputPane, { props: { store } });
    screen.getByRole('button', { name: 'Enable' }).click();
    expect((store as unknown as { startAudio: ReturnType<typeof vi.fn> }).startAudio).toHaveBeenCalledOnce();
    unmount();
    const running = mockStore({ audioStatus: 'running', audioRunning: true, audioTrackLabel: 'Loopback 1', audioSampleRate: 48000, audioMeter: { level: 0.5, bass: 0.9, mids: 0.2, highs: 0.1 } });
    render(InputPane, { props: { store: running } });
    expect(screen.getByText('Running')).toBeTruthy();
    expect(screen.getByText(/Loopback 1/)).toBeTruthy();
    expect(screen.getByRole('meter', { name: 'Bass' }).getAttribute('aria-valuenow')).toBe('90');
    screen.getByRole('button', { name: 'Stop' }).click();
    expect((running as unknown as { stopAudio: ReturnType<typeof vi.fn> }).stopAudio).toHaveBeenCalledOnce();
  });

  it('explains denied, lost and unsupported states with actionable copy', () => {
    const denied = render(InputPane, { props: { store: mockStore({ audioStatus: 'error', audioError: 'permission-denied' }) } });
    expect(screen.getByText('Permission denied')).toBeTruthy();
    expect(screen.getByRole('alert').textContent).toMatch(/Allow microphone access/);
    denied.unmount();
    const lost = render(InputPane, { props: { store: mockStore({ audioStatus: 'device-lost' }) } });
    expect(screen.getByText('Input lost')).toBeTruthy();
    lost.unmount();
    render(InputPane, { props: { store: mockStore({ audioSupported: false, audioUnsupportedReason: 'insecure-context' }) } });
    expect(screen.getByText('Unavailable')).toBeTruthy();
    expect(screen.getByText(/needs a secure page/)).toBeTruthy();
    expect((screen.getByRole('button', { name: 'Enable' }) as HTMLButtonElement).disabled).toBe(true);
  });

  it('selects the browser default input until the operator picks one, and shows a chosen device by name', () => {
    const { unmount } = render(InputPane, { props: { store: mockStore({ audioDevices: [{ id: 'a', label: 'Loopback 1' }] }) } });
    expect(screen.getByText('Default input')).toBeTruthy();
    unmount();
    render(InputPane, { props: { store: mockStore({ audioDevices: [{ id: 'a', label: 'Loopback 1' }], audioDeviceId: 'a' }) } });
    expect(screen.getByText('Loopback 1')).toBeTruthy();
  });

  it('a viewer cannot enable capture', () => {
    render(InputPane, { props: { store: mockStore({ canEdit: false }) } });
    expect((screen.getByRole('button', { name: 'Enable' }) as HTMLButtonElement).disabled).toBe(true);
    expect(screen.getByText(/Viewers can't capture/)).toBeTruthy();
  });
});
