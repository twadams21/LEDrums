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
      { id: '1', channelsPerPixel: 3, dataLines: [{ id: '1:dl0', segments: [{ drumId, hoopStart: 0, hoopEnd: 1 }] }] },
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

  it('toggles flip live — writes the drum flag locally and sends setKitTransform', () => {
    const sent: ClientMessage[] = [];
    const store = connected(sent);
    const drumId = store.project!.kit.drums[0]!.id;
    store.setDrumTransform(drumId, { flip: true });
    expect(store.project!.kit.drums.find((d) => d.id === drumId)!.flip).toBe(true);
    expect(sent).toContainEqual({ t: 'setKitTransform', drumId, flip: true });
  });
});

describe('setKitMirror', () => {
  it('sets the kit-global mirror live — writes kit.global.mirror locally and sends setKitGlobal', () => {
    const sent: ClientMessage[] = [];
    const store = connected(sent);
    store.setKitMirror('x');
    expect(store.project!.kit.global.mirror).toBe('x');
    expect(sent).toContainEqual({ t: 'setKitGlobal', mirror: 'x' });
  });
});

describe('setInputMap / setOutput', () => {
  it('setInputMap writes locally and sends', () => {
    const sent: ClientMessage[] = [];
    const store = connected(sent);
    const inputMap = { midiChannel: null, midiNotes: [{ note: 60, drumId: store.project!.kit.drums[0]!.id, slot: 0 }], oscMap: [] };
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

  it('setOutput carries the standard transport fields priority/port/iface (S5c)', () => {
    const sent: ClientMessage[] = [];
    const store = connected(sent);
    store.setOutput({ priority: 150, port: 5569, iface: '10.0.0.9' });
    expect(store.project!.output).toMatchObject({ priority: 150, port: 5569, iface: '10.0.0.9' });
    expect(sent).toContainEqual({ t: 'setOutput', priority: 150, port: 5569, iface: '10.0.0.9' });
  });
});

describe('setPatchLabel (the Patch node rename override the node face + Inspector render, S5a)', () => {
  it('sets, overrides, trims, and clears a per-node label — UI-only, never over WS', () => {
    const sent: ClientMessage[] = [];
    const store = connected(sent);
    store.setPatchLabel('output:1', '  Front Truss  ');
    expect(store.patchLabels['output:1']).toBe('Front Truss'); // trimmed
    store.setPatchLabel('output:1', 'Stage Left');
    expect(store.patchLabels['output:1']).toBe('Stage Left'); // override wins
    store.setPatchLabel('output:1', '   ');
    expect(store.patchLabels['output:1']).toBeUndefined(); // blank clears back to the derived label
    expect(sent).toEqual([]); // the override is local/persisted, not part of the server Project
  });
});

describe('undo restores the project slice and resyncs the engine (S3)', () => {
  it('undoes a routing edit — restores kit.outputs and re-sends setKitOutputs with the prior topology', () => {
    const sent: ClientMessage[] = [];
    const store = connected(sent);
    const drumId = store.project!.kit.drums[0]!.id;
    const seedOutputs = structuredClone(store.project!.kit.outputs);
    const outputs: OutputConfig[] = [
      { id: '1', channelsPerPixel: 3, dataLines: [{ id: '1:dl0', segments: [{ drumId, hoopStart: 0, hoopEnd: 1 }] }] },
    ];
    store.setRouting(outputs);
    expect(store.project!.kit.outputs).toBe(outputs);

    sent.length = 0; // ignore the edit's own send; watch only what undo emits
    expect(store.undo()).toBe(true);
    expect(store.project!.kit.outputs).toEqual(seedOutputs);
    expect(sent).toContainEqual({ t: 'setKitOutputs', outputs: seedOutputs });
  });

  it('undoes a drum-transform edit — restores the drum and re-sends setKitTransform', () => {
    const sent: ClientMessage[] = [];
    const store = connected(sent);
    const drumId = store.project!.kit.drums[0]!.id;
    const before = store.project!.kit.drums.find((d) => d.id === drumId)!.pixelsPerHoop;
    store.setDrumTransform(drumId, { pixelsPerHoop: 77 });
    expect(store.project!.kit.drums.find((d) => d.id === drumId)!.pixelsPerHoop).toBe(77);

    sent.length = 0;
    expect(store.undo()).toBe(true);
    expect(store.project!.kit.drums.find((d) => d.id === drumId)!.pixelsPerHoop).toBe(before);
    expect(sent.some((m) => m.t === 'setKitTransform' && m.drumId === drumId)).toBe(true);
  });

  it('undoes a mirror edit — restores kit.global.mirror and re-sends setKitGlobal', () => {
    const sent: ClientMessage[] = [];
    const store = connected(sent);
    store.setKitMirror('x');
    expect(store.project!.kit.global.mirror).toBe('x');

    sent.length = 0;
    expect(store.undo()).toBe(true);
    expect(store.project!.kit.global.mirror).toBe('none');
    expect(sent).toContainEqual({ t: 'setKitGlobal', mirror: 'none' });
  });

  it('interleaves cleanly — undo peels the last edit first regardless of trigger/patch kind', () => {
    const sent: ClientMessage[] = [];
    const store = connected(sent);
    store.setKitMirror('x');
    store.setOutput({ fps: 33 });
    expect(store.undo()).toBe(true); // peels the fps edit
    expect(store.project!.output.fps).not.toBe(33);
    expect(store.project!.kit.global.mirror).toBe('x'); // the mirror edit still stands
    expect(store.undo()).toBe(true); // peels the mirror edit
    expect(store.project!.kit.global.mirror).toBe('none');
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
