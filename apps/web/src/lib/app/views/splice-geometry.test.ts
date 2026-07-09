import { describe, expect, it } from 'vitest';
import { edgeUnderNode, type EdgeEnds, type NodeRect } from './splice-geometry';

/* R08 hit-test: which wire is a dragged node sitting on? A wire is the chord from its source
   node's right-middle to its target node's left-middle; a node arms a splice when its rect
   overlaps that chord. */

// a (right edge x=100, mid y=50) --> b (left edge x=300, mid y=50): a horizontal wire at y≈50.
const rects = new Map<string, NodeRect>([
  ['a', { x: 0, y: 0, w: 100, h: 100 }],
  ['b', { x: 300, y: 0, w: 100, h: 100 }],
]);
const edges: EdgeEnds[] = [{ id: 'e1', source: 'a', target: 'b' }];

describe('edgeUnderNode', () => {
  it('arms the wire when the dragged rect overlaps the chord', () => {
    const dragged: NodeRect = { x: 180, y: 30, w: 40, h: 40 }; // straddles y=50 between a and b
    expect(edgeUnderNode('n', dragged, edges, new Map([...rects, ['n', dragged]]))).toBe('e1');
  });

  it('does not arm when the rect misses the chord', () => {
    const dragged: NodeRect = { x: 180, y: 200, w: 40, h: 40 }; // well below the wire
    expect(edgeUnderNode('n', dragged, edges, new Map([...rects, ['n', dragged]]))).toBeNull();
  });

  it('never arms a wire touching the dragged node itself', () => {
    // The dragged node IS the wire's source — you can't splice into your own wire.
    const dragged: NodeRect = { x: 0, y: 0, w: 100, h: 100 };
    const only: EdgeEnds[] = [{ id: 'e1', source: 'a', target: 'b' }];
    expect(edgeUnderNode('a', dragged, only, rects)).toBeNull();
  });

  it('skips edges whose endpoint rects are unknown', () => {
    const orphan: EdgeEnds[] = [{ id: 'e9', source: 'a', target: 'ghost' }];
    const dragged: NodeRect = { x: 180, y: 30, w: 40, h: 40 };
    expect(edgeUnderNode('n', dragged, orphan, new Map([...rects, ['n', dragged]]))).toBeNull();
  });

  it('picks the nearest wire when the rect overlaps more than one', () => {
    const many = new Map<string, NodeRect>([
      ['a', { x: 0, y: 0, w: 100, h: 100 }], // wire e1 at y≈50
      ['b', { x: 300, y: 0, w: 100, h: 100 }],
      ['c', { x: 0, y: 60, w: 100, h: 100 }], // wire e2 at y≈110
      ['d', { x: 300, y: 60, w: 100, h: 100 }],
    ]);
    const twoEdges: EdgeEnds[] = [
      { id: 'e1', source: 'a', target: 'b' },
      { id: 'e2', source: 'c', target: 'd' },
    ];
    // A tall rect centred at y≈55 overlaps both; e1 (y=50) is nearer its centre than e2 (y=110).
    const dragged: NodeRect = { x: 180, y: 10, w: 40, h: 90 };
    expect(edgeUnderNode('n', dragged, twoEdges, new Map([...many, ['n', dragged]]))).toBe('e1');
  });
});
