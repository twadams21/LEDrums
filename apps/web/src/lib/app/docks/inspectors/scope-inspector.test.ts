import { describe, expect, it } from 'vitest';
import { makeNode } from '../../../trigger-lab/sim.graph-compilation';
import {
  describeSelection,
  effectiveScopeForNode,
  encodeHoopTarget,
  hoopLabel,
  parseHoopTarget,
  selectionFromNode,
  toggleHoop,
} from './scope-inspector';

const drums = [
  { id: 'kick', label: 'Kick', hoopCount: 4 },
  { id: 'snare', label: 'Snare', hoopCount: 4 },
];

describe('scope inspector helpers', () => {
  it('uses 1-based hoop labels and ids (A1)', () => {
    expect(hoopLabel(1)).toBe('Hoop 1');
    expect(hoopLabel(4)).toBe('Hoop 4');
    expect(encodeHoopTarget('snare', [3, 1, 3])).toBe('snare#1,3'); // dedup + drop <1, sort
    expect(parseHoopTarget('snare#1,3', 'kick')).toEqual({ drumId: 'snare', hoops: [1, 3] });
  });

  it('derives whole-kit, whole-drum, and multi-hoop selections from node scope', () => {
    expect(selectionFromNode(makeNode('scope', 's', 0, 0, { scope: 'kit' }), drums)).toEqual({ kind: 'kit' });
    expect(selectionFromNode(makeNode('scope', 's', 0, 0, { scope: 'drum', targetId: 'snare' }), drums)).toEqual({
      kind: 'drum',
      drumId: 'snare',
    });
    expect(selectionFromNode(makeNode('scope', 's', 0, 0, { scope: 'hoop', targetId: 'snare#1,3' }), drums)).toEqual({
      kind: 'hoops',
      drumId: 'snare',
      hoops: [1, 3],
    });
  });

  it('click selects one hoop and primary-modifier click toggles multiple hoops', () => {
    expect(toggleHoop([0, 2], 3, false)).toEqual([3]);
    expect(toggleHoop([0, 2], 3, true)).toEqual([0, 2, 3]);
    expect(toggleHoop([0, 2], 2, true)).toEqual([0]);
  });

  it('describes whole kit as a no-op filter and an empty hoop set explicitly', () => {
    expect(describeSelection({ kind: 'kit' }, drums)).toMatchObject({ label: 'Whole kit', detail: 'No filter', noOp: true });
    expect(describeSelection({ kind: 'drum', drumId: 'snare' }, drums)).toMatchObject({ label: 'Snare', detail: 'Whole drum' });
    expect(describeSelection({ kind: 'hoops', drumId: 'snare', hoops: [] }, drums)).toMatchObject({ detail: 'None', empty: true });
    expect(describeSelection({ kind: 'hoops', drumId: 'snare', hoops: [1, 3] }, drums)).toMatchObject({
      label: 'Snare',
      detail: 'Hoop 1, Hoop 3',
    });
  });

  it('shows effective scope through upstream filters including empty intersections', () => {
    const fx = makeNode('effect', 'fx', 100, 0, { scope: 'drum', targetId: 'snare' });
    const kitScope = makeNode('scope', 'scope', 200, 0, { scope: 'kit' });
    expect(effectiveScopeForNode({ nodes: [fx, kitScope], edges: [{ from: 'fx', to: 'scope' }] }, kitScope, drums)).toMatchObject({
      label: 'Snare',
      detail: 'Whole drum · whole-kit Scope is no-op',
      noOp: true,
    });

    const kickScope = makeNode('scope', 'kick-scope', 200, 0, { scope: 'drum', targetId: 'kick' });
    expect(effectiveScopeForNode({ nodes: [fx, kickScope], edges: [{ from: 'fx', to: 'kick-scope' }] }, kickScope, drums)).toMatchObject({
      label: 'Empty',
      empty: true,
    });
  });

  it('reads all incoming flow branches instead of whichever edge appears first', () => {
    const kickFx = makeNode('effect', 'kick-fx', 100, -40, { scope: 'drum', targetId: 'kick' });
    const snareFx = makeNode('effect', 'snare-fx', 100, 40, { scope: 'drum', targetId: 'snare' });
    const scope = makeNode('scope', 'scope', 200, 0, { scope: 'kit' });

    expect(
      effectiveScopeForNode(
        {
          nodes: [kickFx, snareFx, scope],
          edges: [
            { from: 'kick-fx', to: 'scope' },
            { from: 'snare-fx', to: 'scope' },
          ],
        },
        scope,
        drums,
      ),
    ).toMatchObject({ label: 'Mixed routes', empty: false });
  });

  it('ignores modulation/param wires when computing upstream flow scope', () => {
    const kickFx = makeNode('effect', 'kick-fx', 100, 0, { scope: 'drum', targetId: 'kick' });
    const snareMod = makeNode('effect', 'snare-mod', 100, 80, { scope: 'drum', targetId: 'snare' });
    const scope = makeNode('scope', 'scope', 200, 0, { scope: 'kit' });

    expect(
      effectiveScopeForNode(
        {
          nodes: [kickFx, snareMod, scope],
          edges: [
            { from: 'kick-fx', to: 'scope' },
            { from: 'snare-mod', to: 'scope', toPort: 'param:intensity' },
          ],
        },
        scope,
        drums,
      ),
    ).toMatchObject({ label: 'Kick', detail: 'Whole drum · whole-kit Scope is no-op' });
  });
});
