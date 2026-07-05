import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { TriggerLab } from './store.svelte';
import type { WSClient } from '../ws/client';

class MemStorage {
  private m = new Map<string, string>();
  get length(): number {
    return this.m.size;
  }
  key(i: number): string | null {
    return [...this.m.keys()][i] ?? null;
  }
  getItem(k: string): string | null {
    return this.m.has(k) ? this.m.get(k)! : null;
  }
  setItem(k: string, v: string): void {
    this.m.set(k, String(v));
  }
  removeItem(k: string): void {
    this.m.delete(k);
  }
  clear(): void {
    this.m.clear();
  }
}

const fakeClient = (): WSClient => ({ on() {}, connect() {}, close() {}, send() {} }) as unknown as WSClient;

beforeEach(() => {
  (globalThis as { localStorage?: Storage }).localStorage = new MemStorage() as unknown as Storage;
});
afterEach(() => {
  delete (globalThis as { localStorage?: Storage }).localStorage;
});

describe('canvas scene store mutators', () => {
  it('createCanvasScene appends a scene + a derived canvas effect', () => {
    const store = new TriggerLab(fakeClient);
    const id = store.createCanvasScene('Aurora');
    expect(id).toMatch(/^scene/);
    expect(store.canvasScenes.some((s) => s.id === id)).toBe(true);
    expect(store.selectableEffects.some((e) => e.id === `canvas:${id}`)).toBe(true);
    expect(store.canvasEffects[0]?.playType).toBe('canvas');
  });

  it("addPlayNode('canvas') seeds a scene + canvas node", () => {
    const store = new TriggerLab(fakeClient);
    const node = store.addPlayNode('canvas', 0, 0);
    expect(node).not.toBeNull();
    expect(node!.playType).toBe('canvas');
    expect(node!.canvasScene).toBeTruthy();
    expect(node!.effectId).toBe(`canvas:${node!.canvasScene}`);
  });

  it("addPlayNode('particles') selects a particle effect", () => {
    const store = new TriggerLab(fakeClient);
    const node = store.addPlayNode('particles', 0, 0);
    expect(node).not.toBeNull();
    expect(node!.playType).toBe('particles');
    const eff = store.selectableEffects.find((e) => e.id === node!.effectId);
    expect(eff?.playType).toBe('particles');
  });

  it('pickEffect rejects a mismatched play type', () => {
    const store = new TriggerLab(fakeClient);
    const node = store.addPlayNode('particles', 0, 0)!;
    const before = node.effectId;
    const wave = store.selectableEffects.find((e) => e.playType === 'waves' && !e.deprecated);
    expect(wave).toBeDefined();
    store.pickEffect(node, wave!.id);
    expect(node.effectId).toBe(before); // unchanged — different play type
  });

  it('setCanvasScene repoints a canvas node', () => {
    const store = new TriggerLab(fakeClient);
    const node = store.addPlayNode('canvas', 0, 0)!;
    const second = store.createCanvasScene('Second');
    store.setCanvasScene(node, second);
    expect(node.canvasScene).toBe(second);
    expect(node.effectId).toBe(`canvas:${second}`);
  });

  it('deleteCanvasScene retargets nodes to the fallback scene', () => {
    const store = new TriggerLab(fakeClient);
    const a = store.createCanvasScene('A');
    const b = store.createCanvasScene('B');
    const node = store.addPlayNode('canvas', 0, 0)!;
    store.setCanvasScene(node, a);
    expect(node.canvasScene).toBe(a);
    store.deleteCanvasScene(a);
    expect(store.canvasScenes.some((s) => s.id === a)).toBe(false);
    // retargetSceneRefs rebuilds the graph's nodes, so re-read from the store (the UI does too).
    const updated = store.selectedGraph!.nodes.find((n) => n.id === node.id)!;
    expect(updated.canvasScene).toBe(b); // retargeted to remaining scene
  });

  it('updateCanvasSceneJson rejects an id change', () => {
    const store = new TriggerLab(fakeClient);
    const id = store.createCanvasScene('A');
    const json = store.canvasSceneJson(id);
    const mutated = json.replace(`"${id}"`, '"scene_hacked"');
    const res = store.updateCanvasSceneJson(id, mutated);
    expect(res.ok).toBe(false);
  });
});
