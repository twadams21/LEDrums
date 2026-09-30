// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { voice } from '@ledrums/core';
import { TriggerLab } from './store.svelte';
import type { WSClient } from '../ws/client';

/* GH #214 — the Audio modulation source in the authoring store: it is added like any other source
   (band `level` by default), its band edit is undoable, and the OFFLINE sim samples it with the same
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
});
