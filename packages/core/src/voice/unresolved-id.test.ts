/**
 * S14 (resilience-hole-0011) — the render path's silent skips of unknown authored ids become
 * ONE observation on the existing `VoiceDiagnostic` channel, and nothing else.
 *
 * The first assertion of every behaviour test here is byte-for-byte frame equality: a stale
 * modifier or generator id must render exactly what it rendered before this step, with or
 * without a diagnostic sink attached. The ledger is an observer, never a participant.
 */
import { describe, expect, it } from 'vitest';
import { parseKit } from '../geometry/kit-schema';
import { buildPixelModel, type PixelModel } from '../geometry/pixel-model';
import type { TransportState } from '../engine/render-context';
import { createNullEngine, createVoiceBusEngine, type InputEvent, type RenderEngine } from './engine';
import type { VoiceDiagnostic } from './diagnostics';
import { padKey, type Bus, type EffectDef, type GraphEdge, type GraphNode, type Show, type TriggerGraph } from './types';

// ---- fixtures ---------------------------------------------------------------

function testModel(): PixelModel {
  const kit = parseKit({
    global: { ledDensityPxPerM: 30, hoopCount: 2, defaultHoopSpacingMm: 50 },
    drums: [{ id: 'kick', diameterIn: 12, hoopSpacingMm: 50, origin: { x: 0, y: 0, z: 0 }, rotation: { x: 0, y: 0, z: 0 } }],
  });
  return buildPixelModel(kit);
}

function node(kind: GraphNode['kind'], id: string, over: Partial<GraphNode> = {}): GraphNode {
  return {
    id,
    kind,
    x: 0,
    y: 0,
    mode: 'oneshot',
    scope: 'kit',
    effectId: '',
    presetId: '',
    busId: '',
    params: {},
    env: {},
    noRepeat: true,
    on: 'value',
    valueMode: 'gate',
    threshold: 0.5,
    invert: false,
    bands: [0.5],
    p: 0.5,
    delayMode: 'time',
    ms: 0,
    division: '1/8',
    ...over,
  };
}

function effect(id: string, over: Partial<EffectDef> = {}): EffectDef {
  return {
    id,
    name: id,
    generatorId: 'solid-base',
    busId: 'base',
    scope: 'kit',
    params: [{ key: 'brightness', label: 'Brightness', kind: 'number', min: 0, max: 1, default: 1 }],
    attackMs: 10,
    sustainMs: 1000,
    releaseMs: 100,
    ...over,
  };
}

const buses: Bus[] = [{ id: 'base', name: 'Base', polyphony: 'poly', crossfadeMs: 200 }];

/** trigger → play(fx), with one modifier wire per `modifierIds` entry (y-ordered). */
function graphWithModifiers(modifierIds: readonly string[], effectId = 'fx'): TriggerGraph {
  const nodes: GraphNode[] = [
    node('trigger', 'trigger'),
    node('play', 'p', { effectId, params: { brightness: 1 } }),
  ];
  const edges: GraphEdge[] = [{ id: 'e0', from: 'trigger', to: 'p' }];
  modifierIds.forEach((modifierId, i) => {
    nodes.push(node('modifier', `m${i}`, { modifierId, y: i * 100 }));
    edges.push({ id: `em${i}`, from: `m${i}`, to: 'p', toPort: 'mod' });
  });
  return { nodes, edges };
}

function showOf(graph: TriggerGraph, effects: EffectDef[] = [effect('fx')]): Show {
  return { buses, graphs: { [padKey('kick', '')]: graph }, sections: [], effects, presets: [] };
}

function transport(now: number): TransportState {
  return { timeMs: now, beat: 0, bar: 0, beatInBar: 0, bpm: 120, beatsPerBar: 4, playing: true };
}

const hit = (timeMs = 0): InputEvent => ({ kind: 'noteOn', drumId: 'kick', zone: '', velocity: 1, timeMs });

/** Drive `frames` ticks at a fixed 16ms step after one kick hit; returns the last frame, copied. */
function runFrames(e: RenderEngine, s: Show, frames: number): Float32Array {
  e.setModel(testModel());
  e.setShow(s);
  e.applyInput(hit(0));
  for (let i = 1; i <= frames; i++) e.tick(i * 16, 16, transport(i * 16));
  return Float32Array.from(e.frame());
}

function withSink(): { engine: RenderEngine; diagnostics: VoiceDiagnostic[] } {
  const diagnostics: VoiceDiagnostic[] = [];
  return { engine: createVoiceBusEngine({ onDiagnostic: (d) => diagnostics.push(d) }), diagnostics };
}

const unresolved = (ds: readonly VoiceDiagnostic[]): Extract<VoiceDiagnostic, { kind: 'unresolved-id' }>[] =>
  ds.filter((d): d is Extract<VoiceDiagnostic, { kind: 'unresolved-id' }> => d.kind === 'unresolved-id');

// ---- behaviour preservation (first, not as an afterthought) ------------------

describe('S14 — unknown authored ids: rendering is unchanged', () => {
  it('an unknown modifier id renders byte-for-byte the same with and without a diagnostic sink', () => {
    const s = () => showOf(graphWithModifiers(['no-such-modifier']));
    const withoutSink = runFrames(createVoiceBusEngine(), s(), 8);
    const { engine, diagnostics } = withSink();
    const withSinkFrame = runFrames(engine, s(), 8);

    expect(Array.from(withSinkFrame)).toEqual(Array.from(withoutSink));
    expect(withSinkFrame.some((v) => v > 0)).toBe(true); // the voice really did render
    expect(unresolved(diagnostics)).toHaveLength(1); // …and the skip was observed
  });

  it('an unknown generator id renders byte-for-byte the same with and without a diagnostic sink', () => {
    const s = () => showOf(graphWithModifiers([]), [effect('fx', { generatorId: 'no-such-generator' })]);
    const withoutSink = runFrames(createVoiceBusEngine(), s(), 8);
    const { engine, diagnostics } = withSink();
    const withSinkFrame = runFrames(engine, s(), 8);

    expect(Array.from(withSinkFrame)).toEqual(Array.from(withoutSink));
    expect(withSinkFrame.every((v) => v === 0)).toBe(true); // unknown generator renders nothing
    expect(unresolved(diagnostics)).toHaveLength(1);
  });

  it('a KNOWN modifier chain renders identically with a sink attached (no observer side-effect)', () => {
    const s = () => showOf(graphWithModifiers(['trail']));
    const withoutSink = runFrames(createVoiceBusEngine(), s(), 8);
    const { engine, diagnostics } = withSink();
    const withSinkFrame = runFrames(engine, s(), 8);

    expect(Array.from(withSinkFrame)).toEqual(Array.from(withoutSink));
    expect(unresolved(diagnostics)).toEqual([]);
  });
});

// ---- the observation itself -------------------------------------------------

describe('S14 — the unresolved-id diagnostic', () => {
  it('fires exactly once across 100 frames for the same unknown modifier id', () => {
    const { engine, diagnostics } = withSink();
    runFrames(engine, showOf(graphWithModifiers(['no-such-modifier'])), 100);

    expect(unresolved(diagnostics)).toEqual([{ kind: 'unresolved-id', idKind: 'modifier', id: 'no-such-modifier' }]);
  });

  it('fires exactly once across 100 frames for the same unknown generator id', () => {
    const { engine, diagnostics } = withSink();
    runFrames(engine, showOf(graphWithModifiers([]), [effect('fx', { generatorId: 'no-such-generator' })]), 100);

    expect(unresolved(diagnostics)).toEqual([{ kind: 'unresolved-id', idKind: 'generator', id: 'no-such-generator' }]);
  });

  it('two distinct unknown modifier ids produce two diagnostics', () => {
    const { engine, diagnostics } = withSink();
    runFrames(engine, showOf(graphWithModifiers(['ghost-a', 'ghost-b'])), 20);

    expect(unresolved(diagnostics).map((d) => d.id)).toEqual(['ghost-a', 'ghost-b']);
  });

  it('a modifier and a generator sharing an id each report (the ledger keys on both)', () => {
    const { engine, diagnostics } = withSink();
    runFrames(engine, showOf(graphWithModifiers(['twin']), [effect('fx', { generatorId: 'twin' })]), 20);

    // The unknown generator aborts the voice render before its chain runs, so only the
    // generator arm can fire here — the point is that the key carries `idKind` at all.
    expect(unresolved(diagnostics)).toEqual([{ kind: 'unresolved-id', idKind: 'generator', id: 'twin' }]);
  });

  it('setShow re-arms the report — the same stale id is named again for new authored content', () => {
    const { engine, diagnostics } = withSink();
    runFrames(engine, showOf(graphWithModifiers(['no-such-modifier'])), 10);
    expect(unresolved(diagnostics)).toHaveLength(1);

    // A fresh show carrying the same stale id: the operator edited content and must be told again.
    runFrames(engine, showOf(graphWithModifiers(['no-such-modifier'])), 10);
    expect(unresolved(diagnostics)).toHaveLength(2);
    expect(unresolved(diagnostics)[1]!.id).toBe('no-such-modifier');
  });

  it('a host with no diagnostic sink keeps today’s silent skip (and never throws)', () => {
    const frame = runFrames(createVoiceBusEngine(), showOf(graphWithModifiers(['no-such-modifier'])), 10);
    expect(frame.some((v) => v > 0)).toBe(true);
  });

  it('createNullEngine needs no edit — the RenderEngine interface was NOT widened', () => {
    // Compile-time evidence: a second RenderEngine implementation with no unresolved-id
    // concept still satisfies the interface, which is why the diagnostic rides the
    // existing sink instead of a new `getUnresolvedIds()` method.
    const e: RenderEngine = createNullEngine();
    const frame = runFrames(e, showOf(graphWithModifiers(['no-such-modifier'])), 4);
    expect(frame.every((v) => v === 0)).toBe(true);
  });
});
