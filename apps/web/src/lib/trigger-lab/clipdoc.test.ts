import { describe, it, expect } from 'vitest';
import {
  buildGraphClipDoc,
  buildSectionClipDoc,
  buildSongClipDoc,
  buildPatchClipDoc,
  serialize,
  parse,
  isClipParseError,
  remapClipDoc,
  type ClipDoc,
  type RemapContext,
  type RemapResult,
  type PatchPayload,
} from './clipdoc';
import { extractSongClosure, songNamespace, type ClosureSources } from './store/song-library';
import { makeNode } from './sim.graph-compilation';
import type { EffectDef, Preset, TriggerGraph } from './sim';
import { makeSection, makeSong, type SetlistSection, type Song } from '../app/setlist';

// ---- fixtures (mirror store/song-library.test.ts) ---------------------------

const effect = (id: string, over: Partial<EffectDef> = {}): EffectDef => ({
  id,
  name: id,
  busId: 'base',
  scope: 'kit',
  params: [],
  attackMs: 0,
  sustainMs: 0,
  releaseMs: 0,
  ...over,
});

const preset = (id: string, effectId: string, params: Record<string, number> = {}): Preset => ({ id, name: id, effectId, params });

const playGraph = (effectId: string, presetId: string): TriggerGraph => ({
  nodes: [
    makeNode('trigger', 'trigger', 0, 0),
    makeNode('play', 'p1', 0, 0, { kind: 'play', effectId, presetId, params: { hue: 0.5 } }),
  ],
  edges: [{ id: 'e1', from: 'trigger', to: 'p1' }],
});

/** Graph with modulation + modifier nodes — a play node fed by LFO/CC/envelope via `param:`
    edges and routed through a modifier (matches the S40 modulatedGraph fixture). */
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
  return { graphs: {}, graphNames: {}, effects: [], presets: [], ...over };
}

/** A local show the paste reconciles against; nothing built-in unless the id is 'swirl'. */
function ctx(over: Partial<RemapContext> = {}): RemapContext {
  return {
    graphs: {},
    effects: [],
    presets: [],
    isBuiltInEffectId: (id) => id === 'swirl',
    ...over,
  };
}

/** Merge a paste result into a show context (what the store does on apply) — for double-paste /
    round-trip tests. */
function apply(base: RemapContext, r: RemapResult): RemapContext {
  return {
    ...base,
    graphs: { ...base.graphs, ...r.graphs },
    effects: [...base.effects, ...r.effects],
    presets: [...base.presets, ...r.presets],
  };
}

// ---- serialize / parse round-trip -------------------------------------------

describe('serialize / parse round-trip', () => {
  const src = sources({
    graphs: { 'g-kick': playGraph('fx-kick', 'fx-kick:default') },
    graphNames: { 'g-kick': 'Kick' },
    effects: [effect('fx-kick')],
    presets: [preset('fx-kick:default', 'fx-kick')],
  });

  it('graph kind round-trips', () => {
    const doc = buildGraphClipDoc('g-kick', src);
    const back = parse(serialize(doc));
    expect(isClipParseError(back)).toBe(false);
    expect(back).toEqual(doc);
  });

  it('section kind round-trips', () => {
    const section = makeSection('s1', 'A', ['g-kick'], { base: 'fx-kick', trigger: null });
    const doc = buildSectionClipDoc(section, src);
    expect(parse(serialize(doc))).toEqual(doc);
  });

  it('song kind round-trips', () => {
    const song = makeSong('song-1', 'Intro', [makeSection('song-1-s1', 'A', ['g-kick'])]);
    const doc = buildSongClipDoc(song, src);
    expect(parse(serialize(doc))).toEqual(doc);
  });

  it('patch kind round-trips', () => {
    const patch = { kit: { drums: [] }, inputMap: {}, output: {} } as unknown as PatchPayload;
    const doc = buildPatchClipDoc(patch);
    expect(parse(serialize(doc))).toEqual(doc);
  });
});

// ---- defensive parse (never throws) -----------------------------------------

describe('parse — defensive, never throws', () => {
  const cases: Array<[string, string, string]> = [
    ['non-JSON text', 'copy me maybe', 'not-json'],
    ['a JSON primitive', '"hello"', 'not-object'],
    ['a JSON array', '[1,2,3]', 'not-object'],
    ['foreign app payload', JSON.stringify({ app: 'other', v: 1, kind: 'song', payload: {} }), 'foreign'],
    ['a future version', JSON.stringify({ app: 'ledrums', v: 2, kind: 'song', payload: {} }), 'unsupported-version'],
    ['an unknown kind', JSON.stringify({ app: 'ledrums', v: 1, kind: 'banana', payload: {} }), 'unknown-kind'],
    ['a missing payload', JSON.stringify({ app: 'ledrums', v: 1, kind: 'song' }), 'malformed'],
    ['a malformed graph payload', JSON.stringify({ app: 'ledrums', v: 1, kind: 'graph', payload: { key: 'g' } }), 'malformed'],
    ['a patch without a kit', JSON.stringify({ app: 'ledrums', v: 1, kind: 'patch', payload: { patch: {} } }), 'malformed'],
  ];

  for (const [label, text, reason] of cases) {
    it(`returns a typed error for ${label} (never throws)`, () => {
      let result: ReturnType<typeof parse>;
      expect(() => (result = parse(text))).not.toThrow();
      expect(isClipParseError(result!)).toBe(true);
      if (isClipParseError(result!)) expect(result.reason).toBe(reason);
    });
  }

  it('tolerates unknown extra fields on a valid doc', () => {
    const src = sources({ graphs: { g: playGraph('fx', 'fx:default') }, effects: [effect('fx')], presets: [preset('fx:default', 'fx')] });
    const doc = buildGraphClipDoc('g', src) as unknown as Record<string, unknown>;
    const withExtra = { ...doc, futureField: 42, meta: { ...(doc.meta as object), somethingNew: true } };
    const back = parse(JSON.stringify(withExtra));
    expect(isClipParseError(back)).toBe(false);
    if (!isClipParseError(back)) expect(back.kind).toBe('graph');
  });

  it('drops malformed sections inside a song rather than failing the whole doc', () => {
    const song = { id: 'song-1', name: 'S', sections: [{ id: 's-ok', name: 'ok', graphs: [], looks: {} }, 42, { name: 'no-id' }] };
    const raw = { app: 'ledrums', v: 1, kind: 'song', payload: { song }, deps: {}, meta: { exportedAt: '' } };
    const back = parse(JSON.stringify(raw));
    expect(isClipParseError(back)).toBe(false);
    if (!isClipParseError(back) && back.kind === 'song') expect(back.payload.song.sections.map((s) => s.id)).toEqual(['s-ok']);
  });
});

// ---- closure equivalence with the S40 extraction (shared code) --------------

describe('closure equivalence with extractSongClosure (shared code)', () => {
  it('a song ClipDoc carries exactly the S40 closure (modulo namespacing)', () => {
    const song = makeSong('song-1', 'Intro', [makeSection('song-1-s1', 'A', ['g-kick', 'g-snare'])]);
    const src = sources({
      graphs: { 'g-kick': playGraph('fx-kick', 'fx-kick:default'), 'g-snare': playGraph('fx-snare', 'fx-snare:default') },
      graphNames: { 'g-kick': 'Kick', 'g-snare': 'Snare' },
      effects: [effect('fx-kick'), effect('fx-snare')],
      presets: [preset('fx-kick:default', 'fx-kick'), preset('fx-snare:default', 'fx-snare')],
    });

    const doc = buildSongClipDoc(song, src);
    const closure = extractSongClosure(song, src, 'lib-1');
    const ns = songNamespace('lib-1');
    const strip = (id: string) => (id.startsWith(ns) ? id.slice(ns.length) : id);

    // Same reached graphs / effects / presets, byte-for-byte after stripping the S40 namespace.
    expect(Object.keys(doc.deps.graphs ?? {}).sort()).toEqual(Object.keys(closure.graphs).map(strip).sort());
    expect((doc.deps.effects ?? []).map((e) => e.id).sort()).toEqual(closure.effects.map((e) => strip(e.id)).sort());
    expect((doc.deps.presets ?? []).map((p) => p.id).sort()).toEqual(closure.presets.map((p) => strip(p.id)).sort());
    // The un-namespaced closure equals the source's raw ids (round-trippable).
    expect((doc.deps.effects ?? []).map((e) => e.id).sort()).toEqual(['fx-kick', 'fx-snare']);
  });
});

// ---- remap: re-key + ref rewrite --------------------------------------------

describe('remapClipDoc — re-key + ref rewrite', () => {
  it('pastes a graph into an empty show: fresh key + refs pointing at emitted effect/preset', () => {
    const src = sources({ graphs: { 'g-kick': playGraph('fx-kick', 'fx-kick:default') }, graphNames: { 'g-kick': 'Kick' }, effects: [effect('fx-kick')], presets: [preset('fx-kick:default', 'fx-kick')] });
    const doc = buildGraphClipDoc('g-kick', src);

    const r = remapClipDoc(doc, ctx());
    expect(isClipParseError(r)).toBe(false);
    if (isClipParseError(r)) return;

    expect(r.kind).toBe('graph');
    expect(r.effects).toHaveLength(1);
    expect(r.presets).toHaveLength(1); // the effect's :default preset rides along
    const newEff = r.effects[0]!.id;
    expect(r.graphKey).not.toBe('g-kick'); // the store-level graph key is freshly minted
    expect(r.presets[0]!.id).toBe(`${newEff}:default`); // default preset tracks its effect id
    expect(r.presets[0]!.effectId).toBe(newEff);

    // the materialized graph references the (possibly re-keyed) effect/preset
    const graph = r.graphs[r.graphKey!]!;
    const play = graph.nodes.find((n) => n.kind === 'play')!;
    expect(play.effectId).toBe(newEff);
    expect(play.presetId).toBe(`${newEff}:default`);
    expect(r.graphNames[r.graphKey!]).toBe('Kick');
  });

  it('modulation / modifier ports survive the remap (fixtures)', () => {
    const src = sources({ graphs: { 'g-mod': modulatedGraph() }, effects: [effect('fx-mod')], presets: [preset('fx-mod:default', 'fx-mod')] });
    const doc = buildGraphClipDoc('g-mod', src);

    const r = remapClipDoc(doc, ctx());
    if (isClipParseError(r)) throw new Error('unexpected parse error');
    const graph = r.graphs[r.graphKey!]!;

    // every edge preserved verbatim — from/to node ids + `mod` / `param:` handles intact
    expect(graph.edges).toEqual(modulatedGraph().edges);
    // modifier + modulation-source node ids preserved (edges still resolve)
    expect(graph.nodes.map((n) => n.id).sort()).toEqual(['c1', 'ev1', 'l1', 'm1', 'p1', 'trigger']);
    // modifierId is a global registry id — never re-keyed
    expect(graph.nodes.find((n) => n.kind === 'modifier')!.modifierId).toBe('invert');
    // modInputs (exposed param rows) travel verbatim
    expect(graph.nodes.find((n) => n.kind === 'play')!.modInputs).toEqual([{ param: 'hue' }]);
  });

  it('remaps a section: fresh id, graph refs + look effect ids rewritten', () => {
    const section = makeSection('s1', 'A', ['g-kick'], { base: 'fx-kick', trigger: null });
    const src = sources({ graphs: { 'g-kick': playGraph('fx-kick', 'fx-kick:default') }, graphNames: { 'g-kick': 'Kick' }, effects: [effect('fx-kick')], presets: [preset('fx-kick:default', 'fx-kick')] });
    const doc = buildSectionClipDoc(section, src);

    const r = remapClipDoc(doc, ctx());
    if (isClipParseError(r)) throw new Error('unexpected');
    const sec = r.section!;
    expect(sec.id).not.toBe('s1'); // fresh section id
    // the graph ref resolves to the emitted graph
    expect(Object.keys(r.graphs)).toEqual([sec.graphs[0]]);
    // look effect id rewritten to the emitted effect; null look preserved
    expect(sec.looks.base).toBe(r.effects[0]!.id);
    expect(sec.looks.trigger).toBeNull();
  });

  it('remaps a song: fresh song + section ids, closure emitted once', () => {
    const song = makeSong('song-1', 'Intro', [makeSection('song-1-s1', 'A', ['g-kick']), makeSection('song-1-s2', 'B', ['g-kick'])]);
    const src = sources({ graphs: { 'g-kick': playGraph('fx-kick', 'fx-kick:default') }, graphNames: { 'g-kick': 'Kick' }, effects: [effect('fx-kick')], presets: [preset('fx-kick:default', 'fx-kick')] });
    const doc = buildSongClipDoc(song, src);

    const r = remapClipDoc(doc, ctx());
    if (isClipParseError(r)) throw new Error('unexpected');
    const out = r.song!;
    expect(out.id).not.toBe('song-1');
    expect(out.sections.map((s) => s.id)).not.toContain('song-1-s1');
    // both sections reference the SAME single emitted graph (shared reference preserved)
    expect(Object.keys(r.graphs)).toHaveLength(1);
    expect(out.sections[0]!.graphs).toEqual(out.sections[1]!.graphs);
  });
});

// ---- remap: reuse semantics -------------------------------------------------

describe('remapClipDoc — content reuse', () => {
  it('reuses a dep whose content already exists locally (no duplicate)', () => {
    const src = sources({ graphs: { 'g-kick': playGraph('fx-kick', 'fx-kick:default') }, graphNames: { 'g-kick': 'Kick' }, effects: [effect('fx-kick')], presets: [preset('fx-kick:default', 'fx-kick')] });
    const doc = buildGraphClipDoc('g-kick', src);

    // First paste into an empty show → creates the closure.
    const empty = ctx();
    const first = remapClipDoc(doc, empty) as RemapResult;
    const show = apply(empty, first);

    // Second paste of the SAME doc → everything reused, nothing new.
    const second = remapClipDoc(doc, show) as RemapResult;
    expect(second.effects).toHaveLength(0);
    expect(second.presets).toHaveLength(0);
    expect(Object.keys(second.graphs)).toHaveLength(0);
    expect(second.graphKey).toBe(first.graphKey); // resolves to the existing graph
  });

  it('double-paste creates exactly one duplicate set', () => {
    const src = sources({ graphs: { 'g-kick': playGraph('fx-kick', 'fx-kick:default') }, effects: [effect('fx-kick')], presets: [preset('fx-kick:default', 'fx-kick')] });
    const doc = buildGraphClipDoc('g-kick', src);

    let show = ctx();
    const a = remapClipDoc(doc, show) as RemapResult;
    show = apply(show, a);
    const b = remapClipDoc(doc, show) as RemapResult;

    // Across the two pastes: one new graph + one new effect total (the second reused).
    const graphs = Object.keys(a.graphs).length + Object.keys(b.graphs).length;
    const effects = a.effects.length + b.effects.length;
    expect(graphs).toBe(1);
    expect(effects).toBe(1);
  });

  it('A→B→A round-trip creates no duplicate closure', () => {
    // Show A owns the original graph + effect.
    const graphA = playGraph('fx-kick', 'fx-kick:default');
    const showA = ctx({ graphs: { 'g-a': graphA }, effects: [effect('fx-kick')], presets: [preset('fx-kick:default', 'fx-kick')] });
    const srcA = sources({ graphs: { 'g-a': graphA }, graphNames: { 'g-a': 'Kick' }, effects: [effect('fx-kick')], presets: [preset('fx-kick:default', 'fx-kick')] });
    const docFromA = buildGraphClipDoc('g-a', srcA);

    // Paste into fresh show B → B mints its own ids.
    const showBempty = ctx();
    const intoB = remapClipDoc(docFromA, showBempty) as RemapResult;
    const showB = apply(showBempty, intoB);

    // Copy from B, paste back into A → A already has the content → reuse, no new closure.
    const bKey = intoB.graphKey!;
    const srcB = sources({ graphs: { [bKey]: showB.graphs[bKey]! }, graphNames: { [bKey]: 'Kick' }, effects: [...showB.effects], presets: [...showB.presets] });
    const docFromB = buildGraphClipDoc(bKey, srcB);
    const backIntoA = remapClipDoc(docFromB, showA) as RemapResult;

    expect(Object.keys(backIntoA.graphs)).toHaveLength(0);
    expect(backIntoA.effects).toHaveLength(0);
    expect(backIntoA.graphKey).toBe('g-a'); // resolves back to the original
  });

  it('re-keys a non-built-in effect that collides with different local content', () => {
    // Incoming user effect 'my-fx' (content X); local show has 'my-fx' with different content.
    const src = sources({ graphs: { g: playGraph('my-fx', 'my-fx:default') }, effects: [effect('my-fx', { attackMs: 10 })], presets: [preset('my-fx:default', 'my-fx')] });
    const doc = buildGraphClipDoc('g', src);
    const show = ctx({ effects: [effect('my-fx', { attackMs: 999 })], presets: [preset('my-fx:default', 'my-fx')] });

    const r = remapClipDoc(doc, show) as RemapResult;
    expect(r.effects).toHaveLength(1);
    const newEff = r.effects[0]!.id;
    expect(newEff).not.toBe('my-fx'); // collision → re-keyed
    expect(r.graphs[r.graphKey!]!.nodes.find((n) => n.kind === 'play')!.effectId).toBe(newEff);
    expect(r.presets[0]!.id).toBe(`${newEff}:default`);
  });

  it('mints DISTINCT ids for two same-name, different-content effects in one pass', () => {
    // A closure carrying two effects that share a display name but differ in id + content (a
    // rename-then-recreate produces this). Both must be freshly minted (they collide with the
    // local same-name effect below) to DISTINCT ids — the default effect minter is name-derived,
    // so it must dedup against ids already minted earlier in the same pass.
    const song = makeSong('song-1', 'Dup', [makeSection('s1', 'A', ['g-a', 'g-b'])]);
    const src = sources({
      graphs: { 'g-a': playGraph('fx-one', 'fx-one:default'), 'g-b': playGraph('fx-two', 'fx-two:default') },
      effects: [effect('fx-one', { name: 'Shared', attackMs: 1 }), effect('fx-two', { name: 'Shared', attackMs: 2 })],
      presets: [preset('fx-one:default', 'fx-one'), preset('fx-two:default', 'fx-two')],
    });
    const doc = buildSongClipDoc(song, src);
    // Local show has a same-name effect so both incoming ones must re-key (name-derived collision).
    const show = ctx({ effects: [effect('shared', { name: 'Shared', attackMs: 999 })], presets: [preset('shared:default', 'shared')] });

    const r = remapClipDoc(doc, show) as RemapResult;
    expect(r.effects).toHaveLength(2);
    const ids = r.effects.map((e) => e.id);
    expect(new Set(ids).size).toBe(2); // DISTINCT — no self-collision within the pass
    // each emitted graph's play node points at a real, distinct emitted effect
    const playEffs = Object.values(r.graphs).map((g) => g.nodes.find((n) => n.kind === 'play')!.effectId);
    expect(new Set(playEffs)).toEqual(new Set(ids));
    // default presets track their (distinct) effect ids
    expect(r.presets.map((p) => p.id).sort()).toEqual(ids.map((id) => `${id}:default`).sort());
  });

  it('never re-keys a built-in effect id, even when local content differs', () => {
    // Incoming doc references built-in 'swirl'; the local show has a DIFFERENT 'swirl' (renamed).
    const src = sources({ graphs: { g: playGraph('swirl', 'swirl:default') }, effects: [effect('swirl', { name: 'Swirl' })], presets: [preset('swirl:default', 'swirl')] });
    const doc = buildGraphClipDoc('g', src);
    const show = ctx({ effects: [effect('swirl', { name: 'Renamed Swirl' })], presets: [preset('swirl:default', 'swirl')] });

    const r = remapClipDoc(doc, show) as RemapResult;
    expect(r.effects).toHaveLength(0); // built-in kept, not emitted
    const graph = r.graphs[r.graphKey!]!;
    expect(graph.nodes.find((n) => n.kind === 'play')!.effectId).toBe('swirl'); // id preserved verbatim
  });
});

describe('remapClipDoc — patch is not remapped', () => {
  it('returns a typed error for the patch kind', () => {
    const doc = buildPatchClipDoc({ kit: { drums: [] }, inputMap: {}, output: {} } as unknown as PatchPayload);
    const r = remapClipDoc(doc as ClipDoc, ctx());
    expect(isClipParseError(r)).toBe(true);
  });
});
