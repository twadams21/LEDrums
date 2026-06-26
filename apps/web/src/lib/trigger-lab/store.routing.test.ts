import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { TriggerLab } from './store.svelte';
import { defaultProject, type OutputConfig } from '@ledrums/core';
import type { WSClient } from '../ws/client';
import type { ClientMessage } from '../ws/protocol-types';

/* The authoritative-project mutators (S3): each optimistic-writes the local `project`
   AND forwards the edit over WS. A capturing fake client records the sends; `project`
   is seeded directly (start() is never called, so the live socket never opens). */

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

const capturing = (sent: ClientMessage[]): (() => WSClient) =>
  () =>
    ({ on() {}, connect() {}, close() {}, send(m: ClientMessage) { sent.push(m); } }) as unknown as WSClient;

beforeEach(() => {
  (globalThis as { localStorage?: Storage }).localStorage = new MemStorage() as unknown as Storage;
});
afterEach(() => {
  delete (globalThis as { localStorage?: Storage }).localStorage;
});

function connected(sent: ClientMessage[]): TriggerLab {
  const store = new TriggerLab(capturing(sent));
  store.project = defaultProject(); // simulate the adopted `state` message
  return store;
}

describe('setRouting', () => {
  it('optimistically writes kit.outputs and sends setKitOutputs', () => {
    const sent: ClientMessage[] = [];
    const store = connected(sent);
    const drumId = store.project!.kit.drums[0]!.id;
    const outputs: OutputConfig[] = [
      { id: '1', startUniverse: 0, channelsPerPixel: 3, segments: [{ drumId, hoopStart: 0, hoopEnd: 1 }] },
    ];
    store.setRouting(outputs);
    expect(store.project!.kit.outputs).toBe(outputs);
    expect(sent).toContainEqual({ t: 'setKitOutputs', outputs });
  });
});

describe('setDrumTransform', () => {
  it('writes the literal pixelsPerHoop locally and sends setKitTransform', () => {
    const sent: ClientMessage[] = [];
    const store = connected(sent);
    const drumId = store.project!.kit.drums[0]!.id;
    store.setDrumTransform(drumId, { pixelsPerHoop: 50 });
    expect(store.project!.kit.drums.find((d) => d.id === drumId)!.pixelsPerHoop).toBe(50);
    expect(sent).toContainEqual({ t: 'setKitTransform', drumId, pixelsPerHoop: 50 });
  });
});

describe('setInputMap / setOutput', () => {
  it('setInputMap writes locally and sends', () => {
    const sent: ClientMessage[] = [];
    const store = connected(sent);
    const inputMap = { midiNotes: [{ note: 60, drumId: store.project!.kit.drums[0]!.id, slot: 0 }], oscMap: [] };
    store.setInputMap(inputMap);
    expect(store.project!.inputMap).toBe(inputMap);
    expect(sent).toContainEqual({ t: 'setInputMap', inputMap });
  });

  it('setOutput merges the partial locally and sends', () => {
    const sent: ClientMessage[] = [];
    const store = connected(sent);
    store.setOutput({ fps: 60, protocol: 'sacn' });
    expect(store.project!.output.fps).toBe(60);
    expect(store.project!.output.protocol).toBe('sacn');
    expect(sent).toContainEqual({ t: 'setOutput', fps: 60, protocol: 'sacn' });
  });
});

describe('offline (project null)', () => {
  it('still sends, writes nothing, and never throws', () => {
    const sent: ClientMessage[] = [];
    const store = new TriggerLab(capturing(sent));
    expect(store.project).toBeNull();
    store.setRouting([]);
    expect(store.project).toBeNull();
    expect(sent).toContainEqual({ t: 'setKitOutputs', outputs: [] });
  });
});
