// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { DEFAULT_KIT, buildPixelModel, voice } from '@ledrums/core';
import { TriggerLab } from './store.svelte';
import { SHOWS_STORAGE_KEY } from './persistence';
import type { WSClient } from '../ws/client';

/* GH #214 — the Audio modulation source in the authoring store: it is added like any other source
   (band `level` by default), its band edit is undoable + persisted with the graph (a normal node
   field, so the show library round-trips it), and the OFFLINE sim samples it with the same
   freshness rule as the core engine (stale frame → 0 without any new event). */

class MemStorage {
  m = new Map<string, string>();
  get length(): number { return this.m.size; }
  key(i: number): string | null { return [...this.m.keys()][i] ?? null; }
  getItem(k: string): string | null { return this.m.has(k) ? this.m.get(k)! : null; }
  setItem(k: string, v: string): void { this.m.set(k, String(v)); }
  removeItem(k: string): void { this.m.delete(k); }
  clear(): void { this.m.clear(); }
}

const fakeClient = (): WSClient => ({ on() {}, connect() {}, close() {}, send() {} }) as unknown as WSClient;

beforeEach(() => {
  Object.defineProperty(globalThis, 'localStorage', { value: new MemStorage(), configurable: true });
});
afterEach(() => {
  vi.restoreAllMocks();
});

describe('audio source node — authoring', () => {
  it('adds on the broadband level, resolves to an audio ModSource, and the band edit is undoable', () => {
    const store = new TriggerLab(fakeClient);
    store.createGraph('audio');
    const added = store.addNode('audio', 0, 0)!;
    // Read back through the graph (the reactive node the canvas/inspector hold), not the raw
    // object `addNode` handed us.
    const node = (): typeof added => store.selectedGraph!.nodes.find((n) => n.id === added.id)!;
    expect(node().kind).toBe('audio');
    expect(store.audioNodeBand(node())).toBe('level');
    expect(voice.nodeModSource(node())).toEqual({ kind: 'audio', band: 'level' });

    store.setAudioNodeBand(node(), 'highs');
    expect(voice.nodeModSource(node())).toEqual({ kind: 'audio', band: 'highs' });
    store.setAudioNodeBand(node(), 'treble' as voice.AudioBand); // unknown band → ignored
    expect(store.audioNodeBand(node())).toBe('highs');
    store.undo();
    expect(store.audioNodeBand(node())).toBe('level');
  });

  it('re-typing another source to Audio seeds the band and prunes its old wires', () => {
    const store = new TriggerLab(fakeClient);
    store.createGraph('retype');
    const osc = store.addNode('osc', 0, 0)!;
    store.changeKind(osc, 'audio');
    expect(osc.kind).toBe('audio');
    expect(osc.audioBand).toBe('level');
  });

  it('round-trips the band through the persisted show library', () => {
    const store = new TriggerLab(fakeClient);
    const ax = store as unknown as { startAutosave(): void; stopAutosave(): void };
    ax.startAutosave();
    store.createGraph('persist');
    const key = store.selectedPadKey!;
    const node = store.addNode('audio', 10, 20)!;
    store.setAudioNodeBand(node, 'mids');
    ax.stopAutosave(); // synchronous flush

    const lib = JSON.parse(localStorage.getItem(SHOWS_STORAGE_KEY)!);
    const saved = lib.data.shows[lib.data.activeShowId].authored.graphs[key].nodes.find((n: { id: string }) => n.id === node.id);
    expect(saved).toMatchObject({ kind: 'audio', audioBand: 'mids' });
    const reloaded = new TriggerLab(fakeClient); // hydrates from the same localStorage
    const back = reloaded.graphs[key]!.nodes.find((n) => n.id === node.id)!;
    expect(back.kind).toBe('audio');
    expect(back.audioBand).toBe('mids');
    expect(voice.nodeModSource(back)).toEqual({ kind: 'audio', band: 'mids' });
  });
});

describe('audio source node — offline sim parity', () => {
  it('the node face and the render sweep read the sim table with the engine freshness rule', () => {
    const store = new TriggerLab(fakeClient);
    store.createGraph('parity');
    const added = store.addNode('audio', 0, 0)!;
    store.setAudioNodeBand(added, 'bass');
    const audio = store.selectedGraph!.nodes.find((n) => n.id === added.id)!;
    expect(store.audioNodeLiveValue(audio)).toBe(0); // never heard

    store.sim.tick(16);
    store.sim.setAudio({ level: 0.2, bass: 0.8, mids: 0, highs: 0 });
    expect(store.audioNodeLiveValue(audio)).toBeCloseTo(0.8, 10);
    store.sim.tick(voice.AUDIO_STALE_MS); // still inside the window (inclusive)
    expect(store.audioNodeLiveValue(audio)).toBeCloseTo(0.8, 10);
    store.sim.tick(16); // past it: 0 with NO new frame
    expect(store.audioNodeLiveValue(audio)).toBe(0);
  });

  it('drives an exposed effect param on a live offline voice, and returns it to base when stale', () => {
    const store = new TriggerLab(fakeClient);
    store.createGraph('parity');
    const g = store.selectedGraph!;
    const play = store.addNode('effect', 100, 0)!;
    const effect = store.effects.find((e) => e.id === play.effectId)!;
    const spec = effect.params.find((p) => p.key === 'brightness' && p.kind === 'number');
    expect(spec, 'default effect exposes a numeric brightness param').toBeTruthy();
    store.setParam(play, 'brightness', 0);
    store.addModInput(play, 'brightness');
    const audio = store.addNode('audio', 0, 0)!;
    store.setAudioNodeBand(audio, 'level');
    expect(store.connect(g.nodes[0]!.id, play.id)).toBeNull(); // trigger → effect
    expect(store.connect(audio.id, play.id, undefined, 'param:brightness')).toBeNull();

    // Fire the authored graph on the store's own sim — the offline render path.
    const model = buildPixelModel(DEFAULT_KIT);
    const ctx = { velocity: 1, sourceDrumId: 'kick', sectionIndex: 0, sectionCount: 0, beatPhase: 0, bpm: 120 };
    store.sim.triggerGraph('parity', store.selectedGraph!, ctx, 'parity');
    store.sim.tick(16);
    const live = (): number => {
      store.sim.render(model);
      const v = store.sim.voices.find((x) => x.active && x.effectId === play.effectId);
      expect(v, 'the authored effect is playing').toBeTruthy();
      return v!.liveParams.brightness as number;
    };
    expect(live()).toBe(0); // base, nothing heard

    store.sim.setAudio({ level: 1, bass: 0, mids: 0, highs: 0 });
    store.sim.tick(16);
    expect(live()).toBeGreaterThan(0.99);

    store.sim.tick(voice.AUDIO_STALE_MS + 16); // stale without a new frame
    expect(live()).toBe(0);
  });
});
