import { describe, expect, it } from 'vitest';
import { graphThumb } from './graph-thumb';

describe('graphThumb', () => {
  it('scales node positions into the padded box', () => {
    const spec = graphThumb(
      {
        nodes: [
          { id: 'a', x: 0, y: 0 },
          { id: 'b', x: 100, y: 200 },
        ],
        edges: [],
      },
      172,
      104,
      16,
    );
    expect(spec.dots).toEqual([
      { x: 16, y: 16 },
      { x: 156, y: 88 },
    ]);
  });

  it('centres a degenerate axis (single node / zero span)', () => {
    const one = graphThumb({ nodes: [{ id: 'a', x: 40, y: 7 }], edges: [] }, 172, 104);
    expect(one.dots).toEqual([{ x: 86, y: 52 }]);

    const flat = graphThumb(
      {
        nodes: [
          { id: 'a', x: 0, y: 50 },
          { id: 'b', x: 10, y: 50 },
        ],
        edges: [],
      },
      172,
      104,
      16,
    );
    expect(flat.dots.map((d) => d.y)).toEqual([52, 52]);
  });

  it('draws one bezier per resolvable edge and skips dangling ones', () => {
    const spec = graphThumb(
      {
        nodes: [
          { id: 'a', x: 0, y: 0 },
          { id: 'b', x: 100, y: 100 },
        ],
        edges: [
          { from: 'a', to: 'b' },
          { from: 'a', to: 'ghost' },
        ],
      },
      172,
      104,
      16,
    );
    expect(spec.paths).toHaveLength(1);
    expect(spec.paths[0]).toBe('M16,16 C86,16 86,88 156,88');
  });

  it('returns empty for an empty graph', () => {
    expect(graphThumb({ nodes: [], edges: [] })).toEqual({ dots: [], paths: [] });
  });
});
