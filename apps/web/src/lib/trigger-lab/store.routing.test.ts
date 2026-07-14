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
      { id: '1', channelsPerPixel: 3, segments: [{ drumId, hoopStart: 0, hoopEnd: 1 }] },
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

describe('setKitGlobal (C1/C2 kit-global config — expanded / density / hoopCount / spacing / cap)', () => {
  it('optimistically writes kit.global and forwards only the edited fields', () => {
    const sent: ClientMessage[] = [];
    const store = connected(sent);
    store.setKitGlobal({ expanded: true, ledDensityPxPerM: 72, maxPixelsPerOutput: 300 });
    expect(store.project!.kit.global).toMatchObject({ expanded: true, ledDensityPxPerM: 72, maxPixelsPerOutput: 300 });
    expect(sent).toContainEqual({ t: 'setKitGlobal', expanded: true, ledDensityPxPerM: 72, maxPixelsPerOutput: 300 });
  });

  it('carries hoopCount + defaultHoopSpacingMm and leaves mirror untouched', () => {
    const sent: ClientMessage[] = [];
    const store = connected(sent);
    store.setKitGlobal({ hoopCount: 5, defaultHoopSpacingMm: 45 });
    expect(store.project!.kit.global.hoopCount).toBe(5);
    expect(store.project!.kit.global.defaultHoopSpacingMm).toBe(45);
    expect(store.project!.kit.global.mirror).toBe('none'); // unrelated field preserved
    expect(sent).toContainEqual({ t: 'setKitGlobal', hoopCount: 5, defaultHoopSpacingMm: 45 });
  });

  it('no-ops for a viewer', () => {
    const sent: ClientMessage[] = [];
    const store = connected(sent);
    store.presence = { editorId: 'c1', youAreEditor: false, clientCount: 2 };
    store.setKitGlobal({ expanded: true });
    expect(store.project!.kit.global.expanded).toBe(false);
    expect(sent).toEqual([]);
  });
});

describe('setDrumTransform color (C3 drum swatch)', () => {
  it('writes DrumConfig.color locally and forwards it on setKitTransform', () => {
    const sent: ClientMessage[] = [];
    const store = connected(sent);
    const drumId = store.project!.kit.drums[0]!.id;
    store.setDrumTransform(drumId, { color: '#ff8800' });
    expect(store.project!.kit.drums.find((d) => d.id === drumId)!.color).toBe('#ff8800');
    expect(sent).toContainEqual({ t: 'setKitTransform', drumId, color: '#ff8800' });
  });
});

describe('setHoopConfig (C5 per-hoop pixelCount / reverse — B4 hoops[])', () => {
  it('writes drum.hoops[hoopIndex-1] (1-based) locally and forwards over WS', () => {
    const sent: ClientMessage[] = [];
    const store = connected(sent);
    const drumId = store.project!.kit.drums[0]!.id;
    expect(store.project!.kit.drums[0]!.hoops).toBeDefined(); // migrator expanded legacy → hoops[]
    store.setHoopConfig(drumId, 1, { pixelCount: 200, reverse: true });
    const hoop0 = store.project!.kit.drums.find((d) => d.id === drumId)!.hoops![0]!;
    expect(hoop0).toMatchObject({ pixelCount: 200, reverse: true });
    expect(sent).toContainEqual({ t: 'setHoopConfig', drumId, hoopIndex: 1, pixelCount: 200, reverse: true });
  });

  it('safely no-ops the local write for an out-of-range hoop but still forwards (server backstop rejects)', () => {
    const sent: ClientMessage[] = [];
    const store = connected(sent);
    const drumId = store.project!.kit.drums[0]!.id;
    const before = structuredClone(store.project!.kit.drums.find((d) => d.id === drumId)!.hoops);
    store.setHoopConfig(drumId, 999, { pixelCount: 5 });
    expect(store.project!.kit.drums.find((d) => d.id === drumId)!.hoops).toEqual(before);
    expect(sent).toContainEqual({ t: 'setHoopConfig', drumId, hoopIndex: 999, pixelCount: 5 });
  });

  it('no-ops entirely for a viewer', () => {
    const sent: ClientMessage[] = [];
    const store = connected(sent);
    store.presence = { editorId: 'c1', youAreEditor: false, clientCount: 2 };
    const drumId = store.project!.kit.drums[0]!.id;
    store.setHoopConfig(drumId, 1, { pixelCount: 200 });
    expect(sent).toEqual([]);
  });

  it('SF1: materializes hoops[] on a density-resolved drum, then writes + forwards (dead control fixed)', () => {
    // A density-derived drum (no literal pixelsPerHoop, no hoops[]) is the reachable shape whose
    // per-hoop write silently discarded input pre-SF1. It must now lazily materialize hoops[] (the
    // renderer-resolved counts) then apply the edit — mirroring the server backstop exactly.
    const sent: ClientMessage[] = [];
    const store = new TriggerLab(capturing(sent));
    const project = defaultProject();
    const drum = project.kit.drums[0]!;
    delete (drum as { pixelsPerHoop?: number }).pixelsPerHoop;
    delete (drum as { hoops?: unknown }).hoops;
    store.project = project;
    const drumId = drum.id;
    expect(store.project!.kit.drums.find((d) => d.id === drumId)!.hoops).toBeUndefined();

    store.setHoopConfig(drumId, 2, { pixelCount: 77, reverse: true });

    const after = store.project!.kit.drums.find((d) => d.id === drumId)!;
    expect(after.hoops).toHaveLength(4); // materialized to global hoopCount
    expect(after.hoops![1]).toMatchObject({ pixelCount: 77, reverse: true }); // hoop 2 (1-based) written
    expect(after.hoops![0]!.reverse).toBe(false); // sibling hoop materialized, untouched
    expect(sent).toContainEqual({ t: 'setHoopConfig', drumId, hoopIndex: 2, pixelCount: 77, reverse: true });
  });
});

describe('identifyHoop (C5 Identify — E1 hoop flash)', () => {
  it('sends the flash for an editor (default 5s) and no-ops for a viewer', () => {
    const sent: ClientMessage[] = [];
    const store = connected(sent);
    store.identifyHoop('kick', 1);
    expect(sent).toContainEqual({ t: 'identifyHoop', drumId: 'kick', hoop: 1, durationS: 5 });

    const viewerSent: ClientMessage[] = [];
    const viewer = connected(viewerSent);
    viewer.presence = { editorId: 'c1', youAreEditor: false, clientCount: 2 };
    viewer.identifyHoop('kick', 1, 2);
    expect(viewerSent).toEqual([]);
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
      { id: '1', channelsPerPixel: 3, segments: [{ drumId, hoopStart: 0, hoopEnd: 1 }] },
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
