import { describe, expect, it, vi } from 'vitest';
import { applyStructuralMessage } from './handlers/voice-input';
import type { VoiceEngineHost } from './voice-engine-host';
import type { ClientMessage } from './ws-protocol';

/* S10: a `setKitTransform` must forward BOTH `flip` (new) and `pixelsPerHoop` (a latent
   drop on the legacy-engine path — the voice host already forwarded it) through to each
   engine's kit transform. Regression coverage for both server paths that consume the
   message: the legacy reducer (`applyClientMessage`) and the voice-side reducer
   (`applyStructuralMessage`). Undefined fields must NOT be forwarded (partial-merge shape). */

const msg = (extra: Partial<Extract<ClientMessage, { t: 'setKitTransform' }>>): ClientMessage => ({
  t: 'setKitTransform',
  drumId: 'kick',
  ...extra,
});

/**
 * S12 deleted the legacy half of this file: a describe that drove the same message through
 * `applyClientMessage` → `Engine.setKitTransform` and asserted the identical partial-merge shape. Two
 * arms was the finding; the surviving one below is the whole reducer.
 */
describe('voice reducer (sole writer since S8) — applyStructuralMessage(setKitTransform)', () => {
  it('forwards flip and pixelsPerHoop to voiceHost.setKitTransform', () => {
    const setKitTransform = vi.fn();
    const host = { setKitTransform } as unknown as VoiceEngineHost;
    applyStructuralMessage(host, msg({ pixelsPerHoop: 108, flip: true }));
    expect(setKitTransform).toHaveBeenCalledWith('kick', { pixelsPerHoop: 108, flip: true });
  });

  it('forwards flip:false explicitly (clearing the flag is a real edit)', () => {
    const setKitTransform = vi.fn();
    const host = { setKitTransform } as unknown as VoiceEngineHost;
    applyStructuralMessage(host, msg({ flip: false }));
    expect(setKitTransform).toHaveBeenCalledWith('kick', { flip: false });
  });

  it('forwards color (C3 drum swatch) to the live voice host', () => {
    const setKitTransform = vi.fn();
    const host = { setKitTransform } as unknown as VoiceEngineHost;
    applyStructuralMessage(host, msg({ color: '#72d572' }));
    expect(setKitTransform).toHaveBeenCalledWith('kick', { color: '#72d572' });
  });

  /* INIT-01 S5: hoopSpacingMm + diameterIn were missing from THIS arm's spread while the legacy
     arm forwarded both — so a rig calibration of hoop spacing / shell diameter was persisted but
     never reached the live voice geometry. Same drop class as pixelsPerHoop above, opposite path. */
  it('forwards hoopSpacingMm and diameterIn to the live voice host (S5)', () => {
    const setKitTransform = vi.fn();
    const host = { setKitTransform } as unknown as VoiceEngineHost;
    applyStructuralMessage(host, msg({ hoopSpacingMm: 45, diameterIn: 22 }));
    expect(setKitTransform).toHaveBeenCalledWith('kick', { hoopSpacingMm: 45, diameterIn: 22 });
  });

  it('forwards every transform field a full-field edit carries (no silent survivor)', () => {
    const setKitTransform = vi.fn();
    const host = { setKitTransform } as unknown as VoiceEngineHost;
    const full = {
      origin: { x: 1, y: 2, z: 3 },
      rotation: { x: 4, y: 5, z: 6 },
      localSpinDeg: 90,
      startAngleDeg: 15,
      pixelsPerHoop: 200,
      hoopSpacingMm: 45,
      diameterIn: 22,
      flip: true,
      color: '#ff8800',
    };
    applyStructuralMessage(host, msg(full));
    expect(setKitTransform).toHaveBeenCalledWith('kick', full);
  });
});
