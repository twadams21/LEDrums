import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { defaultProject, tryGetCanvasScene, type Project } from '@ledrums/core';
import type { PixelOutput } from '@ledrums/io';
import { OutputManager } from './output-manager';
import { EngineHost } from './engine-host';
import { VoiceEngineHost } from './voice-engine-host';
import { createProjectReplacement } from './project-replacement';
import { createProjectStorage } from './project-storage';
import { createSnapshotStore, type SnapshotFiles } from './backups/snapshot-store';

const dirs: string[] = [];
afterEach(async () => { await Promise.all(dirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true }))); });

function project(name: string, pixels: number, host = '127.0.0.1'): Project {
  const p = defaultProject();
  p.name = name;
  p.output = { ...p.output, state: 'armed', host, broadcast: false, fps: 60 };
  for (const drum of p.kit.drums) drum.hoops = [{ pixelCount: pixels, reverse: false }];
  p.kit.outputs = [{ id: 'out', channelsPerPixel: 3, startUniverse: 1,
    segments: [{ drumId: 'kick', hoopStart: 1, hoopEnd: 1 }] }];
  p.composition.transport.bpm = name === 'old' ? 90 : 177;
  p.inputMap.midiChannel = name === 'old' ? 1 : 9;
  p.inputMap.midiNotes = [{ note: name === 'old' ? 60 : 61, drumId: name === 'old' ? 'kick' : 'snare', slot: 0 }];
  return p;
}
function library(note = 38) {
  return { version: 1, data: { activeShowId: 'show', shows: { show: { id: 'show', name: 'Show', authored: {
    buses: [{ id: 'main', name: 'Main', polyphony: 'poly', crossfadeMs: 0 }],
    graphs: { 'graph:hit': { version: 3, nodes: [
      { id: 'trigger', kind: 'trigger', source: { kind: 'midi', note } },
      { id: 'effect', kind: 'effect', effectId: 'flash', mode: 'loop', params: { brightness: 1 }, scope: 'kit', busId: 'main' },
      { id: 'output', kind: 'output' },
    ], edges: [{ id: 'a', from: 'trigger', to: 'effect' }, { id: 'b', from: 'effect', to: 'output' }] } },
    effects: [{ id: 'flash', name: 'Flash', generatorId: 'whole-drum', busId: 'main', scope: 'kit', params: [], attackMs: 0, sustainMs: 100, releaseMs: 100 }],
    presets: [], songs: [{ id: 'song', name: 'Song', sections: [{ id: 'section', name: 'Section', graphs: ['graph:hit'], looks: {} }] }],
    activeSongId: 'song', activeSectionId: 'section',
  } } } } };
}
async function harness(mode: 'voice' | 'legacy') {
  const dir = await mkdtemp(join(tmpdir(), 'ledrums-replace-')); dirs.push(dir);
  const events: Array<{ host: string; universe: number; bytes: number[] } | string> = [];
  let factories = 0;
  const manager = new OutputManager((settings): PixelOutput => {
    factories++;
    return { nextFrame() {}, send(universe, bytes, done) {
      events.push({ host: settings.host, universe, bytes: [...bytes] }); done?.(null); return true;
    }, close(done) { events.push(`close:${settings.host}`); done?.(null); } };
  });
  const old = project('old', 180);
  const host = new EngineHost(old, mode === 'legacy' ? manager : new OutputManager(() => { throw new Error('Inactive legacy output armed'); }));
  const voiceHost = mode === 'voice' ? new VoiceEngineHost(old, null, manager) : null;
  let libs = { showLibrary: null as unknown, songLibrary: null as unknown };
  const readCurrent = (): SnapshotFiles => ({ project: host.engine.getProject(), ...libs });
  const storage = createProjectStorage(dir);
  const snapshots = createSnapshotStore({ dir: join(dir, 'backups'), now: () => 1000,
    readCurrent, applyRestored: (files) => replacement.restore(files), restoreOwnsSafety: true });
  const persist = vi.fn((files: SnapshotFiles) => { events.push(`persist:${(files.project as Project).name}`); return storage.save(files); });
  const safety = vi.fn(async () => { events.push('safety'); return await snapshots.snapshot('pre-risk') !== null; });
  const broadcast = vi.fn(() => {
    expect(voiceHost?.getProject() ?? host.engine.getProject()).toBe(host.engine.getProject());
    events.push('sync');
  });
  const replacement = createProjectReplacement({ host, voiceHost, readCurrent,
    safetySnapshot: safety, persist, flushAutosaves: async () => {},
    commitLibraries: (files) => { libs = { showLibrary: files.showLibrary, songLibrary: files.songLibrary }; },
    broadcastState: broadcast });
  const active = voiceHost ?? host;
  active.reloadOutputSettings();
  active.step(40); // submits old U1/U2 coverage via the REAL host/frame/model path
  return { host, voiceHost, active, events, storage, snapshots, replacement, readCurrent, persist, safety, broadcast,
    manager, factories: () => factories };
}

for (const mode of ['voice', 'legacy'] as const) describe(`${mode} replacement transaction`, () => {
  it('load stages both hosts and retires old universe/destination BEFORE any replacement frame', async () => {
    const h = await harness(mode);
    const oldEngine = h.active.engine;
    h.events.length = 0;
    await h.replacement.load(project('new', 2, '127.0.0.2'));
    expect(h.active.engine).not.toBe(oldEngine);
    expect(h.host.engine.getProject()).toBe(h.voiceHost?.getProject() ?? h.host.engine.getProject());
    expect(h.active.engineTimeMs).toBe(0);
    expect(h.host.engine.getProject().composition.transport.bpm).toBe(177);
    expect(h.voiceHost?.getInputMap().midiChannel ?? h.host.engine.getProject().inputMap.midiChannel).toBe(9);
    expect(await h.storage.read()).toEqual(h.readCurrent());
    expect(h.broadcast).toHaveBeenCalledOnce();
    const packets = h.events.filter((e) => typeof e !== 'string');
    expect(packets.map((e) => e.universe)).toEqual([1, 2]);
    expect(packets.every((e) => e.host === '127.0.0.1' && e.bytes.every((b) => b === 0))).toBe(true);
    expect(h.events.indexOf('safety')).toBeLessThan(h.events.indexOf('persist:new'));
    expect(h.events.indexOf('close:127.0.0.1')).toBeLessThan(h.events.indexOf('sync'));
    h.active.step(40);
    expect(h.active.getStats().engine.beat).toBeCloseTo(177 * 40 / 60_000);
    const last = h.events.at(-1);
    expect(last).toMatchObject({ host: '127.0.0.2', universe: 1 });
    expect(h.factories()).toBe(2);
    await h.active.stop();
  });

  it('restore persists null libraries exactly and converges without browser resync', async () => {
    const h = await harness(mode);
    await h.replacement.restore({ project: project('new', 3), showLibrary: library(70), songLibrary: { version: 1, data: { songs: {} } } });
    const meta = await h.snapshots.snapshot('boot');
    await h.replacement.restore({ project: project('empty', 1), showLibrary: null, songLibrary: null });
    expect(h.readCurrent().showLibrary).toBeNull();
    expect(h.voiceHost?.getShow() ?? null).toBeNull();
    expect((await h.storage.read())?.showLibrary).toBeNull();
    await h.snapshots.restore(meta!.id);
    expect(h.host.engine.getProject().name).toBe('new');
    expect(h.broadcast).toHaveBeenCalledTimes(3);
    if (h.voiceHost) {
      expect(h.voiceHost.getActiveSongId()).toBe('song');
      expect(h.voiceHost.engine.frame().length).toBe(h.voiceHost.getModel().pixelCount * 4);
      h.voiceHost.applyInput({ kind: 'noteOn', note: 70, velocity: 1 });
      h.voiceHost.step(10);
      expect(h.voiceHost.getStats().engine.voiceCount).toBe(1);
      const liveEngine = h.voiceHost.engine;
      await h.replacement.load(project('fresh', 8));
      expect(h.voiceHost.engine).not.toBe(liveEngine);
      expect(h.voiceHost.engine.frame().length).toBe(h.voiceHost.getModel().pixelCount * 4);
      expect(h.voiceHost.getStats().engine.voiceCount).toBe(0);
    }
    await h.active.stop();
  });

  it('uses the replacement MIDI-to-drum mapping on the next actual runtime input', async () => {
    const h = await harness(mode);
    const lib = library();
    Object.assign(lib.data.shows.show.authored.graphs['graph:hit'].nodes[0]!, { source: { kind: 'drum', drumId: 'snare', zone: '0' } });
    await h.replacement.restore({ project: project('mapped', 3), showLibrary: lib, songLibrary: null });
    h.host.engine.setActiveClip('trigger', null);
    const activeClip = () => h.host.engine.getProject().composition.layers.find((l) => l.id === 'trigger')!.activeClipId;
    h.active.applyInput({ kind: 'noteOn', note: 60, velocity: 1 }); h.active.step(10);
    if (h.voiceHost) expect(h.voiceHost.getStats().engine.voiceCount).toBe(0);
    else expect(activeClip()).toBeNull(); // legacy deliberately keeps generic unmapped triggers
    h.active.applyInput({ kind: 'noteOn', note: 61, velocity: 1 }); h.active.step(10);
    if (h.voiceHost) expect(h.voiceHost.getStats().engine.voiceCount).toBe(1);
    else expect(activeClip()).toBe('chase'); // the NEW snare mapping, not old kick/whole-drum
    await h.active.stop();
  });

  it('validation, safety failure and disk failure preserve live engine/frame identities', async () => {
    const h = await harness(mode);
    const engine = h.active.engine;
    const frame = h.voiceHost ? h.voiceHost.engine.frame() : h.host.engine.getFrame();
    await expect(h.replacement.load({})).rejects.toThrow();
    await expect(h.replacement.restore({ project: project('bad-library', 2),
      showLibrary: { version: 1, data: 'malformed' }, songLibrary: null })).rejects.toThrow('Invalid authored');
    expect(h.safety).not.toHaveBeenCalled();
    h.safety.mockResolvedValueOnce(false);
    await expect(h.replacement.load(project('bad', 2))).rejects.toThrow('Backup failed');
    h.persist.mockRejectedValueOnce(new Error('ENOSPC'));
    await expect(h.replacement.load(project('disk-fail', 2))).rejects.toThrow('ENOSPC');
    expect(h.active.engine).toBe(engine);
    expect(h.voiceHost ? h.voiceHost.engine.frame() : h.host.engine.getFrame()).toBe(frame);
    expect(h.broadcast).not.toHaveBeenCalled();
    await h.active.stop();
  });

  it('orders concurrent restore reads and captures a safety revision for each intervening state', async () => {
    const h = await harness(mode);
    const old = await h.snapshots.snapshot('boot');
    await h.replacement.load(project('second', 2));
    const second = await h.snapshots.snapshot('boot');
    await Promise.all([h.snapshots.restore(old!.id), h.snapshots.restore(second!.id)]);
    expect(h.host.engine.getProject().name).toBe('second');
    const latestSafety = (await h.snapshots.list()).find((m) => m.reason === 'pre-risk')!;
    expect((await h.snapshots.read(latestSafety.id))!.files.project).toMatchObject({ name: 'old' });
    expect(await h.storage.read()).toEqual(h.readCurrent());
    await h.active.stop();
  });

  it('rolls disk back if output reconfiguration throws before the pointer commit', async () => {
    const h = await harness(mode);
    const old = structuredClone(h.readCurrent());
    const engine = h.active.engine;
    vi.spyOn(h.manager, 'applySettings').mockImplementationOnce(() => { throw new Error('injected output-stage fault'); });
    await expect(h.replacement.load(project('new', 1))).rejects.toThrow('output-stage fault');
    expect(h.active.engine).toBe(engine);
    expect(await h.storage.read()).toEqual(old);
    expect(h.broadcast).not.toHaveBeenCalled();
    await h.replacement.load(project('retry', 2));
    expect(h.host.engine.getProject().name).toBe('retry');
    await h.active.stop();
  });

  it('keeps old frames progressing during safety IO and retires same-destination U2 before new frames', async () => {
    const h = await harness(mode);
    let release!: () => void;
    const gate = new Promise<void>((r) => { release = r; });
    h.safety.mockImplementationOnce(async () => { await gate; return true; });
    const oldEngine = h.active.engine;
    const pending = h.replacement.load(project('new', 1));
    await Promise.resolve();
    h.active.step(40);
    expect(h.active.engine).toBe(oldEngine);
    expect(h.active.engineTimeMs).toBeGreaterThan(40);
    h.events.length = 0;
    release(); await pending;
    h.active.step(40);
    const packets = h.events.filter((e) => typeof e !== 'string');
    expect(packets.map((p) => p.universe)).toEqual([1, 2, 1]);
    expect(packets[0]!.bytes).toHaveLength(512);
    expect(packets[2]!.bytes).toHaveLength(3);
    expect(h.factories()).toBe(1); // manager AND adapter survive same-destination replacement
    await h.active.stop();
  });

  it('serializes rapid replacements and queued backups; a failure does not poison later work', async () => {
    const h = await harness(mode);
    const calls = [h.replacement.load(project('one', 1)), h.replacement.load({}), h.replacement.load(project('three', 3))];
    const backups = Array.from({ length: 8 }, () => h.snapshots.snapshot('pre-risk'));
    const results = await Promise.allSettled(calls);
    await Promise.all(backups);
    await h.replacement.drain(); await h.snapshots.drain();
    expect(results.map((r) => r.status)).toEqual(['fulfilled', 'rejected', 'fulfilled']);
    expect(h.host.engine.getProject().name).toBe('three');
    expect(await h.storage.read()).toEqual(h.readCurrent());
    const listing = await h.snapshots.list();
    expect(new Set(listing.map((m) => m.id)).size).toBe(10);
    expect(h.broadcast).toHaveBeenCalledTimes(2);
    await h.active.stop();
  });
});

it('canvas preflight cannot publish a replacement scene before the safety snapshot succeeds', async () => {
  const h = await harness('voice');
  const oldScene = { id: 'transaction-scene', name: 'Old', sampler: { kind: 'cylinder' as const }, lenses: [], elements: [] };
  h.voiceHost!.setShow({ graphs: {}, buses: [], effects: [], presets: [], sections: [], canvasScenes: [oldScene] });
  const lib = library();
  const nextScene = { ...oldScene, name: 'New' };
  Object.assign(lib.data.shows.show.authored, { canvasScenes: [nextScene] });
  h.safety.mockResolvedValueOnce(false);
  await expect(h.replacement.restore({ project: project('new', 1), showLibrary: lib, songLibrary: null })).rejects.toThrow('Backup failed');
  expect(tryGetCanvasScene(oldScene.id)).toBe(oldScene);
  await h.replacement.restore({ project: project('new', 1), showLibrary: lib, songLibrary: null });
  expect(tryGetCanvasScene(oldScene.id)?.name).toBe('New');
  await h.replacement.restore({ project: project('empty', 1), showLibrary: null, songLibrary: null });
  expect(tryGetCanvasScene(oldScene.id)).toBeUndefined();
  await h.active.stop();
});
