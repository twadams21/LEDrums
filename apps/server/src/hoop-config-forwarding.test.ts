import { describe, expect, it, vi } from 'vitest';
import { applyStructuralMessage } from './handlers/voice-input';
import type { VoiceEngineHost } from './voice-engine-host';
import type { ClientMessage } from './ws-protocol';

/* P1 (C5): a per-hoop `setHoopConfig` must reach BOTH server paths that own a live render —
   the legacy reducer (`applyClientMessage` → engine.setHoopConfig) and the voice-side reducer
   (`applyStructuralMessage` → voiceHost.setHoopConfig) — so a hoop pixel-count / reverse edit
   applies live on either host. `hoopIndex` is 1-based (A1). Undefined fields must NOT be
   forwarded (partial-merge shape), mirroring the setKitTransform / setKitGlobal forwarders. */

const msg = (extra: Partial<Extract<ClientMessage, { t: 'setHoopConfig' }>>): ClientMessage => ({
  t: 'setHoopConfig',
  drumId: 'kick',
  hoopIndex: 1,
  ...extra,
});

/**
 * S12 deleted the legacy half of this file: a describe that drove the same message through
 * `applyClientMessage` → `Engine.setHoopConfig` and asserted the identical partial-merge shape. Two
 * arms was the finding; the surviving one below is the whole reducer.
 */
describe('voice reducer (sole writer since S8) — applyStructuralMessage(setHoopConfig)', () => {
  it('forwards the per-hoop edit to the live voice host', () => {
    const setHoopConfig = vi.fn();
    const host = { setHoopConfig } as unknown as VoiceEngineHost;
    applyStructuralMessage(host, msg({ hoopIndex: 3, pixelCount: 108 }));
    expect(setHoopConfig).toHaveBeenCalledWith('kick', 3, { pixelCount: 108 });
  });
});
