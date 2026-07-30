import { describe, expect, it, vi } from 'vitest';
import { buildPixelModel, defaultProject, type Project } from '@ledrums/core';
import type { PixelOutput } from '@ledrums/io';
import { EngineHost } from '../engine-host';
import { OutputManager } from '../output-manager';
import { VoiceEngineHost } from '../voice-engine-host';
import type { Autosaver } from '../autosave';
import type { ClientMessage, ServerMessage } from '../ws-protocol';
import { handleProjectMessage, type JsonSink } from './projects';

/**
 * The project "on disk". Deliberately DIFFERENT from the live default in both its authored
 * transport and its kit geometry, so (a) a "deep-equal to the loaded file" assertion cannot pass
 * by accident and (b) a missing geometry rebuild is visible as a wrong `pixelCount`.
 */
function fileOnDisk(): Project {
  const p = defaultProject();
  p.name = 'On Disk';
  p.composition.transport = { bpm: 155, playing: false, beatsPerBar: 3 };
  p.kit.drums[0]!.hoops = p.kit.drums[0]!.hoops!.map((h) => ({ ...h, pixelCount: 64 }));
  return p;
}

// `loadProject` reads from disk; stub it so these tests exercise the HANDLER seam (the pre-risk
// fail-closed gate) rather than project IO. A valid Project is returned so control reaches the gate.
vi.mock('../projects', () => ({
  loadProject: vi.fn(() => fileOnDisk()),
  listProjects: vi.fn(() => ['a', 'b']),
  saveProject: vi.fn(),
}));

/** Inert pixel sink — these tests never arm output. */
class NoOutput implements PixelOutput {
  nextFrame(): void {}
  send(): void {}
  close(): void {}
}

function fakeAutosaver(): Autosaver {
  return { markDirty: vi.fn(), flush: () => Promise.resolve(), dispose: () => {} };
}

/** A JSON sink that records what the handler replied to the requesting client. */
function fakeSink() {
  const sent: ServerMessage[] = [];
  const sink: JsonSink = { send: (data) => sent.push(JSON.parse(data) as ServerMessage) };
  return { sink, sent };
}

/**
 * The handler under test with its collaborators. `voice: true` wires a real VoiceEngineHost onto
 * the SAME live project object the legacy host holds — the shape main.ts builds in voice mode —
 * so the load path's effect on the live render host is observable.
 */
function harness(snapshotPreRisk?: () => boolean, { voice = false }: { voice?: boolean } = {}) {
  const live = defaultProject();
  const host = new EngineHost(live);
  const voiceHost = voice ? new VoiceEngineHost(live, null, new OutputManager(() => new NoOutput())) : null;
  const autosaver = fakeAutosaver();
  const broadcastState = vi.fn();
  const { sink, sent } = fakeSink();
  // Explicit stub (S7): snapshotPreRisk is required; default = snapshot succeeds.
  const deps = { host, voiceHost, autosaver, broadcastState, snapshotPreRisk: snapshotPreRisk ?? (() => true) };
  const run = (msg: ClientMessage): boolean => handleProjectMessage(msg, sink, deps);
  return { host, voiceHost, autosaver, broadcastState, sent, run };
}

describe('handleProjectMessage — loadProject pre-risk fail-closed (#138 C1)', () => {
  it('loads the project when the pre-risk snapshot is taken (backups present, write ok)', () => {
    const snapshotPreRisk = vi.fn(() => true);
    const { host, autosaver, broadcastState, run } = harness(snapshotPreRisk);
    const before = host.engine.getProject();

    const handled = run({ t: 'loadProject', name: 'p' });

    expect(handled).toBe(true);
    expect(snapshotPreRisk).toHaveBeenCalledTimes(1);
    expect(host.engine.getProject()).not.toBe(before); // the loaded project replaced live state
    expect(broadcastState).toHaveBeenCalledTimes(1);
    expect(autosaver.markDirty).toHaveBeenCalledTimes(1);
  });

  it('loads the project with the default harness stub (snapshot succeeds) (S9: the absent-backups config no longer exists)', () => {
    const { host, broadcastState, run } = harness(undefined);
    const before = host.engine.getProject();

    run({ t: 'loadProject', name: 'p' });

    expect(host.engine.getProject()).not.toBe(before);
    expect(broadcastState).toHaveBeenCalledTimes(1);
  });

  it('REFUSES the load and leaves live state untouched when the pre-risk snapshot fails', () => {
    const snapshotPreRisk = vi.fn(() => false); // safety snapshot WRITE failed
    const { host, autosaver, broadcastState, sent, run } = harness(snapshotPreRisk);
    const before = host.engine.getProject();

    const handled = run({ t: 'loadProject', name: 'p' });

    expect(handled).toBe(true); // message consumed (a visible error was sent), not passed through
    expect(snapshotPreRisk).toHaveBeenCalledTimes(1);
    expect(host.engine.getProject()).toBe(before); // live state untouched — no setProject
    expect(broadcastState).not.toHaveBeenCalled();
    expect(autosaver.markDirty).not.toHaveBeenCalled();
    const err = sent.find((m) => m.t === 'error');
    expect(err).toMatchObject({ t: 'error', message: expect.stringContaining('Backup failed') });
  });
});

describe('handleProjectMessage — loadProject re-points the VOICE host too (INIT-01 S5)', () => {
  it('leaves voiceHost.getProject() deep-equal to the loaded file, INCLUDING composition.transport', () => {
    const { voiceHost, run } = harness(undefined, { voice: true });

    run({ t: 'loadProject', name: 'p' });

    // Before S5 this was the previous project: only `host.engine.setProject(loaded)` ran, so the
    // live render host kept the old kit/inputMap/output while `state` described the new one.
    expect(voiceHost!.getProject()).toEqual(fileOnDisk());
    expect(voiceHost!.getProject().composition.transport).toEqual({ bpm: 155, playing: false, beatsPerBar: 3 });
  });

  it('rebuilds the live pixel model from the loaded kit (the geometry rebuild actually ran)', () => {
    const { voiceHost, run } = harness(undefined, { voice: true });
    const before = voiceHost!.getModel().pixelCount;

    run({ t: 'loadProject', name: 'p' });

    // Equal to a FRESH build from the loaded kit — a stale model would still hold `before`.
    expect(voiceHost!.getModel().pixelCount).toBe(buildPixelModel(fileOnDisk().kit).pixelCount);
    expect(voiceHost!.getModel().pixelCount).not.toBe(before);
  });

  it('does NOT touch the voice host when the pre-risk snapshot fails (fail-closed, both hosts)', () => {
    const { voiceHost, run } = harness(() => false, { voice: true });
    const before = voiceHost!.getProject();

    run({ t: 'loadProject', name: 'p' });

    expect(voiceHost!.getProject()).toBe(before);
    expect(voiceHost!.getProject().name).toBe('LEDrums Default');
  });

  it('legacy mode (voiceHost null) still loads into the legacy engine and does not throw', () => {
    const { host, run } = harness(undefined, { voice: false });

    expect(() => run({ t: 'loadProject', name: 'p' })).not.toThrow();
    expect(host.engine.getProject().name).toBe('On Disk');
  });
});
