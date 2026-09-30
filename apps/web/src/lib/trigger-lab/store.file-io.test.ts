import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('./file-io', async (importOriginal) => ({
  ...(await importOriginal<typeof import('./file-io')>()),
  saveTextFile: vi.fn(async () => 'saved'),
  openTextFile: vi.fn(async () => 'cancelled'),
}));

import { TriggerLab, GRAPH_FILE_EXT, NODE_FILE_EXT } from './store.svelte';
import { openTextFile, saveTextFile } from './file-io';
import type { GraphNode } from './sim';
import { toastStore } from '../ui/toast.svelte';
import type { WSClient } from '../ws/client';

/* Save / Load of graphs and nodes on the store. The file is the clipboard's ClipDoc, so the
   format itself is pinned in clipdoc.test.ts; here: what each load does to the show (replace in
   place vs add), what it keeps (key, name, pad, node id, position, wires), that it is one undo
   step, and that a node's custom effect survives the trip to another show. The file panel is
   mocked — `saveTextFile` hands back the text a save wrote, `openTextFile` feeds a load. */

class MemStorage {
  private m = new Map<string, string>();
  get length(): number {
    return this.m.size;
  }
  key(i: number): string | null {
    return [...this.m.keys()][i] ?? null;
  }
  getItem(k: string): string | null {
    return this.m.get(k) ?? null;
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
const save = vi.mocked(saveTextFile);
const open = vi.mocked(openTextFile);

/** The [fileName, text] of the most recent save. */
function lastSaved(): [string, string] {
  const call = save.mock.calls.at(-1);
  if (!call) throw new Error('nothing was saved');
  return [call[0], call[1]];
}

function nodeOf(store: TriggerLab, id: string): GraphNode {
  const node = store.selectedGraph?.nodes.find((candidate) => candidate.id === id);
  if (!node) throw new Error(`no node ${id}`);
  return node;
}

/** Two graphs of the active section: the selected one and another. */
function twoGraphs(store: TriggerLab): { a: string; b: string } {
  const keys = store.activeSection!.graphs;
  expect(keys.length).toBeGreaterThanOrEqual(2);
  return { a: keys[0]!, b: keys[1]! };
}

beforeEach(() => {
  (globalThis as { localStorage?: Storage }).localStorage = new MemStorage() as unknown as Storage;
  save.mockClear();
  open.mockClear();
  toastStore.clear();
});
afterEach(() => {
  delete (globalThis as { localStorage?: Storage }).localStorage;
  toastStore.clear();
});

describe('Save graph / Save node', () => {
  it('saves a graph under its own name, as a graph ClipDoc', async () => {
    const store = new TriggerLab(fakeClient);
    const { a } = twoGraphs(store);
    store.renameGraph(a, 'Verse kick');

    expect(await store.saveGraphToFile(a)).toBe('saved');

    const [name, text] = lastSaved();
    expect(name).toBe(`Verse kick${GRAPH_FILE_EXT}`);
    const doc = JSON.parse(text);
    expect(doc).toMatchObject({ app: 'ledrums', kind: 'graph', payload: { name: 'Verse kick' } });
    expect(doc.payload.graph.nodes.length).toBe(store.graphs[a]!.nodes.length);
  });

  it('saves a node under the label it is given, and refuses the graph anchors', async () => {
    const store = new TriggerLab(fakeClient);
    const splice = store.addNode('splice', 200, 0)!;

    await store.saveNodeToFile(splice, 'Splice');
    const [name, text] = lastSaved();
    expect(name).toBe(`Splice${NODE_FILE_EXT}`);
    expect(JSON.parse(text)).toMatchObject({ kind: 'node', payload: { node: { kind: 'splice', id: splice.id } } });

    save.mockClear();
    const trigger = store.selectedGraph!.nodes.find((node) => node.kind === 'trigger')!;
    expect(await store.saveNodeToFile(trigger, 'Trigger')).toBeNull();
    expect(save).not.toHaveBeenCalled();
  });

  it('makes a graph name safe to use as a file name', async () => {
    const store = new TriggerLab(fakeClient);
    const { a } = twoGraphs(store);
    store.renameGraph(a, 'Chorus: a/b?');
    await store.saveGraphToFile(a);
    expect(lastSaved()[0]).toBe(`Chorus- a-b-${GRAPH_FILE_EXT}`);
  });
});

describe('Load file into graph', () => {
  it('replaces the contents but keeps the key, the name and the pad it fires from', async () => {
    const store = new TriggerLab(fakeClient);
    const { a, b } = twoGraphs(store);
    store.selectGraphInSection(store.activeSectionId!, a);
    store.addNode('splice', 200, 0);
    await store.saveGraphToFile(a);
    const [, text] = lastSaved();

    const nameB = store.graphLabel(b);
    const sourceB = structuredClone(store.graphs[b]!.nodes.find((node) => node.kind === 'trigger')!.source);
    const result = store.applyGraphFileTo(b, text);

    expect(result).toMatchObject({ ok: true, graphKey: b });
    expect(store.graphs[b]!.nodes.map((node) => node.kind).sort()).toEqual(store.graphs[a]!.nodes.map((node) => node.kind).sort());
    expect(store.graphs[b]!.nodes.some((node) => node.kind === 'splice')).toBe(true);
    expect(store.graphLabel(b)).toBe(nameB);
    expect(store.graphs[b]!.nodes.find((node) => node.kind === 'trigger')!.source).toEqual(sourceB);
  });

  it('is one undo step', async () => {
    const store = new TriggerLab(fakeClient);
    const { a, b } = twoGraphs(store);
    store.selectGraphInSection(store.activeSectionId!, a);
    store.addNode('splice', 200, 0);
    await store.saveGraphToFile(a);
    const before = JSON.stringify(store.graphs[b]);

    store.applyGraphFileTo(b, lastSaved()[1]);
    expect(JSON.stringify(store.graphs[b])).not.toBe(before);
    store.undo();
    expect(JSON.stringify(store.graphs[b])).toBe(before);
  });

  it('takes the file’s trigger when this graph’s trigger is unassigned', async () => {
    const store = new TriggerLab(fakeClient);
    const { a } = twoGraphs(store);
    await store.saveGraphToFile(a);
    const fileSource = structuredClone(store.graphs[a]!.nodes.find((node) => node.kind === 'trigger')!.source);
    const blank = store.createGraphInSection(store.activeSectionId!, 'Blank')!;

    store.applyGraphFileTo(blank, lastSaved()[1]);
    expect(store.graphs[blank]!.nodes.find((node) => node.kind === 'trigger')!.source).toEqual(fileSource);
  });

  it('refuses a node file, and a file that is not LEDrums, without touching the graph', async () => {
    const store = new TriggerLab(fakeClient);
    const { b } = twoGraphs(store);
    const splice = store.addNode('splice', 200, 0)!;
    await store.saveNodeToFile(splice, 'Splice');
    const before = JSON.stringify(store.graphs[b]);

    const wrongKind = store.applyGraphFileTo(b, lastSaved()[1]);
    expect(wrongKind.ok).toBe(false);
    expect(wrongKind.message).toContain('holds a node');
    const foreign = store.applyGraphFileTo(b, '{"hello":"world"}');
    expect(foreign).toEqual({ ok: false, message: 'That file isn’t a LEDrums file.' });
    expect(JSON.stringify(store.graphs[b])).toBe(before);
  });

  it('loads through the file panel and toasts; a cancelled panel changes nothing', async () => {
    const store = new TriggerLab(fakeClient);
    const { a, b } = twoGraphs(store);
    store.selectGraphInSection(store.activeSectionId!, a);
    store.addNode('splice', 200, 0);
    await store.saveGraphToFile(a);
    const before = JSON.stringify(store.graphs[b]);

    open.mockResolvedValueOnce('cancelled');
    expect(await store.loadGraphFromFile(b)).toBeNull();
    expect(JSON.stringify(store.graphs[b])).toBe(before);

    open.mockResolvedValueOnce({ name: 'x.ledrums-graph.json', text: lastSaved()[1] });
    expect(await store.loadGraphFromFile(b)).toMatchObject({ ok: true });
    expect(toastStore.items.at(-1)).toMatchObject({ tone: 'success' });
  });
});

describe('Load graph from file into a section', () => {
  it('adds a NEW graph named from the file, places it and opens it — one undo step', async () => {
    const store = new TriggerLab(fakeClient);
    const { a } = twoGraphs(store);
    store.renameGraph(a, 'Saved look');
    await store.saveGraphToFile(a);
    const sectionId = store.activeSectionId!;
    const placed = [...store.activeSection!.graphs];

    const result = store.applyGraphFileToSection(sectionId, lastSaved()[1], 'ignored.ledrums-graph.json');

    expect(result.ok).toBe(true);
    const key = result.ok ? result.graphKey! : '';
    expect(key).not.toBe(a);
    expect(store.activeSection!.graphs).toEqual([...placed, key]);
    expect(store.graphLabel(key)).toBe('Saved look');
    expect(store.selectedPadKey).toBe(key);

    store.undo();
    expect(store.activeSection!.graphs).toEqual(placed);
    expect(store.graphs[key]).toBeUndefined();
  });

  it('falls back to the file name when the file carries no graph name', async () => {
    const store = new TriggerLab(fakeClient);
    const { a } = twoGraphs(store);
    await store.saveGraphToFile(a);
    const doc = JSON.parse(lastSaved()[1]);
    delete doc.payload.name;

    const result = store.applyGraphFileToSection(store.activeSectionId!, JSON.stringify(doc), 'Bridge.ledrums-graph.json');
    expect(result.ok && store.graphLabel(result.graphKey!)).toBe('Bridge');
  });
});

describe('Load node from file', () => {
  it('a file of the same kind replaces the settings, keeping the id, position and wires', async () => {
    const store = new TriggerLab(fakeClient);
    const source = store.addNode('splice', 200, 0)!;
    store.setSpliceCount(source, 7);
    await store.saveNodeToFile(nodeOf(store, source.id), 'Splice');
    const target = store.addNode('splice', 200, 300)!;
    const wires = store.selectedGraph!.edges.filter((edge) => edge.from === target.id || edge.to === target.id);
    expect(wires.length).toBeGreaterThan(0); // a fresh Splice auto-wires to the output

    const result = store.applyNodeFileTo(nodeOf(store, target.id), lastSaved()[1]);

    expect(result).toMatchObject({ ok: true, nodeId: target.id });
    const loaded = nodeOf(store, target.id);
    expect(loaded.spliceCount).toBe(7);
    expect([loaded.x, loaded.y]).toEqual([target.x, target.y]);
    expect(store.selectedGraph!.edges.filter((edge) => edge.from === target.id || edge.to === target.id)).toEqual(wires);

    store.undo();
    expect(nodeOf(store, target.id).spliceCount).not.toBe(7);
  });

  it('a file of another kind is added beside the node, and the node is left alone', async () => {
    const store = new TriggerLab(fakeClient);
    const splice = store.addNode('splice', 200, 0)!;
    await store.saveNodeToFile(nodeOf(store, splice.id), 'Splice');
    const effect = store.addNode('effect', 200, 300)!;
    const before = JSON.stringify(nodeOf(store, effect.id));
    const count = store.selectedGraph!.nodes.length;

    const result = store.applyNodeFileTo(nodeOf(store, effect.id), lastSaved()[1]);

    expect(result.ok).toBe(true);
    const added = result.ok ? result.nodeId! : '';
    expect(added).not.toBe(effect.id);
    expect(nodeOf(store, added).kind).toBe('splice');
    expect(store.selectedGraph!.nodes.length).toBe(count + 1);
    expect(JSON.stringify(nodeOf(store, effect.id))).toBe(before);
  });

  it('carries a custom effect to another show', async () => {
    const from = new TriggerLab(fakeClient);
    const into = new TriggerLab(fakeClient);
    const effect = from.addNode('effect', 200, 0)!;
    const custom = from.duplicateEffectDef(nodeOf(from, effect.id).effectId)!;
    from.pickEffect(nodeOf(from, effect.id), custom);
    await from.saveNodeToFile(nodeOf(from, effect.id), 'Custom');
    const customName = from.effects.find((def) => def.id === custom)!.name;
    expect(into.effects.some((def) => def.name === customName)).toBe(false);

    const target = into.addNode('effect', 200, 0)!;
    const result = into.applyNodeFileTo(nodeOf(into, target.id), lastSaved()[1]);

    expect(result.ok).toBe(true);
    const arrived = into.effects.find((def) => def.name === customName);
    expect(arrived).toBeDefined();
    expect(nodeOf(into, target.id).effectId).toBe(arrived!.id);
  });

  it('refuses a graph file', async () => {
    const store = new TriggerLab(fakeClient);
    const { a } = twoGraphs(store);
    await store.saveGraphToFile(a);
    const splice = store.addNode('splice', 200, 0)!;
    const result = store.applyNodeFileTo(nodeOf(store, splice.id), lastSaved()[1]);
    expect(result.ok).toBe(false);
    expect(result.message).toContain('holds a graph');
  });
});
