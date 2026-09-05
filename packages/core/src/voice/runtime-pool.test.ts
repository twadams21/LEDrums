import { expect, it } from 'vitest';
import { VoicePool, releaseVoice } from './voice-pool';
import { runtimeAction, runtimeBus, runtimeEffect } from './runtime-test-fixtures';

it('saturation clears stolen latches and prefers releasing slots, deterministically at 256', () => {
  const pool = new VoicePool();
  const latched = new Map<string, string | null>();
  const deps = { effectsById: new Map([['fx', runtimeEffect()]]), busById: new Map([['b', runtimeBus]]), latched, timeMs: 0, bpm: 120 };
  pool.spawn(runtimeAction({ latchKey: 'toggle' }), 'd0', 1, deps);
  for (let i = 1; i < 256; i++) pool.spawn(runtimeAction(), 'd0', 1, deps);
  const releasing = pool.findActiveVoice('v200')!;
  releaseVoice(releasing, 0);
  expect(pool.spawn(runtimeAction(), 'd0', 1, deps)?.id).toBe('v257');
  expect(pool.isVoiceAlive('v200')).toBe(false);
  expect(pool.isVoiceAlive('v1')).toBe(true);
  for (let i = 0; i < 1025; i++) pool.spawn(runtimeAction(), 'd0', 1, deps);
  expect(pool.pool.filter((v) => v.active)).toHaveLength(256);
  expect(latched.get('toggle')).toBeNull();
});
