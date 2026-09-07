// @vitest-environment jsdom
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/svelte';
import type { TriggerLab } from '../../trigger-lab/store.svelte';
import { AudioController } from '../../trigger-lab/audio-controller.svelte';
import type { AudioCaptureDeps } from '../../audio/capture';
import AudioInputPanel from './AudioInputPanel.svelte';

beforeAll(() => {
  vi.stubGlobal('ResizeObserver', class { observe() {} unobserve() {} disconnect() {} });
});
afterEach(cleanup);

describe('Audio input — real controller lifecycle', () => {
  it('reactively replaces Enable with Stop, and Stop releases the captured input', async () => {
    const stopTrack = vi.fn();
    const closeContext = vi.fn(async () => {});
    const deps: AudioCaptureDeps = {
      support: { ok: true },
      getUserMedia: async () => ({ getAudioTracks: () => [{ readyState: 'live', label: 'Test loopback', stop: stopTrack, addEventListener() {}, removeEventListener() {} }] }),
      enumerateInputs: async () => [],
      createContext: () => ({
        state: 'running', sampleRate: 48000, resume: async () => {}, close: closeContext,
        createAnalyser: () => ({ fftSize: 0, smoothingTimeConstant: 0, getFloatTimeDomainData(a) { a.fill(0); }, getFloatFrequencyData(a) { a.fill(-Infinity); }, disconnect() {} }),
        createMediaStreamSource: () => ({ connect() {}, disconnect() {} }),
        addEventListener() {}, removeEventListener() {},
      }),
      setInterval: () => 1, clearInterval() {}, now: () => 0, onDeviceChange: () => () => {},
    };
    const audio = new AudioController({ deps, storage: null, isViewer: () => false, onFrame: () => {} });
    const store = {
      canEdit: true,
      get audioStatus() { return audio.status; },
      get audioError() { return audio.error; },
      get audioMessage() { return audio.message; },
      get audioTrackLabel() { return audio.trackLabel; },
      get audioSampleRate() { return audio.sampleRate; },
      get audioMeter() { return audio.meter; },
      get audioDevices() { return audio.devices; },
      get audioDeviceId() { return audio.deviceId; },
      get audioSettings() { return audio.settings; },
      get audioSupported() { return audio.supported; },
      get audioUnsupportedReason() { return audio.unsupportedReason; },
      get audioRunning() { return audio.running; },
      startAudio: () => audio.start(), stopAudio: () => audio.stop(),
      setAudioDevice: (id: string | null) => audio.setDevice(id),
      setAudioSettings: (patch: Parameters<AudioController['setSettings']>[0]) => audio.setSettings(patch),
      refreshAudioDevices: () => audio.refreshDevices(),
    } as unknown as TriggerLab;
    try {
      render(AudioInputPanel, { props: { store } });
      await fireEvent.click(screen.getByRole('button', { name: 'Enable', exact: true }));
      await waitFor(() => expect(screen.getByText(/Test loopback/)).toBeTruthy());
      const stopButton = screen.getByRole('button', { name: 'Stop', exact: true });
      await fireEvent.click(stopButton);
      await waitFor(() => expect(screen.getByRole('button', { name: 'Enable', exact: true })).toBeTruthy());
      expect(stopTrack).toHaveBeenCalledOnce();
      expect(closeContext).toHaveBeenCalledOnce();
    } finally {
      audio.dispose();
    }
  });
});
