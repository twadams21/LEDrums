import { describe, expect, it } from 'vitest';
import { BUSES, EFFECTS, PRESETS } from './fixtures';
import { Sim, makeNode, type GraphNode, type TriggerCtx, type TriggerGraph } from './sim';
import { buildLabModel } from './kit';
import type { LabModel } from './kit';
import { renderFrame } from './render';

/* Splice through the OFFLINE preview path (sim spawn → render.ts), the mirror of core's
   compositor branch. Core's own tests prove the engine; these prove the browser preview an
   author actually looks at while building shows renders the same bands, in the same places,
   with the same blanks — the drift this mirror exists to prevent. */

function freshSim(): Sim {
  return new Sim(
    BUSES.map((b) => ({ ...b })),
    [...EFFECTS],
    [...PRESETS],
  );
}

const ctx = (drumId = 'kick'): TriggerCtx => ({
  velocity: 1,
  sectionIndex: 0,
  sectionCount: 0,
  beatPhase: 0,
  sourceDrumId: drumId,
  bpm: 120,
});

function spliceGraph(over: Partial<GraphNode>): TriggerGraph {
  return {
    version: 3,
    nodes: [
      makeNode('trigger', 'trigger', 0, 0),
      makeNode('splice', 's1', 200, 0, { mode: 'loop', scope: 'kit', splicePartition: 'hoop', ...over }),
      makeNode('output', 'output', 400, 0),
    ],
    edges: [
      { id: 'e0', from: 'trigger', to: 's1' },
      { id: 'e1', from: 's1', to: 'output' },
    ],
  };
}

/** Fire the graph and render one preview frame; returns the RGB buffer + the lab model. */
function render(graph: TriggerGraph, atMs = 80): { rgb: (i: number) => [number, number, number]; hoopLen: number; pm: LabModel['pm'] } {
  const lab = buildLabModel();
  const sim = freshSim();
  sim.triggerGraph('test', graph, ctx());
  // Step the clock rather than jumping it: the envelope integrates dt, so one big tick
  // overshoots the hold (the same trap the core render helper hit).
  for (let t = 5; t <= atMs; t += 5) sim.tick(5);
  const buf = new Uint8Array(lab.model.count * 3);
  renderFrame(buf, sim, lab);
  const kick = lab.pm.drums[0]!;
  return {
    rgb: (i) => [buf[i * 3]!, buf[i * 3 + 1]!, buf[i * 3 + 2]!],
    hoopLen: kick.hoopPixelCounts[0]!,
    pm: lab.pm,
  };
}

const isRed = ([r, g, b]: [number, number, number]) => r > 200 && g < 40 && b < 40;
const isBlue = ([r, g, b]: [number, number, number]) => b > 200 && r < 40 && g < 40;
const isDark = ([r, g, b]: [number, number, number]) => r + g + b === 0;

describe('splice — offline preview', () => {
  it('renders colour splices as bands across the first hoop', () => {
    const { rgb, hoopLen } = render(spliceGraph({ splices: [{ color: '#ff0000' }, { color: '#0000ff' }], spliceCount: 2 }));
    const half = Math.round(hoopLen / 2);
    expect(isRed(rgb(0)), 'first band red').toBe(true);
    expect(isRed(rgb(half - 1)), 'end of the first band still red').toBe(true);
    expect(isBlue(rgb(half)), 'second band blue').toBe(true);
    expect(isBlue(rgb(hoopLen - 1)), 'end of the second band still blue').toBe(true);
  });

  it('cuts every hoop, not only the first', () => {
    const { rgb, hoopLen } = render(spliceGraph({ splices: [{ color: '#ff0000' }, { color: '#0000ff' }], spliceCount: 2 }));
    expect(isRed(rgb(hoopLen)), 'second hoop starts red again').toBe(true);
    expect(isBlue(rgb(hoopLen + Math.round(hoopLen / 2))), 'second hoop second band blue').toBe(true);
  });

  it('leaves blank and muted splices dark', () => {
    const blank = render(spliceGraph({ splices: [{ color: '#ff0000' }, {}], spliceCount: 2 }));
    expect(isRed(blank.rgb(0))).toBe(true);
    expect(isDark(blank.rgb(blank.hoopLen - 1)), 'blank splice renders nothing').toBe(true);

    const muted = render(spliceGraph({ splices: [{ color: '#ff0000' }, { color: '#0000ff', muted: true }], spliceCount: 2 }));
    expect(isDark(muted.rgb(muted.hoopLen - 1)), 'muted splice renders nothing').toBe(true);
  });

  it('renders nothing at all when every splice is blank', () => {
    const lab = buildLabModel();
    const sim = freshSim();
    sim.triggerGraph('test', spliceGraph({ splices: [{}, { muted: true }], spliceCount: 2 }), ctx());
    sim.tick(40);
    expect(sim.voices).toHaveLength(0);
  });

  it('moves the content on a step chase', () => {
    const graph = spliceGraph({
      splices: [{ color: '#ff0000' }, { color: '#0000ff' }],
      spliceCount: 2,
      spliceChase: 'step',
      spliceRateMode: 'time',
      spliceRateMs: 100,
    });
    expect(isRed(render(graph, 80).rgb(0)), 'before the first step').toBe(true);
    expect(isBlue(render(graph, 160).rgb(0)), 'after one step the first band shows the other splice').toBe(true);
  });

  it('jumps the cut by the authored increment on a stagger', () => {
    const graph = spliceGraph({
      splices: [{ color: '#ff0000' }, { color: '#0000ff' }],
      spliceCount: 2,
      spliceChase: 'stagger',
      spliceRateMode: 'time',
      spliceRateMs: 100,
      spliceIncrementPx: 2,
    });
    const before = render(graph, 80);
    expect(isRed(before.rgb(0)), 'before the first jump').toBe(true);
    expect(isRed(before.rgb(1)), 'before the first jump').toBe(true);
    const after = render(graph, 160);
    expect(isRed(after.rgb(2)), 'the red band has jumped two pixels along').toBe(true);
    expect(isRed(after.rgb(0)), 'and is no longer where it started').toBe(false);
  });

  it('cascades the motion across hoops when an offset is set', () => {
    const graph = spliceGraph({
      splices: [{ color: '#ff0000' }, { color: '#0000ff' }],
      spliceCount: 2,
      spliceChase: 'step',
      spliceRateMode: 'time',
      spliceRateMs: 100,
      spliceOffsetMode: 'time',
      spliceOffsetMs: 5000,
      spliceOrder: 'up',
    });
    const { rgb, hoopLen } = render(graph, 150);
    expect(isBlue(rgb(0)), 'hoop 1 has stepped').toBe(true);
    expect(isRed(rgb(hoopLen)), 'hoop 2 is still waiting out its offset, lit but not moving').toBe(true);
  });

  it('cuts only the drum it is scoped to', () => {
    const { rgb, pm } = render(spliceGraph({ splices: [{ color: '#ff0000' }], spliceCount: 1, scope: 'drum', targetId: 'snare' }));
    const snare = pm.drumById.get('snare')!;
    expect(isDark(rgb(0)), 'kick untouched').toBe(true);
    expect(isRed(rgb(snare.pixelStart)), 'the snare is lit').toBe(true);
    expect(isRed(rgb(snare.pixelStart + snare.pixelCount - 1)), 'all the way through').toBe(true);
  });

  it('holds the lights up for the authored time in the preview too', () => {
    // One-shot, not the fixture's default loop: a loop never releases, so it could never
    // show the hold running out.
    const graph = spliceGraph({ mode: 'oneshot', splices: [{ color: '#ff0000' }], spliceCount: 1, spliceAttackMs: 10, spliceHoldMs: 2000, spliceReleaseMs: 100 });
    expect(isRed(render(graph, 900).rgb(0)), 'still inside the hold').toBe(true);
    const short = spliceGraph({ mode: 'oneshot', splices: [{ color: '#ff0000' }], spliceCount: 1, spliceAttackMs: 10, spliceHoldMs: 40, spliceReleaseMs: 20 });
    expect(isDark(render(short, 900).rgb(0)), 'a short hold is long gone').toBe(true);
  });

  it('latches the motion in the preview too — dark time is not movement', () => {
    const graph = spliceGraph({
      mode: 'oneshot',
      splices: [{ color: '#ff0000' }, { color: '#0000ff' }],
      spliceCount: 2,
      spliceChase: 'step',
      spliceRateMode: 'time',
      spliceRateMs: 150,
      spliceHoldMs: 100,
      spliceReleaseMs: 20,
      spliceMotionMode: 'latched',
    });
    /** Fire, let it fade, wait out `gapMs` in the dark, fire again, sample 40ms later. */
    const twoHits = (gapMs: number) => {
      const lab = buildLabModel();
      const sim = freshSim();
      const fire = () => sim.triggerGraph('test', graph, ctx());
      fire();
      for (let t = 5; t <= gapMs; t += 5) sim.tick(5);
      fire();
      for (let t = 0; t < 40; t += 5) sim.tick(5);
      const buf = new Uint8Array(lab.model.count * 3);
      renderFrame(buf, sim, lab);
      return [buf[0]!, buf[1]!, buf[2]!] as [number, number, number];
    };
    // Only lit time counts, so wildly different dark gaps land on the same splice.
    expect(twoHits(500)).toEqual(twoHits(3000));
  });

  it('smudges the boundary in the preview too', () => {
    const hard = render(spliceGraph({ splices: [{ color: '#ff0000' }, { color: '#0000ff' }], spliceCount: 2 }));
    const soft = render(spliceGraph({ splices: [{ color: '#ff0000' }, { color: '#0000ff' }], spliceCount: 2, spliceSmudge: 1 }));
    const seam = Math.round(hard.hoopLen / 2);
    expect(isBlue(hard.rgb(seam)), 'hard cut: pure blue at the seam').toBe(true);
    const [r, , b] = soft.rgb(seam);
    expect(r, 'smudged: red bleeds across').toBeGreaterThan(0);
    expect(b, 'smudged: blue still present').toBeGreaterThan(0);
  });

  it('tints an effect splice toward its colour, and leaves a colourless one alone', () => {
    const fx = EFFECTS.find((e) => e.generatorId === 'breathing-kit')!.id;
    const { rgb, hoopLen } = render(spliceGraph({ splices: [{ effectId: fx, color: '#ff0000' }, { effectId: fx }], spliceCount: 2 }));
    const [tr, tg, tb] = rgb(0);
    const untinted = rgb(hoopLen - 1);
    expect(tr, 'tinted splice is lit').toBeGreaterThan(0);
    expect(tg + tb, 'tinted splice has lost everything but red').toBeLessThanOrEqual(2);
    expect(untinted[1] + untinted[2], 'untinted splice keeps the effect colour').toBeGreaterThan(0);
  });
});
