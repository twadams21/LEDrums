import { describe, expect, it } from 'vitest';
import { DEFAULT_KIT, type KitConfig } from '@ledrums/core';
import { CONTROLLER_ID, INPUT_ID } from './patch-node-id';
import { describePatchNode, topoDrumsFromKit, type TopologyDrum } from './patch-topology';

/** The current canonical kit: kick has 2 zones, the rest have the full 4; all 4 hoops. */
const KIT: TopologyDrum[] = [
  { id: 'kick', label: 'Kick', zones: ['center', 'shell'], hoopCount: 4 },
  { id: 'snare', label: 'Snare', zones: ['center', 'edge', 'rim', 'shell'], hoopCount: 4 },
  { id: 'tom1', label: 'Tom 1', zones: ['center', 'edge', 'rim', 'shell'], hoopCount: 4 },
  { id: 'tom2', label: 'Tom 2', zones: ['center', 'edge', 'rim', 'shell'], hoopCount: 4 },
];

describe('topoDrumsFromKit (#11: input half follows the project kit, not DEFAULT_KIT)', () => {
  const drumList = DEFAULT_KIT.drums.map((d) => ({ id: d.id, label: d.label }));
  const oneZone = (): string[] => ['center'];

  /** A kit whose per-drum + global hoop counts all differ from DEFAULT_KIT's. `hoops` is dropped
   *  so the count resolves via the override/global path this suite exercises — with B4's
   *  first-class `hoops[]` present it would be authoritative (drumHoopCount = hoops.length),
   *  which the per-hoop-attrs suite covers; here we test the hoopCount/global fallback. */
  function nonDefaultKit(): KitConfig {
    return {
      ...DEFAULT_KIT,
      global: { ...DEFAULT_KIT.global, hoopCount: DEFAULT_KIT.global.hoopCount + 5 },
      drums: DEFAULT_KIT.drums.map((d) =>
        d.id === 'snare'
          ? { ...d, hoops: undefined, hoopCount: 9 }
          : { ...d, hoops: undefined, hoopCount: undefined },
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
    expect(describePatchNode('drum:snare', KIT).title).toBe('Snare Drum');
    expect(describePatchNode('hoop:kick:2', KIT).title).toBe('Kick Hoop 2');
    expect(describePatchNode('output:1').title).toBe('Output 1');
  });

  it('falls back to the raw drum id when no label is known', () => {
    expect(describePatchNode('trigger:tom1').title).toBe('tom1 Trigger');
  });

  // S3 declared divergence (a): the old split-based decode truncated a colon-carrying
  // drum id ('hoop:weird:id:3' titled as 'weird Hoop id'); the total decoder rejoins it.
  it('rejoins a colon-carrying drum id in a hoop title', () => {
    expect(describePatchNode('hoop:weird:id:3').title).toBe('weird:id Hoop 3');
  });

  // S3 declared divergence (b): an output flow-node id carries its FULL payload. The
  // shipping ids are double-prefixed (`output:output:<n>` — reconcileOutputs mints
  // OutputConfig.id as `output:<n>`), so the old first-segment render titled every
  // reconciled port as the literal 'Output output'. S4 resolves the payload to the
  // display index; at this step the raw payload is carried through.
  it('carries the full output payload for the shipping double-prefixed id', () => {
    expect(describePatchNode('output:output:1').title).toBe('Output output:1');
  });

  // Decision 5: the zone arm is retired — nothing mints `zone:` ids and the zone
  // Inspector arm is gone, so a zone id falls through to the unknown rendering.
  it('treats a legacy zone id as unrecognised', () => {
    expect(describePatchNode('zone:tom1:edge', KIT).title).toBe('zone:tom1:edge');
  });
});
