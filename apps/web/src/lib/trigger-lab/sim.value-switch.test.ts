import { beforeEach, describe, expect, it } from 'vitest';
import { BUSES, EFFECTS, PRESETS } from './fixtures';
import { Sim, bandIndex, makeNode, type GraphEdge, type GraphNode, type TriggerGraph, type TriggerCtx } from './sim';

/** A fresh sim over the fixture buses/effects/presets for each scenario. */
function mk(): Sim {
  return new Sim(
    BUSES.map((b) => ({ ...b })),
    EFFECTS.map((e) => ({ ...e })),
    PRESETS.map((p) => ({ ...p })),
  );
}

function ctxV(velocity: number): TriggerCtx {
  return { velocity, sectionIndex: 0, sectionCount: 3, beatPhase: 0, sourceDrumId: 'd', bpm: 120 };
}

/** trigger → switch(value) → children, then return effect ids spawned by a hit. */
function fireValueSwitch(sw: Partial<GraphNode>, children: GraphNode[], edges: GraphEdge[], velocity: number): string[] {
  const sim = mk();
  const graph: TriggerGraph = {
    nodes: [makeNode('trigger', 'trigger', 0, 0), makeNode('switch', 'sw', 200, 0, { on: 'value', ...sw }), ...children],
    edges: [{ id: 'e-t', from: 'trigger', to: 'sw' }, ...edges],
  };
  sim.triggerGraph('pad', graph, ctxV(velocity));
  return sim.voices.map((v) => v.effectId).sort();
}

function fireGraph(graph: TriggerGraph): Sim['voices'] {
  const sim = mk();
  sim.triggerGraph('pad', graph, ctxV(1));
  return sim.voices;
}

describe('bandIndex resolver', () => {
  it('routes value at or below a cutoff to that band (lower wins at the boundary)', () => {
    expect(bandIndex(0.0, [0.5])).toBe(0);
    expect(bandIndex(0.49, [0.5])).toBe(0);
    expect(bandIndex(0.5, [0.5])).toBe(0); // exactly at the cutoff → lower band
  });

  it('routes value above the last cutoff to the final "rest" band', () => {
    expect(bandIndex(0.51, [0.5])).toBe(1);
    expect(bandIndex(1.0, [0.5])).toBe(1);
  });

  it('picks the right band across multiple ascending cutoffs', () => {
    const cuts = [0.3, 0.7];
    expect(bandIndex(0.3, cuts)).toBe(0);
    expect(bandIndex(0.31, cuts)).toBe(1);
    expect(bandIndex(0.7, cuts)).toBe(1);
    expect(bandIndex(0.71, cuts)).toBe(2);
  });

  it('treats an empty cutoff list as a single band', () => {
    expect(bandIndex(0.4, [])).toBe(0);
  });
});

describe('value switch — gate', () => {
  const playChase = makeNode('play', 'p', 400, 0, { effectId: 'gen:chase-bands', presetId: 'chase:default' });
  const wire: GraphEdge[] = [{ id: 'e1', from: 'sw', to: 'p' }];

  it('passes the child when value ≤ threshold (default direction)', () => {
    expect(fireValueSwitch({ valueMode: 'gate', threshold: 0.5, invert: false }, [playChase], wire, 0.3)).toEqual(['gen:chase-bands']);
  });

  it('blocks (does nothing) when value > threshold', () => {
    expect(fireValueSwitch({ valueMode: 'gate', threshold: 0.5, invert: false }, [playChase], wire, 0.7)).toEqual([]);
  });

  it('passes at exactly the threshold (≤ is inclusive)', () => {
    expect(fireValueSwitch({ valueMode: 'gate', threshold: 0.5, invert: false }, [playChase], wire, 0.5)).toEqual(['gen:chase-bands']);
  });

  it('inverts: passes when value > threshold, blocks below', () => {
    expect(fireValueSwitch({ valueMode: 'gate', threshold: 0.5, invert: true }, [playChase], wire, 0.7)).toEqual(['gen:chase-bands']);
    expect(fireValueSwitch({ valueMode: 'gate', threshold: 0.5, invert: true }, [playChase], wire, 0.3)).toEqual([]);
  });
});

describe('value switch — bands', () => {
  // two bands (cutoff 0.5): band-0 → chase, band-1 → sparkle
  const twoBandKids = [
    makeNode('play', 'a', 400, -40, { effectId: 'gen:chase-bands', presetId: 'chase:default' }),
    makeNode('play', 'b', 400, 40, { effectId: 'gen:pixel-accum', presetId: 'sparkle:default' }),
  ];
  const twoBandWires: GraphEdge[] = [
    { id: 'e0', from: 'sw', to: 'a', fromPort: 'band-0' },
    { id: 'e1', from: 'sw', to: 'b', fromPort: 'band-1' },
  ];

  it('fires the child wired from the band the value lands in', () => {
    expect(fireValueSwitch({ valueMode: 'bands', bands: [0.5] }, twoBandKids, twoBandWires, 0.3)).toEqual(['gen:chase-bands']);
    expect(fireValueSwitch({ valueMode: 'bands', bands: [0.5] }, twoBandKids, twoBandWires, 0.7)).toEqual(['gen:pixel-accum']);
  });

  it('routes a value exactly at a cutoff to the lower band', () => {
    expect(fireValueSwitch({ valueMode: 'bands', bands: [0.5] }, twoBandKids, twoBandWires, 0.5)).toEqual(['gen:chase-bands']);
  });

  it('routes a value above the last cutoff to the final band', () => {
    expect(fireValueSwitch({ valueMode: 'bands', bands: [0.5] }, twoBandKids, twoBandWires, 1.0)).toEqual(['gen:pixel-accum']);
  });

  it('only the matching band fires — other bands stay silent', () => {
    // value 0.7 lands in band-1; band-0's child (chase) must NOT fire
    const ids = fireValueSwitch({ valueMode: 'bands', bands: [0.5] }, twoBandKids, twoBandWires, 0.7);
    expect(ids).not.toContain('gen:chase-bands');
  });

  it('a band with no wired child does nothing (empty middle band)', () => {
    // three bands (cutoffs 0.3, 0.7); wire only band-0 and band-2, leave band-1 empty
    const kids = [
      makeNode('play', 'a', 400, -60, { effectId: 'gen:chase-bands', presetId: 'chase:default' }),
      makeNode('play', 'c', 400, 60, { effectId: 'gen:pixel-accum', presetId: 'sparkle:default' }),
    ];
    const wires: GraphEdge[] = [
      { id: 'e0', from: 'sw', to: 'a', fromPort: 'band-0' },
      { id: 'e2', from: 'sw', to: 'c', fromPort: 'band-2' },
    ];
    const sw = { valueMode: 'bands' as const, bands: [0.3, 0.7] };
    expect(fireValueSwitch(sw, kids, wires, 0.2)).toEqual(['gen:chase-bands']); // band-0
    expect(fireValueSwitch(sw, kids, wires, 0.5)).toEqual([]); // band-1 empty → nothing
    expect(fireValueSwitch(sw, kids, wires, 0.9)).toEqual(['gen:pixel-accum']); // band-2
  });

  it('ignores edges on the default output when in bands mode (port-less wires fire nothing)', () => {
    // an edge with no fromPort must not be treated as any band
    const kids = [makeNode('play', 'a', 400, 0, { effectId: 'gen:chase-bands', presetId: 'chase:default' })];
    const wires: GraphEdge[] = [{ id: 'e0', from: 'sw', to: 'a' }];
    expect(fireValueSwitch({ valueMode: 'bands', bands: [0.5] }, kids, wires, 0.2)).toEqual([]);
  });
});

describe('value switch — back-compat defaults', () => {
  // a switch node missing the new value fields (as an old persisted graph would be)
  // must still evaluate: default to gate, threshold 0.5, not inverted.
  it('defaults a value switch with absent fields to a ≤0.5 gate', () => {
    const sim = mk();
    const sw = makeNode('switch', 'sw', 200, 0, { on: 'value' });
    // simulate an old node lacking the new fields entirely
    delete (sw as Partial<GraphNode>).valueMode;
    delete (sw as Partial<GraphNode>).threshold;
    delete (sw as Partial<GraphNode>).invert;
    delete (sw as Partial<GraphNode>).bands;
    const graph: TriggerGraph = {
      nodes: [makeNode('trigger', 'trigger', 0, 0), sw, makeNode('play', 'p', 400, 0, { effectId: 'gen:chase-bands', presetId: 'chase:default' })],
      edges: [
        { id: 'e-t', from: 'trigger', to: 'sw' },
        { id: 'e1', from: 'sw', to: 'p' },
      ],
    };
    sim.triggerGraph('pad', graph, ctxV(0.3));
    expect(sim.voices.map((v) => v.effectId)).toEqual(['gen:chase-bands']); // ≤0.5 → passes
  });
});

describe('non-value switch modes unchanged', () => {
  it('section routes by section index, count-based (velocity is gone; section stays)', () => {
    const sim = mk();
    const graph: TriggerGraph = {
      nodes: [
        makeNode('trigger', 'trigger', 0, 0),
        makeNode('switch', 'sw', 200, 0, { on: 'section' }),
        makeNode('play', 'a', 400, -40, { effectId: 'gen:chase-bands', presetId: 'chase:default' }),
        makeNode('play', 'b', 400, 40, { effectId: 'gen:pixel-accum', presetId: 'sparkle:default' }),
      ],
      edges: [
        { id: 'e-t', from: 'trigger', to: 'sw' },
        { id: 'e0', from: 'sw', to: 'a' },
        { id: 'e1', from: 'sw', to: 'b' },
      ],
    };
    sim.triggerGraph('pad', graph, ctxV(0.2)); // ctx sectionIndex 0 → first child
    expect(sim.voices.map((v) => v.effectId)).toEqual(['gen:chase-bands']);
  });
});

describe('Gen3 output-gated rendering and cascading Scope', () => {
  it('effect nodes emit only when their route reaches Output', () => {
    const loose: TriggerGraph = {
      version: 3,
      nodes: [
        makeNode('trigger', 'trigger'),
        makeNode('effect', 'fx', 200, 0, { effectId: 'gen:chase-bands', presetId: 'chase:default' }),
        makeNode('output', 'output', 400, 0),
      ],
      edges: [{ id: 'e1', from: 'trigger', to: 'fx' }],
    };
    expect(fireGraph(loose)).toHaveLength(0);

    const wired: TriggerGraph = { ...loose, edges: [...loose.edges, { id: 'e2', from: 'fx', to: 'output' }] };
    expect(fireGraph(wired).map((v) => v.effectId)).toEqual(['gen:chase-bands']);
  });

  it('migrated legacy routes wired through Scope to Output still emit', () => {
    const graph: TriggerGraph = {
      version: 3,
      nodes: [
        makeNode('trigger', 'trigger'),
        makeNode('effect', 'fx', 200, 0, { effectId: 'gen:chase-bands', presetId: 'chase:default', scope: 'kit' }),
        makeNode('scope', 'legacy-output', 400, 0, { scope: 'drum', targetId: 'snare' }),
        makeNode('output', 'output', 600, 0),
      ],
      edges: [
        { id: 'e1', from: 'trigger', to: 'fx' },
        { id: 'e2', from: 'fx', to: 'legacy-output' },
        { id: 'e3', from: 'legacy-output', to: 'output' },
      ],
    };

    expect(fireGraph(graph)[0]).toMatchObject({ effectId: 'gen:chase-bands', scope: 'drum', targetId: 'snare' });
  });

  it('composes Scope filters by strict intersection and renders empty intersections as nothing', () => {
    const graph: TriggerGraph = {
      version: 3,
      nodes: [
        makeNode('trigger', 'trigger'),
        makeNode('effect', 'fx', 200, 0, { effectId: 'gen:chase-bands', presetId: 'chase:default', scope: 'kit' }),
        makeNode('scope', 'snare', 400, 0, { scope: 'drum', targetId: 'snare' }),
        makeNode('scope', 'snare-hoop', 600, 0, { scope: 'hoop', targetId: 'snare#1' }),
        makeNode('output', 'output', 800, 0),
      ],
      edges: [
        { id: 'e1', from: 'trigger', to: 'fx' },
        { id: 'e2', from: 'fx', to: 'snare' },
        { id: 'e3', from: 'snare', to: 'snare-hoop' },
        { id: 'e4', from: 'snare-hoop', to: 'output' },
      ],
    };

    expect(fireGraph(graph)[0]).toMatchObject({ scope: 'hoop', targetId: 'snare#1' });
    const empty = { ...graph, nodes: graph.nodes.map((n) => (n.id === 'snare-hoop' ? { ...n, targetId: 'kick#1' } : n)) };
    expect(fireGraph(empty)).toHaveLength(0);
  });

  it('whole-kit Scope never broadens or resets a narrowed upstream scope', () => {
    const graph: TriggerGraph = {
      version: 3,
      nodes: [
        makeNode('trigger', 'trigger'),
        makeNode('effect', 'fx', 200, 0, { effectId: 'gen:chase-bands', presetId: 'chase:default', scope: 'drum', targetId: 'snare' }),
        makeNode('scope', 'kit-scope', 400, 0, { scope: 'kit' }),
        makeNode('output', 'output', 600, 0),
      ],
      edges: [
        { id: 'e1', from: 'trigger', to: 'fx' },
        { id: 'e2', from: 'fx', to: 'kit-scope' },
        { id: 'e3', from: 'kit-scope', to: 'output' },
      ],
    };

    expect(fireGraph(graph)[0]).toMatchObject({ scope: 'drum', targetId: 'snare' });
  });
});
