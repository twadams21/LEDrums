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
  it('createCanvasScene appends an authored scene under a fresh id', () => {
    const store = new TriggerLab(fakeClient);
    const id = store.createCanvasScene('Aurora');
    expect(id).toMatch(/^scene/);
    expect(store.canvasScenes.map((s) => [s.id, s.name])).toEqual([[id, 'Aurora']]);
    expect(store.allCanvasScenes.some((s) => s.id === id)).toBe(true);
    expect(store.isBuiltinCanvasScene(id)).toBe(false);
  });

  it('duplicateCanvasScene forks a built-in into an editable authored copy', () => {
    const store = new TriggerLab(fakeClient);
    const builtin = store.allCanvasScenes.find((s) => store.isBuiltinCanvasScene(s.id))!;
    const copy = store.duplicateCanvasScene(builtin.id)!;
    expect(store.canvasScenes.find((s) => s.id === copy)!.name).toBe(`${builtin.name} copy`);
    expect(store.isBuiltinCanvasScene(copy)).toBe(false);
  });

  it('deleteCanvasScene removes an authored scene and refuses a built-in', () => {
    const store = new TriggerLab(fakeClient);
    const id = store.createCanvasScene('Doomed');
    expect(store.deleteCanvasScene(id)).toBe(true);
    expect(store.canvasScenes).toEqual([]);
    const builtin = store.allCanvasScenes.find((s) => store.isBuiltinCanvasScene(s.id))!;
    expect(store.deleteCanvasScene(builtin.id)).toBe(false);
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
