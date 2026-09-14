// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { buildPixelModel, DEFAULT_KIT, defaultProject, voice } from '@ledrums/core';
import { TRACK_INPUT_LIMIT, trackInputAddress, type TrackInputsStatus } from '@ledrums/protocol';
import { cleanup, fireEvent, render, screen } from '@testing-library/svelte';
import TrackInputsPanel from '../app/chrome/TrackInputsPanel.svelte';
import { TriggerLab } from './store.svelte';
import type { InputEcho, WSCallbacks, WSClient } from '../ws/client';
import type { OscLearnTarget } from './osc-learn.svelte';

const stores: TriggerLab[] = [];
beforeEach(() => {
  const memory = new Map<string, string>();
  vi.stubGlobal('localStorage', {
    get length() { return memory.size; },
    key: (i: number) => [...memory.keys()][i] ?? null,
    getItem: (key: string) => memory.get(key) ?? null,
    setItem: (key: string, value: string) => { memory.set(key, value); },
    removeItem: (key: string) => { memory.delete(key); },
    clear: () => memory.clear(),
  });
  vi.stubGlobal('requestAnimationFrame', () => 1);
  vi.stubGlobal('cancelAnimationFrame', () => {});
});
afterEach(() => { cleanup(); for (const store of stores.splice(0)) store.stop(); vi.restoreAllMocks(); vi.unstubAllGlobals(); });
function wired() {
  let callbacks: WSCallbacks = {};
  const send = vi.fn();
  const store = new TriggerLab(() => ({ on(cb: WSCallbacks) { callbacks = cb; }, connect() {}, close() {}, send }) as unknown as WSClient);
  stores.push(store);
  store.project = defaultProject();
  store.start();
  return { store, send, get cb() { return callbacks; } };
}
const status: TrackInputsStatus = { status: 'listening', port: 4322, inputs: [{ id: 'audio-track', name: 'Bass', kind: 'audio', connected: true, lastNote: null, lastChannel: null, received: 3, dropped: 0, audio: { level: 0.8, bass: 0.9, mids: 0.4, highs: 0.1 } }] };

function trackEcho(f: ReturnType<typeof wired>, id: string, control: string, value = 0.8, modulationOnly = true): string {
  const label = trackInputAddress(id, control);
  f.cb.onInput?.({ kind: 'osc', label, value, trackInputId: id, modulationOnly });
  return label;
}
function badge(store: TriggerLab, address: string) {
  return store.inputBadge({ kind: 'osc', address });
}
function state(f: ReturnType<typeof wired>, sessionId: string): void {
  f.cb.onState?.(
    f.store.project!,
    { count: 0, positions: [], tangents: [], normals: [], segmentLengths: [], drums: [], bounds: { center: [0, 0, 0], size: 0 } },
    [], [], { state: 'disabled', protocol: 'artnet', host: '', packetsSent: 0, lastError: null, universeCount: 0 },
    null, null, null, { status: 'listening', port: 9000, hosts: [] },
    0, undefined, undefined, 0, sessionId,
  );
}

describe('track input store integration', () => {
  it('selects through the existing project mutation seam, and clears through omission', () => {
    const f = wired();
    f.store.setTrackAudioInput('audio-track');
    expect(f.store.project?.inputMap.trackAudioInput).toBe('audio-track');
    expect(f.send).toHaveBeenLastCalledWith(expect.objectContaining({ t: 'setInputMap', inputMap: expect.objectContaining({ trackAudioInput: 'audio-track' }) }));
    f.store.setTrackAudioInput(undefined);
    expect(f.store.project?.inputMap.trackAudioInput).toBeUndefined();
    const last = f.send.mock.calls.at(-1)?.[0];
    expect(last.t).toBe('setInputMap');
    expect('trackAudioInput' in last.inputMap).toBe(false);
  });
  it('rejects malformed and viewer selections with no outgoing mutation', () => {
    const f = wired();
    f.send.mockClear();
    f.store.setTrackAudioInput('../unsafe');
    expect(f.send).not.toHaveBeenCalled();
    f.cb.onPresence?.('other', false, 2);
    f.store.setTrackAudioInput('audio-track');
    expect(f.send).not.toHaveBeenCalled();
    expect(f.store.project?.inputMap.trackAudioInput).toBeUndefined();
  });
  it('only the explicitly selected source supplies node meters; disconnect clears it', () => {
    const f = wired();
    f.store.createGraph('audio');
    const node = f.store.addNode('audio', 0, 0)!;
    f.store.setTrackAudioInput('audio-track');
    f.cb.onTrackInputs?.(status);
    expect(f.store.audioNodeLiveValue(node)).toBe(0.8);
    expect(f.store.trackInputs?.inputs[0]?.name).toBe('Bass');
    f.cb.onConnection?.('closed');
    expect(f.store.trackInputs).toBeNull();
    expect(f.store.audioNodeLiveValue(node)).toBe(0);
  });
  it('registration alone never replaces browser audio or auto-selects a track', () => {
    const f = wired();
    f.store.createGraph('audio');
    const node = f.store.addNode('audio', 0, 0)!;
    f.store.sim.setAudio({ ...voice.ZERO_AUDIO_FRAME, level: 0.2 });
    f.cb.onTrackInputs?.(status);
    expect(f.store.project?.inputMap.trackAudioInput).toBeUndefined();
    expect(f.store.audioNodeLiveValue(node)).toBe(0.2);
  });
  it('zeros stale selected features instead of keeping the last live value', () => {
    const f = wired();
    f.store.createGraph('audio');
    const node = f.store.addNode('audio', 0, 0)!;
    f.store.setTrackAudioInput('audio-track');
    f.cb.onTrackInputs?.(status);
    expect(f.store.audioNodeLiveValue(node)).toBe(0.8);
    f.cb.onTrackInputs?.({ ...status, inputs: [] });
    expect(f.store.audioNodeLiveValue(node)).toBe(0);
  });

  it('preserves the selected Audio freshness window and resets on an explicit source change', () => {
    const f = wired();
    f.store.createGraph('audio');
    const node = f.store.addNode('audio', 0, 0)!;
    f.store.setTrackAudioInput('audio-track');
    f.cb.onTrackInputs?.(status);
    f.store.sim.tick(voice.AUDIO_STALE_MS);
    expect(f.store.audioNodeLiveValue(node)).toBe(0.8);
    f.store.sim.tick(1);
    expect(f.store.audioNodeLiveValue(node)).toBe(0);
    f.cb.onTrackInputs?.(status);
    expect(f.store.audioNodeLiveValue(node)).toBe(0.8);
    f.store.setTrackAudioInput('another-track');
    expect(f.store.audioNodeLiveValue(node)).toBe(0);
  });

  it('clears the selected track through the offline panel without requesting browser capture', async () => {
    const getUserMedia = vi.fn();
    const AudioContext = vi.fn();
    vi.stubGlobal('navigator', { mediaDevices: { getUserMedia } });
    vi.stubGlobal('AudioContext', AudioContext);
    const f = wired();
    expect(f.store.audioSupported).toBe(true);
    f.store.setTrackAudioInput('audio-track');
    f.cb.onTrackInputs?.(status);
    f.cb.onConnection?.('closed');
    expect(f.store.canEdit).toBe(true);
    const view = render(TrackInputsPanel, {
      status: f.store.trackInputs, selected: f.store.project?.inputMap.trackAudioInput,
      canEdit: f.store.canEdit, onSelect: (id) => f.store.setTrackAudioInput(id),
    });
    const selector = screen.getByRole('button', { name: 'Audio source for graph nodes' });
    expect(selector.hasAttribute('disabled')).toBe(false);
    await fireEvent.keyDown(selector, { key: 'Enter' });
    expect(await screen.findByRole('option', { name: 'Browser / loopback capture' })).toBeTruthy();
    await fireEvent.keyDown(selector, { key: 'Home' });
    await fireEvent.keyDown(selector, { key: 'Enter' });
    expect(f.store.project?.inputMap.trackAudioInput).toBeUndefined();
    await view.rerender({ selected: f.store.project?.inputMap.trackAudioInput });
    expect(screen.getByRole('button', { name: 'Audio source for graph nodes' }).textContent).toContain('Browser / loopback capture');
    expect(f.store.audioRunning).toBe(false);
    expect(getUserMedia).not.toHaveBeenCalled();
    expect(AudioContext).not.toHaveBeenCalled();
    // Let the portaled Select finish its queued focus work before test teardown.
    await new Promise((resolve) => setTimeout(resolve, 0));
  });

  it('does not let a viewer clear a selected track even without status', () => {
    const f = wired();
    f.store.setTrackAudioInput('audio-track');
    f.cb.onPresence?.('other', false, 2);
    f.send.mockClear();
    f.store.setTrackAudioInput(undefined);
    expect(f.store.project?.inputMap.trackAudioInput).toBe('audio-track');
    expect(f.send).not.toHaveBeenCalled();
  });
});

const retiredSnapshots: [string, TrackInputsStatus][] = [
  ['device disconnected', { ...status, inputs: status.inputs.map((input) => ({ ...input, connected: false })) }],
  ['device evicted', { ...status, inputs: [] }],
  ['bridge off', { ...status, status: 'off' }],
  ['bridge error', { ...status, status: 'error', error: 'EADDRINUSE' }],
];

describe('named OSC mirror lifetime', () => {
  it.each(retiredSnapshots)('retires owned signals, badges and selected Audio on %s', (_name, snapshot) => {
    const f = wired();
    f.store.createGraph('audio');
    const node = f.store.addNode('audio', 0, 0)!;
    f.store.setTrackAudioInput('audio-track');
    f.cb.onTrackInputs?.(status);
    const addresses = ['audio/level', 'macro/1', 'midi/1/gate/38', 'midi/1/note/38', 'midi/1/cc/7']
      .map((control) => trackEcho(f, 'audio-track', control));
    for (const address of addresses) expect(badge(f.store, address)).not.toBeNull();
    f.cb.onTrackInputs?.(snapshot);
    for (const address of addresses) {
      expect(f.store.sim.oscTable.has(address)).toBe(false);
      expect(badge(f.store, address)).toBeNull();
    }
    expect(f.store.oscHeardBadge).toBeNull();
    expect(f.store.audioNodeLiveValue(node)).toBe(0);
  });

  it('retires only the disconnected ID, not another live device or ordinary /tracks addresses', () => {
    const f = wired();
    const retired = trackEcho(f, 'retired-track', 'macro/1');
    const active = trackEcho(f, 'audio-track', 'audio/level');
    const ordinary = trackInputAddress('retired-track', 'macro/2');
    f.cb.onInput?.({ kind: 'osc', label: ordinary, value: 0.4 });
    f.cb.onTrackInputs?.(status);
    expect(f.store.sim.oscTable.has(retired)).toBe(false);
    expect(badge(f.store, retired)).toBeNull();
    expect(f.store.sim.oscTable.get(active)).toBe(0.8);
    expect(badge(f.store, active)?.value).toBe('0.8');
    expect(f.store.sim.oscTable.get(ordinary)).toBe(0.4);
    expect(badge(f.store, ordinary)?.value).toBe('0.4');
  });

  it.each(['closed', 'connecting', 'auth-error', 'stop'] as const)('clears owned state on %s, preserving ordinary OSC including /tracks paths', (reason) => {
    const f = wired();
    f.store.setTrackAudioInput('audio-track');
    f.cb.onTrackInputs?.(status);
    const named = trackEcho(f, 'audio-track', 'macro/1');
    const ordinary = ['/desk/level', trackInputAddress('audio-track', 'macro/2')];
    for (const label of ordinary) f.cb.onInput?.({ kind: 'osc', label, value: 0.4 });
    if (reason === 'stop') f.store.stop();
    else if (reason === 'auth-error') f.cb.onAuthError?.();
    else f.cb.onConnection?.(reason);
    expect(f.store.sim.oscTable.has(named)).toBe(false);
    expect(badge(f.store, named)).toBeNull();
    expect(f.store.trackInputs).toBeNull();
    expect(voice.sampleAudio(f.store.sim.audioTable, 'level', f.store.sim.timeMs)).toBe(0);
    for (const address of ordinary) {
      expect(f.store.sim.oscTable.get(address)).toBe(0.4);
      expect(badge(f.store, address)?.value).toBe('0.4');
    }
    expect(f.store.oscHeardBadge?.label).toBe(ordinary[1]);
  });

  it('forgets the prior server session even when state carries no recall pointers', () => {
    const f = wired();
    f.store.setTrackAudioInput('audio-track');
    state(f, 'server-a');
    f.cb.onTrackInputs?.(status);
    const address = trackEcho(f, 'audio-track', 'audio/level');
    state(f, 'server-a');
    expect(f.store.sim.oscTable.get(address)).toBe(0.8);
    expect(f.store.trackInputs).not.toBeNull();
    state(f, 'server-b');
    expect(f.store.sim.oscTable.has(address)).toBe(false);
    expect(badge(f.store, address)).toBeNull();
    expect(f.store.oscHeardBadge).toBeNull();
    expect(f.store.trackInputs).toBeNull();
    expect(voice.sampleAudio(f.store.sim.audioTable, 'level', f.store.sim.timeMs)).toBe(0);
    trackEcho(f, 'audio-track', 'audio/level', 0.2);
    expect(f.store.sim.oscTable.get(address)).toBe(0.2);
  });

  it('deletes zero-valued keys and badges during ID churn instead of retaining tombstones', () => {
    const f = wired();
    for (let i = 0; i < TRACK_INPUT_LIMIT * 2; i++) {
      const address = trackEcho(f, `track-${i}`, 'macro/1');
      expect(badge(f.store, address)).not.toBeNull();
      trackEcho(f, `track-${i}`, 'macro/1', 0);
      expect(f.store.sim.oscTable.has(address)).toBe(false);
      expect(badge(f.store, address)).toBeNull();
      expect(f.store.oscHeardBadge).toBeNull();
    }
    expect(f.store.sim.oscTable.size).toBe(0);
  });

  it('bounds echo-only IDs before the next registry snapshot arrives', () => {
    const f = wired();
    const oldest = trackEcho(f, 'track-0', 'macro/1');
    for (let i = 1; i <= TRACK_INPUT_LIMIT; i++) trackEcho(f, `track-${i}`, 'macro/1');
    expect(f.store.sim.oscTable.size).toBe(TRACK_INPUT_LIMIT);
    expect(f.store.sim.oscTable.has(oldest)).toBe(false);
    expect(badge(f.store, oldest)).toBeNull();
  });

  it('bounds keys per ID even if the echo contains arbitrary labels', () => {
    const f = wired();
    // Conservative ceiling: all channel/note/gate/CC addresses plus bands and eight macros.
    const ceiling = 16 * 128 * 3 + voice.AUDIO_BANDS.length + 8;
    for (let i = 0; i <= ceiling; i++) {
      f.cb.onInput?.({ kind: 'osc', label: `/echo/${i}`, value: 0.5, trackInputId: 'audio-track', modulationOnly: true });
    }
    expect(f.store.sim.oscTable.size).toBe(ceiling);
    expect(f.store.sim.oscTable.has('/echo/0')).toBe(false);
    expect(badge(f.store, '/echo/0')).toBeNull();
    f.cb.onTrackInputs?.({ ...status, inputs: [] });
    expect(f.store.sim.oscTable.size).toBe(0);
  });

  it('a received named zero replaces an ordinary value at the same address, like the server table', () => {
    const f = wired();
    const address = trackInputAddress('audio-track', 'macro/1');
    f.cb.onInput?.({ kind: 'osc', label: address, value: 0.4 });
    trackEcho(f, 'audio-track', 'macro/1', 0);
    expect(f.store.sim.oscTable.has(address)).toBe(false);
    expect(badge(f.store, address)).toBeNull();
  });

  it('does not clear an ordinary OSC value that replaced an owned value at the same address', () => {
    const f = wired();
    const address = trackEcho(f, 'audio-track', 'macro/1');
    f.cb.onInput?.({ kind: 'osc', label: address, value: 0.4 });
    f.cb.onConnection?.('closed');
    expect(f.store.sim.oscTable.get(address)).toBe(0.4);
    expect(badge(f.store, address)?.value).toBe('0.4');
    f.cb.onInput?.({ kind: 'osc', label: address, value: 0 });
    expect(f.store.sim.oscTable.get(address)).toBe(0);
    expect(badge(f.store, address)?.value).toBe('0');
  });

  it('returns rendered offline pixels to black after link loss, not just the meter', () => {
    const f = wired();
    f.store.createGraph('track-render');
    const graph = f.store.selectedGraph!;
    const effectId = f.store.addNode('effect', 100, 0)!.id;
    const effect = graph.nodes.find((node) => node.id === effectId)!;
    f.store.pickEffect(effect, 'gen:solid-colour');
    f.store.setMode(effect, 'loop');
    f.store.setParam(effect, 'brightness', 0);
    f.store.addModInput(effect, 'brightness');
    const oscId = f.store.addNode('osc', 0, 100)!.id;
    const osc = graph.nodes.find((node) => node.id === oscId)!;
    const address = trackInputAddress('audio-track', 'audio/level');
    f.store.setOscNodeAddress(osc, address);
    expect(f.store.connect(graph.nodes[0]!.id, effect.id)).toBeNull();
    expect(f.store.connect(osc.id, effect.id, undefined, 'param:brightness')).toBeNull();
    f.store.sim.triggerGraph('track-render', graph, { velocity: 1, sourceDrumId: 'kick', sectionIndex: 0, sectionCount: 0, beatPhase: 0, bpm: 120 });
    f.store.sim.tick(32);
    expect(f.store.sim.voices[0]?.mode).toBe('loop');
    const model = buildPixelModel(DEFAULT_KIT);
    const rgb = () => f.store.sim.render(model).reduce((sum, value, i) => sum + (i % 4 === 3 ? 0 : value), 0);
    expect(rgb()).toBe(0);
    f.cb.onConnection?.('open');
    trackEcho(f, 'audio-track', 'audio/level');
    expect(f.store.oscNodeLiveValue(osc)).toBe(0.8);
    expect(rgb()).toBeGreaterThan(0);
    f.cb.onConnection?.('closed');
    for (let i = 0; i < 320; i++) f.store.sim.tick(16);
    expect(f.store.sim.voices.some((v) => v.active)).toBe(true);
    expect(rgb()).toBe(0);
    expect(f.store.oscNodeLiveValue(osc)).toBe(0);
  });
});

const learnTargets: OscLearnTarget[] = [
  { kind: 'global-control', action: 'nextSection' },
  { kind: 'zone', drumId: 'kick', slot: 0 },
];
describe('OSC Learn admission', () => {
  it.each(learnTargets)('keeps $kind armed through modulation-only signals and zero releases', (target) => {
    const f = wired();
    f.store.startOscLearn(target);
    const before = JSON.stringify(f.store.project?.inputMap);
    f.send.mockClear();
    const ignored: InputEcho[] = [
      ...['audio/level', 'midi/1/gate/38', 'macro/1', 'midi/1/cc/7'].map((control): InputEcho => ({
        kind: 'osc', label: trackInputAddress('audio-track', control), value: 0.8, modulationOnly: true, trackInputId: 'audio-track',
      })),
      { kind: 'osc', label: '/ordinary/modulation', value: 0.6, modulationOnly: true },
      { kind: 'osc', label: trackInputAddress('audio-track', 'midi/1/note/38'), value: 0, modulationOnly: true, trackInputId: 'audio-track' },
      { kind: 'osc', label: '/ordinary/release', value: 0, modulationOnly: true },
    ];
    for (const echo of ignored) {
      f.cb.onInput?.(echo);
      expect(f.store.oscLearnTarget).toEqual(target);
      expect(JSON.stringify(f.store.project?.inputMap)).toBe(before);
      if (echo.value > 0) {
        expect(f.store.sim.oscTable.get(echo.label)).toBe(echo.value);
        expect(badge(f.store, echo.label)).not.toBeNull();
      }
    }
    expect(f.send).not.toHaveBeenCalled();
    expect(f.store.sim.voices).toHaveLength(0);
    f.cb.onInput?.({ kind: 'osc', label: '/intended/press', value: 1 });
    expect(f.store.oscLearnTarget).toBeNull();
    expect(f.send).toHaveBeenLastCalledWith(expect.objectContaining({ t: 'setInputMap' }));
    expect(JSON.stringify(f.store.project?.inputMap)).toContain('/intended/press');
  });

  it.each(learnTargets)('still learns named note presses for $kind, with absent or false modulationOnly', (target) => {
    for (const modulationOnly of [undefined, false]) {
      const f = wired();
      f.store.startOscLearn(target);
      const label = trackInputAddress('midi-track', 'midi/1/note/38');
      f.cb.onInput?.({ kind: 'osc', label, value: 0.8, trackInputId: 'midi-track', modulationOnly });
      expect(f.store.oscLearnTarget).toBeNull();
      expect(JSON.stringify(f.store.project?.inputMap)).toContain(label);
    }
  });
});
