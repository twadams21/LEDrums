import { describe, it, expect } from 'vitest';
import { effectChain, type CanvasScene } from '@ledrums/core';
import {
  buildSectionClipDoc,
  buildSongClipDoc,
  buildPatchClipDoc,
  serialize,
  parse,
  isClipParseError,
  remapClipDoc,
  type ClipDoc,
  type RemapContext,
  type RemapMint,
  type RemapResult,
  type PatchPayload,
} from './clipdoc';
import type { SetlistSection, Song } from '../app/setlist';

/* ClipDoc section / song / patch kinds (the Effect-chain effect / cell / device kinds are covered
   in clipdoc.effects.test.ts). A section / song payload carries its Effect stacks and Master chains
   inline; its only reusable dependency is the authored canvas scenes its Scene Generators play. */

const scene = (id: string, name = id): CanvasScene => ({ id, name, sampler: { kind: 'cylinder' }, lenses: [], elements: [] });

const kick: effectChain.EffectCell = { row: 'kick', column: { kind: 'zone', slot: 0 } };

function solid(id: string): effectChain.Effect {
  return effectChain.parseEffect({ id, name: id, cell: kick, generator: { kind: 'solid' } });
}

function sceneEffect(id: string, sceneId: string): effectChain.Effect {
  return effectChain.parseEffect({ id, name: id, cell: { row: 'kit', column: { kind: 'always' } }, generator: { kind: 'scene', params: { sceneId } } });
}

function section(id: string, effects: effectChain.Effect[] = [solid(`${id}-fx`)]): SetlistSection {
  return { id, name: id.toUpperCase(), effects, master: [{ uid: `${id}-m`, modifierId: 'strobe', params: {}, mix: 1, bypass: false }], bars: 8 };
}

function testMint(): RemapMint {
  let s = 0;
  let so = 0;
  let sc = 0;
  return { section: () => `ts-${++s}`, song: () => `tso-${++so}`, scene: () => `tsc-${++sc}` };
}

function ctx(over: Partial<RemapContext> = {}): RemapContext {
  return { canvasScenes: [], sectionIds: [], mint: testMint(), ...over };
}

function remapped(doc: ClipDoc, c: RemapContext = ctx()): RemapResult {
  const r = remapClipDoc(doc, c);
  if (isClipParseError(r)) throw new Error(`unexpected parse error: ${r.message}`);
  return r;
}

// ---- serialize / parse round-trip -------------------------------------------

describe('serialize / parse round-trip', () => {
  it('section kind round-trips its Effect stack, Master chain and timing', () => {
    const doc = buildSectionClipDoc(section('verse'), {});
    const back = parse(serialize(doc));
    expect(back).toEqual(doc);
    if (!isClipParseError(back) && back.kind === 'section') expect(back.payload.section.bars).toBe(8);
  });

  it('song kind round-trips', () => {
    const song: Song = { id: 'song-1', name: 'Opener', sections: [section('a'), section('b')] };
    const doc = buildSongClipDoc(song, {});
    expect(parse(serialize(doc))).toEqual(doc);
  });

  it('patch kind round-trips', () => {
    const patch = { kit: { drums: [] }, inputMap: {}, output: {} } as unknown as PatchPayload;
    const doc = buildPatchClipDoc(patch);
    expect(parse(serialize(doc))).toEqual(doc);
  });

  it('carries only the authored scenes the Effects play (a built-in or unused scene stays behind)', () => {
    const sec = section('verse', [sceneEffect('a', 'mine'), sceneEffect('b', 'builtin-sky')]);
    const doc = buildSectionClipDoc(sec, { canvasScenes: [scene('mine'), scene('unused')] });
    expect(doc.deps.canvasScenes?.map((s) => s.id)).toEqual(['mine']);
  });

  it('never aliases the source section', () => {
    const sec = section('verse');
    const doc = buildSectionClipDoc(sec, {});
    doc.payload.section.effects[0]!.name = 'mutated';
    expect(sec.effects[0]!.name).toBe('verse-fx');
  });
});

// ---- defensive parse (never throws) -----------------------------------------

describe('parse — defensive, never throws', () => {
  const cases: Array<[string, string, string]> = [
    ['non-JSON text', 'copy me maybe', 'not-json'],
    ['a JSON primitive', '"hello"', 'not-object'],
    ['a JSON array', '[1,2,3]', 'not-object'],
    ['foreign app payload', JSON.stringify({ app: 'other', v: 1, kind: 'song', payload: {} }), 'foreign'],
    ['a future version', JSON.stringify({ app: 'ledrums', v: 3, kind: 'song', payload: {} }), 'unsupported-version'],
    ['an unknown kind', JSON.stringify({ app: 'ledrums', v: 1, kind: 'banana', payload: {} }), 'unknown-kind'],
    ['a retired graph kind', JSON.stringify({ app: 'ledrums', v: 2, kind: 'graph', payload: { key: 'g', graph: { nodes: [], edges: [] } } }), 'unknown-kind'],
    ['a retired node kind', JSON.stringify({ app: 'ledrums', v: 2, kind: 'node', payload: { node: { id: 'n', kind: 'effect' } } }), 'unknown-kind'],
    ['a missing payload', JSON.stringify({ app: 'ledrums', v: 1, kind: 'song' }), 'malformed'],
    ['a section without an id', JSON.stringify({ app: 'ledrums', v: 2, kind: 'section', payload: { section: { name: 'x' } } }), 'malformed'],
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
    const doc = buildSectionClipDoc(section('verse'), {}) as unknown as Record<string, unknown>;
    const withExtra = { ...doc, futureField: 42, meta: { ...(doc.meta as object), somethingNew: true } };
    const back = parse(JSON.stringify(withExtra));
    expect(isClipParseError(back)).toBe(false);
    if (!isClipParseError(back)) expect(back.kind).toBe('section');
  });

  it('drops malformed sections inside a song rather than failing the whole doc', () => {
    const song = { id: 'song-1', name: 'S', sections: [{ id: 's-ok', name: 'ok' }, 42, { name: 'no-id' }] };
    const raw = { app: 'ledrums', v: 1, kind: 'song', payload: { song }, deps: {}, meta: { exportedAt: '' } };
    const back = parse(JSON.stringify(raw));
    expect(isClipParseError(back)).toBe(false);
    if (!isClipParseError(back) && back.kind === 'song') expect(back.payload.song.sections.map((s) => s.id)).toEqual(['s-ok']);
  });

  it('keeps the valid Effects of a section and drops an invalid or duplicate one', () => {
    const raw = {
      app: 'ledrums', v: 2, kind: 'section',
      payload: { section: { id: 's', name: 'S', effects: [solid('a'), { id: 'bad', cell: { row: 'kit', column: { kind: 'nope' } } }, solid('a')], master: [{ junk: true }] } },
      deps: {}, meta: {},
    };
    const back = parse(JSON.stringify(raw));
    if (isClipParseError(back) || back.kind !== 'section') throw new Error('expected a section doc');
    expect(back.payload.section.effects.map((e) => e.id)).toEqual(['a']);
    expect(back.payload.section.master).toEqual([]);
  });

  it('reads a graph-era section (graph keys, no Effects) as an empty section', () => {
    const raw = { app: 'ledrums', v: 1, kind: 'section', payload: { section: { id: 's', name: 'Old', graphs: ['g-1'], looks: { base: 'x' } } }, deps: { graphs: {} }, meta: {} };
    const back = parse(JSON.stringify(raw));
    expect(isClipParseError(back)).toBe(false);
    if (!isClipParseError(back) && back.kind === 'section') expect(back.payload.section).toEqual({ id: 's', name: 'Old', effects: [], master: [] });
  });
});

// ---- remap on materialize ---------------------------------------------------

describe('remapClipDoc — sections and songs', () => {
  it('a section gets a fresh id; its Effects, Master chain and timing travel verbatim', () => {
    const sec = section('verse');
    const r = remapped(buildSectionClipDoc(sec, {}));
    expect(r.kind).toBe('section');
    expect(r.section).toEqual({ ...sec, id: 'ts-1' });
    expect(r.canvasScenes).toEqual([]);
  });

  it('a song gets a fresh song id and a fresh id per section', () => {
    const song: Song = { id: 'song-1', name: 'Opener', sections: [section('a'), section('b')] };
    const r = remapped(buildSongClipDoc(song, {}));
    expect(r.song!.id).toBe('tso-1');
    expect(r.song!.name).toBe('Opener');
    expect(r.song!.sections.map((s) => s.id)).toEqual(['ts-1', 'ts-2']);
    expect(r.song!.sections.map((s) => s.effects)).toEqual(song.sections.map((s) => s.effects));
  });

  it('the default minter skips section ids the destination already has', () => {
    const r = remapClipDoc(buildSectionClipDoc(section('verse'), {}), { sectionIds: ['section-1', 'section-2'] });
    if (isClipParseError(r)) throw new Error(r.message);
    expect(['section-1', 'section-2']).not.toContain(r.section!.id);
  });

  it('a scene new to the show gets a fresh id and every Scene Generator follows it', () => {
    const sec = section('verse', [sceneEffect('a', 'mine'), sceneEffect('b', 'builtin-sky')]);
    const r = remapped(buildSectionClipDoc(sec, { canvasScenes: [scene('mine', 'Aurora')] }));
    expect(r.canvasScenes).toEqual([{ ...scene('mine', 'Aurora'), id: 'tsc-1' }]);
    expect(r.section!.effects.map((e) => e.generator.params.sceneId)).toEqual(['tsc-1', 'builtin-sky']);
  });

  it('a scene whose content matches a local one reuses its id — A→B→A adds no duplicate', () => {
    const sec = section('verse', [sceneEffect('a', 'mine')]);
    const local = { ...scene('mine', 'Aurora'), id: 'local-7' };
    const r = remapped(buildSectionClipDoc(sec, { canvasScenes: [scene('mine', 'Aurora')] }), ctx({ canvasScenes: [local] }));
    expect(r.canvasScenes).toEqual([]);
    expect(r.section!.effects[0]!.generator.params.sceneId).toBe('local-7');
  });

  it('returns a typed error for the patch kind', () => {
    const doc = buildPatchClipDoc({ kit: { drums: [] }, inputMap: {}, output: {} } as unknown as PatchPayload);
    const r = remapClipDoc(doc as ClipDoc, ctx());
    expect(isClipParseError(r)).toBe(true);
  });
});
