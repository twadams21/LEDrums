import { parseKit } from '../geometry/kit-schema';
import { buildPixelModel } from '../geometry/pixel-model';
import type { CompositorFrame } from './compositor';
import type { PlayAction } from './eval-graph';
import type { Bus, EffectDef, SpliceConfig, Voice } from './types';
import { VoicePool } from './voice-pool';

export function runtimeModel(counts = [4, 4], reverse = false) {
  const drums = counts.map((pixelCount, i) => ({
    id: `d${i}`, diameterIn: 12, hoopSpacingMm: 50, origin: { x: i * 300, y: 0, z: 0 },
    rotation: { x: 0, y: 0, z: 0 }, hoops: [{ pixelCount, reverse: false }],
  }));
  return buildPixelModel(parseKit({
    global: { ledDensityPxPerM: 30, hoopCount: 1, defaultHoopSpacingMm: 50 },
    drums: reverse ? drums.reverse() : drums,
  }));
}

export function runtimeHoopModel(hoops: number, pixels = 1024) {
  return buildPixelModel(parseKit({
    global: { ledDensityPxPerM: 30, hoopCount: hoops, defaultHoopSpacingMm: 50 },
    drums: [{ id: 'd0', diameterIn: 12, hoopSpacingMm: 50, origin: { x: 0, y: 0, z: 0 },
      rotation: { x: 0, y: 0, z: 0 },
      hoops: Array.from({ length: hoops }, () => ({ pixelCount: pixels / hoops, reverse: false })),
    }],
  }));
}

export const runtimeBus: Bus = { id: 'b', name: 'B', polyphony: 'poly', crossfadeMs: 100 };
export function runtimeEffect(generatorId = 'pixel-accum'): EffectDef {
  return { id: 'fx', name: 'FX', generatorId, busId: 'b', scope: 'kit', params: [], attackMs: 0, sustainMs: 5000, releaseMs: 100 };
}
export function runtimeAction(over: Partial<PlayAction> = {}): PlayAction {
  return { kind: 'play', effectId: 'fx', busId: 'b', mode: 'loop', scope: 'kit', params: { brightness: 0.25, addPerHit: 16 }, via: '', latchKey: null, ...over };
}
export function runtimeVoice(over: Partial<Voice> = {}, action = runtimeAction(), generatorId = 'pixel-accum'): Voice {
  const pool = new VoicePool();
  const v = pool.spawn(action, 'd0', 1, {
    effectsById: new Map([['fx', runtimeEffect(generatorId)]]), busById: new Map([['b', runtimeBus]]),
    latched: new Map(), timeMs: 0, bpm: 120,
  })!;
  return Object.assign(v, { level: 1 }, over);
}
export function runtimeFrame(timeMs: number, dt = 16): CompositorFrame {
  return { timeMs, dt, transport: { timeMs, beat: timeMs / 500, bar: 0, beatInBar: timeMs / 500, bpm: 120, beatsPerBar: 4, playing: true } };
}

export function runtimeSplice(): SpliceConfig {
  return { count: 2, partition: 'hoop', jitter: 0, seed: 1, chase: 'off', chaseMs: 100,
    direction: 1, incrementPx: 1, offsetMs: 0, order: 'up', drumOffsetMs: 0,
    drumOrder: 'up', colorOffsetMs: 0, colorOrder: 'up', rotationDeg: 0, smudge: 0,
    motionMode: 'restart', waitMode: 'lit', envelope: { attackMs: 0, sustainMs: 5000, releaseMs: 100 },
    tint: 0, colors: [null, null], inputBySlot: [0, 0] };
}
