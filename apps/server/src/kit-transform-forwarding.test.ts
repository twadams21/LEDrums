import { describe, expect, it, vi } from 'vitest';
import type { Engine } from '@ledrums/core';
import { applyClientMessage } from './input-router';
import { propagateToVoiceHost } from './handlers/voice-input';
import type { VoiceEngineHost } from './voice-engine-host';
import type { ClientMessage } from './ws-protocol';

/* S10: a `setKitTransform` must forward BOTH `flip` (new) and `pixelsPerHoop` (a latent
   drop on the legacy-engine path — the voice host already forwarded it) through to each
   engine's kit transform. Regression coverage for both server paths that consume the
   message: the legacy reducer (`applyClientMessage`) and the voice bridge
   (`propagateToVoiceHost`). Undefined fields must NOT be forwarded (partial-merge shape). */

const msg = (extra: Partial<Extract<ClientMessage, { t: 'setKitTransform' }>>): ClientMessage => ({
  t: 'setKitTransform',
  drumId: 'kick',
  ...extra,
});

describe('legacy engine path — applyClientMessage(setKitTransform)', () => {
  it('forwards flip and pixelsPerHoop to engine.setKitTransform', () => {
    const setKitTransform = vi.fn();
    const engine = { setKitTransform } as unknown as Engine;
    applyClientMessage(engine, msg({ pixelsPerHoop: 50, flip: true }), 0);
    expect(setKitTransform).toHaveBeenCalledWith('kick', { pixelsPerHoop: 50, flip: true });
  });

  it('omits undefined fields (partial merge — a spin-only edit carries neither)', () => {
    const setKitTransform = vi.fn();
    const engine = { setKitTransform } as unknown as Engine;
    applyClientMessage(engine, msg({ localSpinDeg: 15 }), 0);
    const partial = setKitTransform.mock.calls[0]![1] as Record<string, unknown>;
    expect(partial).toEqual({ localSpinDeg: 15 });
    expect('flip' in partial).toBe(false);
    expect('pixelsPerHoop' in partial).toBe(false);
  });
});

describe('voice host path — propagateToVoiceHost(setKitTransform)', () => {
  it('forwards flip and pixelsPerHoop to voiceHost.setKitTransform', () => {
    const setKitTransform = vi.fn();
    const host = { setKitTransform } as unknown as VoiceEngineHost;
    propagateToVoiceHost(host, msg({ pixelsPerHoop: 108, flip: true }));
    expect(setKitTransform).toHaveBeenCalledWith('kick', { pixelsPerHoop: 108, flip: true });
  });

  it('forwards flip:false explicitly (clearing the flag is a real edit)', () => {
    const setKitTransform = vi.fn();
    const host = { setKitTransform } as unknown as VoiceEngineHost;
    propagateToVoiceHost(host, msg({ flip: false }));
    expect(setKitTransform).toHaveBeenCalledWith('kick', { flip: false });
  });
});
