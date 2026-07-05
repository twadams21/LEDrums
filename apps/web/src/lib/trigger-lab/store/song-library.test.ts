import { describe, it, expect } from 'vitest';
import { extractSongClosure, songNamespace, type ClosureSources } from './song-library';
import { makeNode } from '../sim.graph-compilation';
import type { EffectDef, Preset, TriggerGraph } from '../sim';
import { makeSection, makeSong, type Song } from '../../app/setlist';

// ---- fixtures ---------------------------------------------------------------

const effect = (id: string): EffectDef => ({
  id,
  name: id,
  busId: 'base',
  scope: 'kit',
  params: [],
  attackMs: 0,
  sustainMs: 0,
  releaseMs: 0,
});

const preset = (id: string, effectId: string): Preset => ({ id, name: id, effectId, params: {} });

const playGraph = (effectId: string, presetId: string): TriggerGraph => ({
  nodes: [
    makeNode('trigger', 'trigger', 0, 0),
    makeNode('play', 'p1', 0, 0, { kind: 'play', effectId, presetId, params: { hue: 0.5 } }),
  ],
  edges: [{ id: 'e1', from: 'trigger', to: 'p1' }],
});

/** A graph exercising modulation + modifier nodes: a play node fed by an LFO/CC/envelope via
    `param:` edges and routed through a modifier. Only the play node should pull an effect/preset;
    the modifier's `modifierId` and the modulation-source nodes reach nothing. */
const modulatedGraph = (): TriggerGraph => ({
  nodes: [
    makeNode('trigger', 'trigger'),
    makeNode('play', 'p1', 0, 0, { kind: 'play', effectId: 'fx-mod', presetId: 'fx-mod:default', modInputs: [{ param: 'hue' }] }),
    makeNode('modifier', 'm1', 0, 0, { kind: 'modifier', modifierId: 'invert', modInputs: [{ param: 'amount' }] }),
    makeNode('lfo', 'l1', 0, 0, { kind: 'lfo' }),
    makeNode('cc', 'c1', 0, 0, { kind: 'cc', ccController: 21 }),
    makeNode('envelope', 'ev1', 0, 0, { kind: 'envelope' }),
  ],
  edges: [
    { id: 'e1', from: 'trigger', to: 'p1' },
    { id: 'e2', from: 'm1', to: 'p1', toPort: 'mod' },
    { id: 'e3', from: 'l1', to: 'p1', toPort: 'param:hue', amount: 0.5 },
    { id: 'e4', from: 'c1', to: 'm1', toPort: 'param:amount' },
    { id: 'e5', from: 'ev1', to: 'p1', toPort: 'param:hue' },
  ],
});

function sources(over: Partial<ClosureSources> = {}): ClosureSources {
  return {
    graphs: {},
    graphNames: {},
    effects: [],
    presets: [],
    ...over,
  };
}

describe('songNamespace', () => {
  it('prefixes (not suffixes) so `:default` survives re-keying', () => {
    const prefix = songNamespace('song-1');
    expect(`${prefix}fx:default`.endsWith(':default')).toBe(true);
  });

  it('distinct song ids yield disjoint namespaces', () => {
    expect(songNamespace('a')).not.toEqual(songNamespace('b'));
  });
});

describe('extractSongClosure — exact reachability', () => {
  it('captures exactly the graphs/effects/presets the song reaches, no more', () => {
    const song = makeSong('song-1', 'Intro', [makeSection('song-1-s1', 'A', ['g-kick'])]);
    const src = sources({
      graphs: { 'g-kick': playGraph('fx-kick', 'fx-kick:default'), 'g-unused': playGraph('fx-other', 'fx-other:default') },
      graphNames: { 'g-kick': 'Kick', 'g-unused': 'Unused' },
      effects: [effect('fx-kick'), effect('fx-other')],
      presets: [preset('fx-kick:default', 'fx-kick'), preset('fx-other:default', 'fx-other')],
    });

    const closure = extractSongClosure(song, src, 'lib-1');
    const ns = songNamespace('lib-1');

    // Only the reached graph is carried, re-keyed.
    expect(Object.keys(closure.graphs)).toEqual([`${ns}g-kick`]);
    expect(closure.graphNames).toEqual({ [`${ns}g-kick`]: 'Kick' });
    // Only the reached effect + preset — the unused ones are absent.
    expect(closure.effects.map((e) => e.id)).toEqual([`${ns}fx-kick`]);
    expect(closure.presets.map((p) => p.id)).toEqual([`${ns}fx-kick:default`]);
  });

  it('re-keys every internal reference consistently (section→graph, node→effect/preset, preset→effect)', () => {
    const song = makeSong('song-1', 'Intro', [makeSection('song-1-s1', 'A', ['g-kick'])]);
    const src = sources({
      graphs: { 'g-kick': playGraph('fx-kick', 'fx-kick:default') },
      graphNames: { 'g-kick': 'Kick' },
      effects: [effect('fx-kick')],
      presets: [preset('fx-kick:default', 'fx-kick')],
    });

    const closure = extractSongClosure(song, src, 'lib-1');
    const ns = songNamespace('lib-1');

    // section graph ref + id namespaced
    expect(closure.sections[0]!.id).toBe(`${ns}song-1-s1`);
    expect(closure.sections[0]!.graphs).toEqual([`${ns}g-kick`]);
    // play node's effect + preset refs namespaced
    const play = closure.graphs[`${ns}g-kick`]!.nodes.find((n) => n.kind === 'play')!;
    expect(play.effectId).toBe(`${ns}fx-kick`);
    expect(play.presetId).toBe(`${ns}fx-kick:default`);
    // preset → effect back-reference namespaced too
    expect(closure.presets[0]!.effectId).toBe(`${ns}fx-kick`);
    // every section.graphs entry resolves to an included graph (internal consistency)
    for (const sec of closure.sections) for (const k of sec.graphs) expect(closure.graphs[k]).toBeDefined();
  });

  it('collision-free: two songs extracted into different namespaces never share a key', () => {
    const g = playGraph('fx', 'fx:default');
    const src = sources({ graphs: { g }, graphNames: { g: 'G' }, effects: [effect('fx')], presets: [preset('fx:default', 'fx')] });
    const songA = makeSong('song-a', 'A', [makeSection('s1', 'A', ['g'])]);
    const songB = makeSong('song-b', 'B', [makeSection('s1', 'B', ['g'])]);

    const a = extractSongClosure(songA, src, 'lib-a');
    const b = extractSongClosure(songB, src, 'lib-b');

    const overlap = Object.keys(a.graphs).filter((k) => k in b.graphs);
    expect(overlap).toEqual([]);
    expect(a.effects.map((e) => e.id)).not.toEqual(b.effects.map((e) => e.id));
    // same source section id 's1' → disjoint after namespacing
    expect(a.sections[0]!.id).not.toBe(b.sections[0]!.id);
  });
});

describe('extractSongClosure — modulation / modifier nodes', () => {
  it('play node pulls its effect+preset; modifier/lfo/cc/envelope nodes pull nothing', () => {
    const song = makeSong('song-1', 'Mod', [makeSection('s1', 'A', ['g-mod'])]);
    const src = sources({
      graphs: { 'g-mod': modulatedGraph() },
      effects: [effect('fx-mod')],
      presets: [preset('fx-mod:default', 'fx-mod')],
    });

    const closure = extractSongClosure(song, src, 'lib-1');
    const ns = songNamespace('lib-1');

    expect(closure.effects.map((e) => e.id)).toEqual([`${ns}fx-mod`]);
    expect(closure.presets.map((p) => p.id)).toEqual([`${ns}fx-mod:default`]);

    const g = closure.graphs[`${ns}g-mod`]!;
    // modifier id is a global registry id — NOT namespaced
    const mod = g.nodes.find((n) => n.kind === 'modifier')!;
    expect(mod.modifierId).toBe('invert');
    expect(mod.effectId).toBe(''); // empty ids stay empty (not prefixed to `lib:…/`)
    // modulation-source nodes carry no effect/preset ref
    for (const kind of ['lfo', 'cc', 'envelope'] as const) {
      const n = g.nodes.find((x) => x.kind === kind)!;
      expect(n.effectId).toBe('');
      expect(n.presetId).toBe('');
    }
    // all modulation edges (param: / mod) preserved
    expect(g.edges).toHaveLength(5);
  });
});

describe('extractSongClosure — section looks', () => {
  it('a look reaches its effect AND that effect’s `:default` preset (look seed params)', () => {
    const song: Song = {
      id: 'song-1',
      name: 'Looks',
      sections: [makeSection('s1', 'A', [], { base: 'fx-wash', trigger: null })],
    };
    const src = sources({
      effects: [effect('fx-wash')],
      presets: [preset('fx-wash:default', 'fx-wash')],
    });

    const closure = extractSongClosure(song, src, 'lib-1');
    const ns = songNamespace('lib-1');

    expect(closure.effects.map((e) => e.id)).toEqual([`${ns}fx-wash`]);
    expect(closure.presets.map((p) => p.id)).toEqual([`${ns}fx-wash:default`]);
    // look value namespaced; null look passes through; busId key unchanged (show-level)
    expect(closure.sections[0]!.looks).toEqual({ base: `${ns}fx-wash`, trigger: null });
  });
});

describe('extractSongClosure — defensive', () => {
  it('drops dangling graph refs and dangling effect/preset defs', () => {
    const song = makeSong('song-1', 'D', [makeSection('s1', 'A', ['g-real', 'g-missing'])]);
    const src = sources({
      graphs: { 'g-real': playGraph('fx-real', 'fx-missing') }, // presetId refers to an absent preset
      effects: [effect('fx-real')],
      presets: [], // no preset def present
    });

    const closure = extractSongClosure(song, src, 'lib-1');
    const ns = songNamespace('lib-1');

    // missing graph ref dropped; only the real one survives (and is included)
    expect(closure.sections[0]!.graphs).toEqual([`${ns}g-real`]);
    expect(Object.keys(closure.graphs)).toEqual([`${ns}g-real`]);
    // dangling preset ref carries no def, but the node's ref is still namespaced (faithful to source)
    expect(closure.presets).toEqual([]);
    const play = closure.graphs[`${ns}g-real`]!.nodes.find((n) => n.kind === 'play')!;
    expect(play.presetId).toBe(`${ns}fx-missing`);
  });

  it('is self-contained: mutating the source after extraction never touches the closure', () => {
    const g = playGraph('fx', 'fx:default');
    const src = sources({
      graphs: { g },
      effects: [effect('fx')],
      presets: [preset('fx:default', 'fx')],
    });
    const song = makeSong('song-1', 'Iso', [makeSection('s1', 'A', ['g'])]);
    const closure = extractSongClosure(song, src, 'lib-1');
    const before = structuredClone(closure);

    // Mutate the source show's live objects that a shallow copy would alias.
    const srcPlay = src.graphs.g!.nodes.find((n) => n.kind === 'play')!;
    srcPlay.params.hue = 0.99;
    srcPlay.bands.push(0.123);
    (src.effects[0]!.params as unknown[]).push({ key: 'injected' });
    src.presets[0]!.params.injected = 1;

    expect(closure).toEqual(before); // closure is unchanged — nothing was aliased
  });

  it('is deterministic — same inputs yield an identical closure', () => {
    const song = makeSong('song-1', 'Det', [makeSection('s1', 'A', ['g'])]);
    const src = sources({ graphs: { g: playGraph('fx', 'fx:default') }, effects: [effect('fx')], presets: [preset('fx:default', 'fx')] });
    expect(extractSongClosure(song, src, 'lib-1')).toEqual(extractSongClosure(song, src, 'lib-1'));
  });
});
