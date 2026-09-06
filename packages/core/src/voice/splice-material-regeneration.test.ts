import { describe, expect, it } from 'vitest';
import { materialCycleMs } from '../effects/voice-life';
import type { EffectGenerator } from '../effects/types';
import { Framebuffer } from '../engine/framebuffer';
import type { RenderContext } from '../engine/render-context';
import { createGeneratorBridge } from './generator-bridge';
import { ensureGeometryState } from './geometry-state';
import { createRenderCheckpoint } from './render-checkpoint';
import { runtimeAction, runtimeBus, runtimeEffect, runtimeFrame, runtimeModel, runtimeVoice, runtimeSplice } from './runtime-test-fixtures';
import type { Voice } from './types';
import { deactivateVoice, VoicePool } from './voice-pool';

describe('splice material regeneration', () => {
  it('resolves the declared material life, not the voice tail factor', () => {
    expect(materialCycleMs('whole-drum', { decayMs: 220 }, 120)).toBe(220);
    expect(materialCycleMs('segments', { lifeBeats: 2 }, 120)).toBe(1000);
    expect(materialCycleMs('plasma', {}, 120)).toBe(0);
    expect(materialCycleMs('confetti-burst', { life: 0 }, 120)).toBe(100);
    expect(materialCycleMs('confetti-burst', { life: -1 }, 120)).toBe(100);
    expect(materialCycleMs('confetti-burst', { life: Number.NaN }, 120)).toBe(1200);
  });

  it('isolates every shared context field between mixed member and ordinary renders', () => {
    let firstContext: RenderContext | undefined;
    const first: EffectGenerator = {
      id: 'test-context-first', name: 'Test context first', category: 'texture',
      voiceLife: { key: 'life', unit: 'ms' },
      paramSpec: [{ key: 'life', label: 'Life', type: 'number', default: 100, min: 1, max: 1000 }],
      render(ctx, _params, fb): void {
        firstContext = ctx;
        fb.set(0, 1, 0, 0, 1);
      },
    };
    const second: EffectGenerator = {
      id: 'test-context-second', name: 'Test context second', category: 'texture', paramSpec: [],
      render(ctx, _params, fb): void { fb.set(0, ctx.timeMs / 1000, ctx.dt / 100, ctx.transport.beat, 1); },
    };
    const bridge = createGeneratorBridge((id) => ({
      [first.id]: first,
      [second.id]: second,
    }[id]));
    const model = runtimeModel([8]);
    const member = runtimeVoice({}, runtimeAction({ params: { life: 100 } }), first.id);
    const ordinary = runtimeVoice({}, runtimeAction(), second.id);
    member.materialCycleMs = 100;
    const dst = new Framebuffer(model.pixelCount);
    const frame = runtimeFrame(100, 50);
    bridge.beginFrame(model, frame.timeMs, frame.dt, frame.transport);
    bridge.renderVoice(member, model, frame.timeMs, 1, [{ start: 0, end: model.pixelCount }], dst, { phase: 0, timeMs: 100, bpm: 120 });
    dst.clear();
    bridge.renderVoice(ordinary, model, frame.timeMs, 1, [{ start: 0, end: model.pixelCount }], dst, { phase: 0, timeMs: 100, bpm: 120 });

    expect(firstContext).toMatchObject({ timeMs: 100, dt: 50, transport: frame.transport, authoredDecay: undefined });
    expect(firstContext!.triggers[0]).toEqual({ seq: 1, drumId: '', note: 0, velocity: 1, timeMs: 0, ageMs: 0 });
    expect(Array.from(dst.rgba.slice(0, 4))).toEqual([expect.closeTo(0.1, 5), 0.5, expect.closeTo(0.2, 5), 1]);
  });

  it('restores shared context fields when a generator throws', () => {
    let thrownContext: RenderContext | undefined;
    const broken: EffectGenerator = {
      id: 'test-context-throw', name: 'Test context throw', category: 'texture',
      voiceLife: { key: 'life', unit: 'ms' },
      paramSpec: [{ key: 'life', label: 'Life', type: 'number', default: 100, min: 1, max: 1000 }],
      render(ctx): void {
        thrownContext = ctx;
        const unsafe = ctx as unknown as {
          timeMs: number; dt: number; transport: { beat: number; timeMs: number };
          authoredDecay?: boolean; triggers: [{ seq: number; drumId: string; ageMs: number }];
        };
        unsafe.timeMs = -1;
        unsafe.dt = -2;
        unsafe.transport.beat = -3;
        unsafe.transport.timeMs = -4;
        unsafe.authoredDecay = true;
        unsafe.triggers[0]!.seq = 999;
        unsafe.triggers[0]!.drumId = 'leaked';
        unsafe.triggers[0]!.ageMs = 999;
        throw new Error('render failed');
      },
    };
    const bridge = createGeneratorBridge((id) => id === broken.id ? broken : undefined);
    const model = runtimeModel([8]);
    const voice = runtimeVoice({}, runtimeAction({ params: { life: 100 } }), broken.id);
    voice.materialCycleMs = 100;
    const frame = runtimeFrame(100, 50);
    bridge.beginFrame(model, frame.timeMs, frame.dt, frame.transport);
    expect(() => bridge.renderVoice(voice, model, frame.timeMs, 1, [{ start: 0, end: model.pixelCount }], new Framebuffer(model.pixelCount), { phase: 0, timeMs: 100, bpm: 120 })).toThrow('render failed');
    expect(thrownContext).toMatchObject({ timeMs: 100, dt: 50, transport: frame.transport, authoredDecay: undefined });
    expect(thrownContext!.triggers[0]).toEqual({ seq: 1, drumId: '', note: 0, velocity: 1, timeMs: 0, ageMs: 0 });
  });

  it('freezes adjacent outgoing material and renders one generator per boundary frame', () => {
    const calls: number[] = [];
    const generator: EffectGenerator = {
      id: 'test-frozen-output', name: 'Test frozen output', category: 'texture',
      voiceLife: { key: 'life', unit: 'ms' },
      paramSpec: [{ key: 'life', label: 'Life', type: 'number', default: 100, min: 1, max: 1000 }],
      render(ctx, _params, fb): void { calls.push(ctx.timeMs); fb.set(0, ctx.timeMs / 100, 0, 0, 1); },
    };
    const bridge = createGeneratorBridge((id) => id === generator.id ? generator : undefined);
    const model = runtimeModel([8]);
    const voice = runtimeVoice({}, runtimeAction({ params: { life: 100 } }), generator.id);
    voice.materialCycleMs = 100;
    const dst = new Framebuffer(model.pixelCount);
    const render = (timeMs: number, dt: number): void => {
      const frame = runtimeFrame(timeMs, dt);
      bridge.beginFrame(model, timeMs, dt, frame.transport);
      dst.clear();
      bridge.renderVoice(voice, model, timeMs, 1, [{ start: 0, end: model.pixelCount }], dst, { phase: 0, timeMs, bpm: 120 });
    };

    render(0, 0);
    render(50, 50);
    render(100, 50);
    expect(calls).toEqual([0, 50, 0]);
    expect(dst.rgba[0]).toBeCloseTo(0.5, 6);
    render(110, 10);
    expect(calls).toEqual([0, 50, 0, 10]);
    expect(dst.rgba[0]).toBeCloseTo(0.34, 6);
  });

  it('drops stale outgoing material when a render jumps over a cycle', () => {
    const calls: number[] = [];
    const generator: EffectGenerator = {
      id: 'test-large-jump', name: 'Test large jump', category: 'texture',
      voiceLife: { key: 'life', unit: 'ms' },
      paramSpec: [{ key: 'life', label: 'Life', type: 'number', default: 100, min: 1, max: 1000 }],
      render(ctx, _params, fb): void { calls.push(ctx.timeMs); fb.set(0, ctx.timeMs / 100, 0, 0, 1); },
    };
    const bridge = createGeneratorBridge((id) => id === generator.id ? generator : undefined);
    const model = runtimeModel([8]);
    const voice = runtimeVoice({}, runtimeAction({ params: { life: 100 } }), generator.id);
    voice.materialCycleMs = 100;
    const dst = new Framebuffer(model.pixelCount);
    const render = (timeMs: number, dt: number): void => {
      const frame = runtimeFrame(timeMs, dt);
      bridge.beginFrame(model, timeMs, dt, frame.transport);
      dst.clear();
      bridge.renderVoice(voice, model, timeMs, 1, [{ start: 0, end: model.pixelCount }], dst, { phase: 0, timeMs, bpm: 120 });
    };

    render(0, 0);
    render(50, 50);
    render(350, 300);
    expect(calls).toEqual([0, 50, 50]);
    expect(voice.materialCycle?.cycleIndex).toBe(3);
    expect(voice.materialCycle?.previous).toBeNull();
    expect(dst.rgba[0]).toBeCloseTo(0.5, 6);
  });

  it('freezes a beat-based member cycle at spawn BPM while a new voice resolves at its BPM', () => {
    const effect = runtimeEffect('segments');
    const action = runtimeAction({
      params: {},
      spliceInputs: [{ ...runtimeAction({ effectId: 'fx', params: { lifeBeats: 2 } }), opacity: 1, originNodeId: 'member' }],
      splice: runtimeSplice(),
    });
    const spawn = (timeMs: number, bpm: number): Voice => new VoicePool().spawn(action, 'd0', 1, {
      effectsById: new Map([['fx', effect]]),
      busById: new Map([['b', runtimeBus]]), latched: new Map(), timeMs, bpm,
    })!;
    const first = spawn(0, 120);
    expect(first.spliceInputs![0]!.materialCycleMs).toBe(1000);
    first.spliceInputs![0]!.params.lifeBeats = 8;
    expect(first.spliceInputs![0]!.materialCycleMs).toBe(1000);
    const changedAction = { ...action, spliceInputs: [{ ...action.spliceInputs![0]!, params: { lifeBeats: 8 } }] };
    expect(new VoicePool().spawn(changedAction, 'd0', 1, {
      effectsById: new Map([['fx', effect]]),
      busById: new Map([['b', runtimeBus]]), latched: new Map(), timeMs: 0, bpm: 60,
    })!.spliceInputs![0]!.materialCycleMs).toBe(8000);
  });

  it('gives a stateless absolute generator one coherent fresh clock and one render per frame', () => {
    const calls: Array<{ timeMs: number; ageMs: number; dt: number; beat: number }> = [];
    const generator: EffectGenerator = {
      id: 'test-stateless-absolute',
      name: 'Test stateless absolute',
      category: 'texture',
      voiceLife: { key: 'life', unit: 'ms' },
      paramSpec: [{ key: 'life', label: 'Life', type: 'number', default: 100, min: 1, max: 1000 }],
      render(ctx: RenderContext, _params, fb): void {
        calls.push({ timeMs: ctx.timeMs, ageMs: ctx.triggers[0]!.ageMs, dt: ctx.dt, beat: ctx.transport.beat });
        fb.set(0, ctx.timeMs / 100, 0, 0, 1);
      },
    };
    const bridge = createGeneratorBridge((id) => id === generator.id ? generator : undefined);
    const model = runtimeModel([8, 8]);
    const voice = runtimeVoice({}, runtimeAction({ params: { life: 100 } }), generator.id);
    voice.materialCycleMs = 100;
    const dst = new Framebuffer(model.pixelCount);
    const ranges = [{ start: 0, end: model.pixelCount }];
    const render = (timeMs: number, dt: number): number => {
      calls.length = 0;
      const frame = runtimeFrame(timeMs, dt);
      bridge.beginFrame(model, timeMs, dt, frame.transport);
      dst.clear();
      bridge.renderVoice(voice, model, timeMs, 1, ranges, dst, { phase: 0, timeMs, bpm: 120 });
      return calls.length;
    };

    expect(render(0, 0)).toBe(1);
    expect(render(50, 50)).toBe(1);
    expect(render(100, 50)).toBe(1);
    expect(calls).toEqual([{ timeMs: 0, ageMs: 0, dt: 0, beat: 0 }]);
    expect(render(130, 30)).toBe(1);
    expect(render(200, 70)).toBe(1);
    expect(render(300, 100)).toBe(1);
  });

  it('regenerates emitter state, lastSeq, and seed across three deterministic cycles', () => {
    const bridge = createGeneratorBridge();
    const model = runtimeModel([8, 8]);
    const voice = runtimeVoice(
      {},
      runtimeAction({ params: { life: 100, count: 1, spread: 0.1, gravity: 0, brightness: 1 } }),
      'confetti-burst',
    );
    voice.materialCycleMs = 100;
    const dst = new Framebuffer(model.pixelCount);
    const ranges = [{ start: 0, end: model.pixelCount }];
    const render = (timeMs: number, dt: number): void => {
      Object.assign(voice.liveParams, voice.params);
      const frame = runtimeFrame(timeMs, dt);
      bridge.beginFrame(model, timeMs, dt, frame.transport);
      dst.clear();
      bridge.renderVoice(voice, model, timeMs, 1, ranges, dst, { phase: 0, timeMs, bpm: 120 });
    };

    render(0, 0);
    const first = voice.genState as { em?: unknown; particles: unknown[]; lastSeq?: number };
    const firstCycle = voice.materialCycle!;
    expect(first.particles.length).toBe(1);
    expect(firstCycle.currentSeq).toBe(first.lastSeq ?? firstCycle.currentSeq);

    render(100, 100);
    const second = voice.genState as { particles: unknown[]; lastSeq: number };
    const secondCycle = voice.materialCycle!;
    expect(secondCycle.cycleIndex).toBe(1);
    expect(secondCycle.currentSeed).not.toBe(firstCycle.currentSeed);
    expect(secondCycle.currentSeq).not.toBe(firstCycle.currentSeq);
    expect(second.lastSeq).toBe(secondCycle.currentSeq);
    expect(second.particles.length).toBe(1);
    expect(secondCycle.previous?.framebuffer).toBeDefined();

    render(130, 30);
    expect(voice.materialCycle!.previous).toBeNull();
    render(200, 70);
    expect(voice.materialCycle!.cycleIndex).toBe(2);
    expect((voice.genState as { lastSeq: number }).lastSeq).toBe(voice.materialCycle!.currentSeq);
  });

  it('restarts a voice-timebase emitter on every cycle without sharing member state', () => {
    const bridge = createGeneratorBridge();
    const model = runtimeModel([8, 8]);
    const voice = runtimeVoice(
      {},
      runtimeAction({ params: { lifeMs: 100, echoes: 1 } }),
      'drum-sonar',
    );
    voice.materialCycleMs = 100;
    const dst = new Framebuffer(model.pixelCount);
    const render = (timeMs: number, dt: number): void => {
      Object.assign(voice.liveParams, voice.params);
      const frame = runtimeFrame(timeMs, dt);
      bridge.beginFrame(model, timeMs, dt, frame.transport);
      dst.clear();
      bridge.renderVoice(voice, model, timeMs, 1, [{ start: 0, end: model.pixelCount }], dst, { phase: 0, timeMs, bpm: 120 });
    };

    for (const [timeMs, dt] of [[0, 0], [100, 100], [200, 100], [300, 100]] as const) {
      render(timeMs, dt);
      const state = voice.genState as { em: { emissions: unknown[]; lastSeq: number } };
      expect(state.em.emissions).toHaveLength(1);
      expect(state.em.lastSeq).toBe(voice.materialCycle!.currentSeq);
    }
    expect(voice.materialCycle!.cycleIndex).toBe(3);
  });

  it('replays the same event and cycle timeline byte-for-byte', () => {
    const play = (): number[][] => {
      const bridge = createGeneratorBridge();
      const model = runtimeModel([8, 8]);
      const voice = runtimeVoice(
        {},
        runtimeAction({ params: { life: 100, count: 1, spread: 0.1, gravity: 0, brightness: 1 } }),
        'confetti-burst',
      );
      voice.materialCycleMs = 100;
      const dst = new Framebuffer(model.pixelCount);
      const frames: number[][] = [];
      for (const [timeMs, dt] of [[0, 0], [50, 50], [100, 50], [130, 30], [200, 70], [250, 50], [300, 50]] as const) {
        Object.assign(voice.liveParams, voice.params);
        const frame = runtimeFrame(timeMs, dt);
        bridge.beginFrame(model, timeMs, dt, frame.transport);
        dst.clear();
        bridge.renderVoice(voice, model, timeMs, 1, [{ start: 0, end: model.pixelCount }], dst, { phase: 0, timeMs, bpm: 120 });
        frames.push(Array.from(dst.rgba));
      }
      return frames;
    };

    expect(play()).toEqual(play());
  });

  it('keeps no-life material on the ordinary single-generation path', () => {
    let renders = 0;
    const generator: EffectGenerator = {
      id: 'test-no-life', name: 'Test no life', category: 'texture', paramSpec: [],
      render(_ctx, _params, fb): void { renders++; fb.set(0, 1, 0, 0, 1); },
    };
    const bridge = createGeneratorBridge((id) => id === generator.id ? generator : undefined);
    const model = runtimeModel([8, 8]);
    const voice = runtimeVoice({}, runtimeAction(), generator.id);
    const dst = new Framebuffer(model.pixelCount);
    const frame = runtimeFrame(500, 16);
    bridge.beginFrame(model, 500, 16, frame.transport);
    bridge.renderVoice(voice, model, 500, 1, [{ start: 0, end: model.pixelCount }], dst, { phase: 0, timeMs: 500, bpm: 120 });
    expect(renders).toBe(1);
    expect(voice.materialCycle).toBeUndefined();
  });

  it('applies a modifier once to the assembled cycle and only within its scope', () => {
    const generator: EffectGenerator = {
      id: 'test-cycle-modifier', name: 'Test cycle modifier', category: 'texture',
      voiceLife: { key: 'life', unit: 'ms' },
      paramSpec: [{ key: 'life', label: 'Life', type: 'number', default: 100, min: 1, max: 1000 }],
      render(_ctx, _params, fb): void {
        for (let i = 0; i < fb.pixelCount; i++) fb.set(i, 1, 0, 0, 1);
      },
    };
    const bridge = createGeneratorBridge((id) => id === generator.id ? generator : undefined);
    const model = runtimeModel([8, 8]);
    const voice = runtimeVoice(
      { modifiers: [{ modifierId: 'levels', params: { saturation: 1, brightness: 1, invert: true } }] },
      runtimeAction({ params: { life: 100 } }),
      generator.id,
    );
    const dst = new Framebuffer(model.pixelCount);
    const frame = runtimeFrame(100, 50);
    bridge.beginFrame(model, 100, 50, frame.transport);
    voice.materialCycleMs = 100;
    bridge.renderVoice(voice, model, 100, 1, [{ start: 0, end: 4 }, { start: 8, end: 12 }], dst, { phase: 0, timeMs: 100, bpm: 120 });
    for (const i of [0, 1, 2, 3, 8, 9, 10, 11]) expect(Array.from(dst.rgba.slice(i * 4, i * 4 + 4))).toEqual([0, 1, 1, 1]);
    for (const i of [4, 5, 6, 7, 12, 13, 14, 15]) expect(Array.from(dst.rgba.slice(i * 4, i * 4 + 4))).toEqual([0, 0, 0, 0]);
  });

  it('checkpoints outgoing and current cycle state, then clears it on model and voice reset', () => {
    const bridge = createGeneratorBridge();
    const model = runtimeModel([8, 8]);
    const voice = runtimeVoice({}, runtimeAction({ params: { life: 100, count: 1 } }), 'confetti-burst');
    voice.materialCycleMs = 100;
    const dst = new Framebuffer(model.pixelCount);
    const render = (timeMs: number, dt: number): void => {
      Object.assign(voice.liveParams, voice.params);
      const frame = runtimeFrame(timeMs, dt);
      bridge.beginFrame(model, timeMs, dt, frame.transport);
      dst.clear();
      bridge.renderVoice(voice, model, timeMs, 1, [{ start: 0, end: model.pixelCount }], dst, { phase: 0, timeMs, bpm: 120 });
    };
    render(0, 0);
    render(100, 100);
    voice.renderModel = model;
    const checkpoint = createRenderCheckpoint();
    checkpoint([voice], model, 1);
    const baseline = JSON.stringify(voice.materialCycle);
    voice.materialCycle!.currentSeq = 123;
    (voice.genState as { lastSeq: number }).lastSeq = 123;
    checkpoint([voice], model, 1);
    expect(JSON.stringify(voice.materialCycle)).toBe(baseline);
    expect((voice.genState as { lastSeq: number }).lastSeq).not.toBe(123);

    const replacement = runtimeModel([8, 8]);
    ensureGeometryState(voice, replacement);
    expect(voice.materialCycle).toBeUndefined();
    expect(voice.genState).toBeNull();
    deactivateVoice(voice);
    expect(voice.materialCycle).toBeUndefined();
  });
});
