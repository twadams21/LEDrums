import { describe, expect, it, vi } from 'vitest';
import type { Engine } from '@ledrums/core';
import { applyClientMessage } from './input-router';
import { propagateToVoiceHost } from './handlers/voice-input';
import type { VoiceEngineHost } from './voice-engine-host';
import type { ClientMessage } from './ws-protocol';

/* P1 (C5): a per-hoop `setHoopConfig` must reach BOTH server paths that own a live render —
   the legacy reducer (`applyClientMessage` → engine.setHoopConfig) and the voice bridge
   (`propagateToVoiceHost` → voiceHost.setHoopConfig) — so a hoop pixel-count / reverse edit
   applies live on either host. `hoopIndex` is 1-based (A1). Undefined fields must NOT be
   forwarded (partial-merge shape), mirroring the setKitTransform / setKitGlobal forwarders. */

const msg = (extra: Partial<Extract<ClientMessage, { t: 'setHoopConfig' }>>): ClientMessage => ({
  t: 'setHoopConfig',
  drumId: 'kick',
  hoopIndex: 1,
  ...extra,
});

describe('legacy engine path — applyClientMessage(setHoopConfig)', () => {
  it('forwards (drumId, 1-based hoopIndex, pixelCount, reverse) to engine.setHoopConfig', () => {
    const setHoopConfig = vi.fn();
    const engine = { setHoopConfig } as unknown as Engine;
    applyClientMessage(engine, msg({ pixelCount: 196, reverse: true }), 0);
    expect(setHoopConfig).toHaveBeenCalledWith('kick', 1, { pixelCount: 196, reverse: true });
  });

  it('omits undefined fields (a reverse-only edit carries no pixelCount)', () => {
    const setHoopConfig = vi.fn();
    const engine = { setHoopConfig } as unknown as Engine;
    applyClientMessage(engine, msg({ reverse: false }), 0);
    const partial = setHoopConfig.mock.calls[0]![2] as Record<string, unknown>;
    expect(partial).toEqual({ reverse: false });
    expect('pixelCount' in partial).toBe(false);
  });
});

describe('voice host path — propagateToVoiceHost(setHoopConfig)', () => {
  it('forwards the per-hoop edit to the live voice host', () => {
    const setHoopConfig = vi.fn();
    const host = { setHoopConfig } as unknown as VoiceEngineHost;
    propagateToVoiceHost(host, msg({ hoopIndex: 3, pixelCount: 108 }));
    expect(setHoopConfig).toHaveBeenCalledWith('kick', 3, { pixelCount: 108 });
  });
});
