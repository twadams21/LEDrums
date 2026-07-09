import { describe, expect, it } from 'vitest';
import { voice } from '@ledrums/core';
import { BUSES, EFFECTS, PRESETS } from './fixtures';
import { Sim, makeNode, type GraphEdge, type GraphNode, type TriggerCtx, type TriggerGraph } from './sim';

function sim(): Sim {
  return new Sim(
    BUSES.map((b) => ({ ...b })),
    EFFECTS.map((e) => ({ ...e })),
    PRESETS.map((p) => ({ ...p })),
  );
}

function state(): voice.EvalState {
  return {
    seqIndex: new Map(),
    lastPick: new Map(),
    latched: new Map(),
    prng: new voice.Prng(0x1a2b3c4d),
    presetsById: new Map(PRESETS.map((p) => [p.id, p])),
    isVoiceAlive: () => false,
  };
}

const ctx = (velocity = 0.25): TriggerCtx => ({ velocity, sectionIndex: 0, sectionCount: 1, beatPhase: 0, sourceDrumId: 'kick', bpm: 120 });
const edge = (id: string, from: string, to: string, over: Partial<GraphEdge> = {}): GraphEdge => ({ id, from, to, ...over });
const effect = (id: string, y = 0): GraphNode => makeNode('effect', id, 200, y, { effectId: `gen:${id}` });
const generatorIdFor = (effectId: string): string | undefined => EFFECTS.find((effect) => effect.id === effectId)?.generatorId;

function graph(nodes: GraphNode[], edges: GraphEdge[]): TriggerGraph {
  return { version: 3, nodes: [makeNode('trigger', 'trigger'), ...nodes, makeNode('output', 'output', 800, 0)], edges };
}

function corePlays(g: TriggerGraph, c = ctx()): voice.PlayAction[] {
  return voice.evalGraph(state(), g, 'preview', c).filter((a): a is voice.PlayAction => a.kind === 'play');
}

describe('Sim Gen3 preview parity with core eval', () => {
  it('matches core for an unwired Gen3 effect', () => {
    const g = graph([effect('plasma')], [edge('t-fx', 'trigger', 'plasma')]);
    const s = sim();
    s.triggerGraph('pad', g, ctx());

    expect(corePlays(g)).toEqual([]);
    expect(s.voices).toEqual([]);
  });

  it('matches core active Switch to Mix membership', () => {
    const g = graph(
      [
        makeNode('switch', 'sw', 100, 0, { valueMode: 'bands', bands: [0.5] }),
        effect('chase-bands', 0),
        effect('plasma', 100),
        makeNode('mix', 'mix', 500, 0),
      ],
      [
        edge('t-sw', 'trigger', 'sw'),
        edge('sw-low', 'sw', 'chase-bands', { fromPort: 'band-0' }),
        edge('sw-high', 'sw', 'plasma', { fromPort: 'band-1' }),
        edge('low-mix', 'chase-bands', 'mix'),
        edge('high-mix', 'plasma', 'mix'),
        edge('mix-output', 'mix', 'output'),
      ],
    );
    const c = ctx(0.25);
    const s = sim();
    s.triggerGraph('pad', g, c);

    expect(corePlays(g, c)[0]?.mixInputs?.map((input) => input.effectId)).toEqual(['gen:chase-bands']);
    expect(s.voices[0]?.mixInputs?.map((input) => input.generatorId)).toEqual([generatorIdFor('gen:chase-bands')]);
  });

  it('matches core for Mix branch scopes', () => {
    const g = graph(
      [
        makeNode('all', 'all', 100, 0),
        makeNode('effect', 'snare', 200, 0, { effectId: 'gen:plasma', scope: 'drum', targetId: 'snare' }),
        makeNode('effect', 'kick', 200, 100, { effectId: 'gen:chase-bands', scope: 'drum', targetId: 'kick' }),
        makeNode('mix', 'mix', 500, 0),
      ],
      [
        edge('t-all', 'trigger', 'all'),
        edge('all-snare', 'all', 'snare'),
        edge('all-kick', 'all', 'kick'),
        edge('snare-mix', 'snare', 'mix'),
        edge('kick-mix', 'kick', 'mix'),
        edge('mix-output', 'mix', 'output'),
      ],
    );
    const s = sim();
    s.triggerGraph('pad', g, ctx());

    expect(corePlays(g)[0]?.mixInputs?.map((input) => [input.effectId, input.scope, input.targetId])).toEqual([
      ['gen:plasma', 'drum', 'snare'],
      ['gen:chase-bands', 'drum', 'kick'],
    ]);
    expect(s.voices[0]?.mixInputs?.map((input) => [input.generatorId, input.scope, input.targetId])).toEqual([
      [generatorIdFor('gen:plasma'), 'drum', 'snare'],
      [generatorIdFor('gen:chase-bands'), 'drum', 'kick'],
    ]);
  });
});
