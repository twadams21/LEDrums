import { describe, expect, it } from 'vitest';
import { DEFAULT_KIT, type KitConfig } from '@ledrums/core';
import {
  buildPatchTopology,
  describePatchNode,
  topoDrumsFromKit,
  CONTROLLER_ID,
  INPUT_ID,
  drumNodeId,
  type TopologyDrum,
} from './patch-topology';

/** The current canonical kit: kick has 2 zones, the rest have the full 4; all 4 hoops. */
const KIT: TopologyDrum[] = [
  { id: 'kick', label: 'Kick', zones: ['center', 'shell'], hoopCount: 4 },
  { id: 'snare', label: 'Snare', zones: ['center', 'edge', 'rim', 'shell'], hoopCount: 4 },
  { id: 'tom1', label: 'Tom 1', zones: ['center', 'edge', 'rim', 'shell'], hoopCount: 4 },
  { id: 'tom2', label: 'Tom 2', zones: ['center', 'edge', 'rim', 'shell'], hoopCount: 4 },
];

const ZONES = 2 + 4 + 4 + 4; // 14
const HOOPS = 4 * 4; // 16

const outDeg = (edges: { source: string }[], id: string): number => edges.filter((e) => e.source === id).length;
const inDeg = (edges: { target: string }[], id: string): number => edges.filter((e) => e.target === id).length;
const byStage = (nodes: { id: string; data: { stage: string } }[], stage: string) =>
  nodes.filter((n) => n.data.stage === stage);

describe('buildPatchTopology', () => {
  it('emits one node per stage entry across all eight columns', () => {
    const { nodes } = buildPatchTopology(KIT); // default hoopsPerDataLine = 6 → 3 lines
    expect(byStage(nodes, 'input')).toHaveLength(1);
    expect(byStage(nodes, 'trigger')).toHaveLength(KIT.length);
    expect(byStage(nodes, 'zone')).toHaveLength(ZONES);
    expect(byStage(nodes, 'drum')).toHaveLength(KIT.length);
    expect(byStage(nodes, 'hoop')).toHaveLength(HOOPS);
    expect(byStage(nodes, 'dataline')).toHaveLength(3);
    expect(byStage(nodes, 'output')).toHaveLength(3);
    expect(byStage(nodes, 'controller')).toHaveLength(1);
    // 1 + 4 + 14 + 4 + 16 + 3 + 3 + 1
    expect(nodes).toHaveLength(46);
  });

  it('wires the full path with the expected edge count', () => {
    const { edges } = buildPatchTopology(KIT);
    // input→trigger 4 · trigger→zone 14 · zone→drum 14 · drum→hoop 16
    // · hoop→dataline 16 · dataline→output 3 · output→controller 3
    expect(edges).toHaveLength(4 + ZONES + ZONES + HOOPS + HOOPS + 3 + 3);
  });

  it('fans the single input out to every drum trigger', () => {
    const { edges } = buildPatchTopology(KIT);
    expect(outDeg(edges, INPUT_ID)).toBe(KIT.length);
  });

  it('converges every zone of a drum into its drum node and fans out to its hoops', () => {
    const { edges } = buildPatchTopology(KIT);
    for (const d of KIT) {
      const id = drumNodeId(d.id);
      expect(inDeg(edges, id)).toBe(d.zones.length); // zone → drum
      expect(outDeg(edges, id)).toBe(d.hoopCount); // drum → hoop
    }
  });

  it('collects every output into the single controller', () => {
    const { nodes, edges } = buildPatchTopology(KIT);
    expect(inDeg(edges, CONTROLLER_ID)).toBe(byStage(nodes, 'output').length);
    expect(outDeg(edges, CONTROLLER_ID)).toBe(0); // it is the sink
  });

  it('cross-wires hoops: a drum splits across data lines AND a line carries >1 drum', () => {
    const { nodes, edges } = buildPatchTopology(KIT); // 16 hoops / 6 → lines [6,6,4]
    const dataLineIds = new Set(byStage(nodes, 'dataline').map((n) => n.id));

    // For each drum, which data lines do its hoops land on?
    const linesPerDrum = new Map<string, Set<string>>();
    for (const e of edges) {
      const m = /^hoop:([^:]+):\d+$/.exec(e.source);
      if (m && dataLineIds.has(e.target)) {
        const set = linesPerDrum.get(m[1]!) ?? new Set<string>();
        set.add(e.target);
        linesPerDrum.set(m[1]!, set);
      }
    }
    // snare's four hoops straddle two lines (idx 4-7 vs the 0-5 / 6-11 split)
    expect(linesPerDrum.get('snare')!.size).toBe(2);

    // At least one data line carries hoops from more than one drum.
    const drumsPerLine = new Map<string, Set<string>>();
    for (const e of edges) {
      const m = /^hoop:([^:]+):\d+$/.exec(e.source);
      if (m && dataLineIds.has(e.target)) {
        const set = drumsPerLine.get(e.target) ?? new Set<string>();
        set.add(m[1]!);
        drumsPerLine.set(e.target, set);
      }
    }
    expect([...drumsPerLine.values()].some((s) => s.size > 1)).toBe(true);
  });

  it('keeps node ids unique and every edge endpoint resolvable', () => {
    const { nodes, edges } = buildPatchTopology(KIT);
    const ids = nodes.map((n) => n.id);
    expect(new Set(ids).size).toBe(ids.length);
    const idSet = new Set(ids);
    for (const e of edges) {
      expect(idSet.has(e.source)).toBe(true);
      expect(idSet.has(e.target)).toBe(true);
    }
  });

  it('tags every node with a stage role colour and the patch node type', () => {
    const { nodes } = buildPatchTopology(KIT);
    for (const n of nodes) {
      expect(n.type).toBe('patch');
      expect(n.data.role).toMatch(/^var\(--role-/);
    }
  });

  it('honours hoopsPerDataLine — a single fat line when capacity covers the chain', () => {
    const { nodes } = buildPatchTopology(KIT, { hoopsPerDataLine: 100 });
    expect(byStage(nodes, 'dataline')).toHaveLength(1);
    expect(byStage(nodes, 'output')).toHaveLength(1);
  });

  it('survives a degenerate single-drum kit', () => {
    const one: TopologyDrum[] = [{ id: 'kick', label: 'Kick', zones: ['center'], hoopCount: 1 }];
    const { nodes, edges } = buildPatchTopology(one);
    // input, trigger, zone, drum, hoop, dataline, output, controller
    expect(nodes).toHaveLength(8);
    expect(edges).toHaveLength(7);
  });
});

describe('topoDrumsFromKit (#11: input half follows the project kit, not DEFAULT_KIT)', () => {
  const drumList = DEFAULT_KIT.drums.map((d) => ({ id: d.id, label: d.label }));
  const oneZone = (): string[] => ['center'];

  /** A kit whose per-drum + global hoop counts all differ from DEFAULT_KIT's. */
  function nonDefaultKit(): KitConfig {
    return {
      ...DEFAULT_KIT,
      global: { ...DEFAULT_KIT.global, hoopCount: DEFAULT_KIT.global.hoopCount + 5 },
      drums: DEFAULT_KIT.drums.map((d) =>
        d.id === 'snare' ? { ...d, hoopCount: 9 } : { ...d, hoopCount: undefined },
      ),
    };
  }

  it('derives each drum hoop count from the supplied kit (per-drum override or global)', () => {
    const kit = nonDefaultKit();
    const topo = topoDrumsFromKit(kit, drumList, oneZone);
    // the overridden drum follows its per-drum count...
    expect(topo.find((t) => t.id === 'snare')!.hoopCount).toBe(9);
    // ...and a non-overridden drum follows the kit global (NOT DEFAULT_KIT's global)
    expect(topo.find((t) => t.id === 'kick')!.hoopCount).toBe(kit.global.hoopCount);
    expect(kit.global.hoopCount).not.toBe(DEFAULT_KIT.global.hoopCount);
  });

  it('builds the matching number of input-half hoop nodes for a non-default kit', () => {
    const kit = nonDefaultKit();
    const { nodes } = buildPatchTopology(topoDrumsFromKit(kit, drumList, oneZone));
    const snareHoops = nodes.filter((n) => n.id.startsWith('hoop:snare:'));
    expect(snareHoops).toHaveLength(9); // would be DEFAULT_KIT.global.hoopCount with the old bug
  });

  it('falls back to the kit global when a drum is absent from the kit', () => {
    const kit = nonDefaultKit();
    const topo = topoDrumsFromKit(kit, [{ id: 'ghost', label: 'Ghost' }], oneZone);
    expect(topo[0]!.hoopCount).toBe(kit.global.hoopCount);
  });

  it('injects the resolved zones per drum', () => {
    const topo = topoDrumsFromKit(DEFAULT_KIT, drumList, (id) => (id === 'kick' ? ['center', 'shell'] : ['edge']));
    expect(topo.find((t) => t.id === 'kick')!.zones).toEqual(['center', 'shell']);
    expect(topo.find((t) => t.id === 'snare')!.zones).toEqual(['edge']);
  });
});

describe('describePatchNode', () => {
  it('decodes structured ids into human titles, resolving drum labels', () => {
    expect(describePatchNode(INPUT_ID).title).toBe('Sensory Percussion');
    expect(describePatchNode(CONTROLLER_ID).stage).toBe('controller');
    expect(describePatchNode('trigger:tom1', KIT).title).toBe('Tom 1 Trigger');
    expect(describePatchNode('zone:tom1:edge', KIT).title).toBe('Tom 1 · edge');
    expect(describePatchNode('drum:snare', KIT).title).toBe('Snare Drum');
    expect(describePatchNode('hoop:kick:2', KIT).title).toBe('Kick Hoop 2');
    expect(describePatchNode('dataline:2').title).toBe('Data Line 2');
    expect(describePatchNode('output:1').title).toBe('Output 1');
  });

  it('falls back to the raw drum id when no label is known', () => {
    expect(describePatchNode('trigger:tom1').title).toBe('tom1 Trigger');
  });
});
