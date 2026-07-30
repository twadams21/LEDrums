import { describe, expect, it } from 'vitest';
import { resolveEngineMode } from './engine-mode';

/* INIT-01 S1/S7: the shipped engine default, asserted rather than read. The full truth table —
   what the server runs for an unset, empty, matching, and unrecognised LEDRUMS_ENGINE — is the
   evidence for S7's flip, so it is spelled out exhaustively rather than sampled. S7 inverted it:
   voice is the default and 'legacy' is the explicit opt-out. */

describe('resolveEngineMode — voice is the default, legacy is the explicit opt-out (S7)', () => {
  it('unset LEDRUMS_ENGINE → voice (`pnpm start` now runs the same engine as `pnpm dev`)', () => {
    expect(resolveEngineMode({})).toBe('voice');
  });

  it('empty LEDRUMS_ENGINE → voice', () => {
    expect(resolveEngineMode({ LEDRUMS_ENGINE: '' })).toBe('voice');
  });

  it("'legacy' → legacy (the only value that opts out)", () => {
    expect(resolveEngineMode({ LEDRUMS_ENGINE: 'legacy' })).toBe('legacy');
  });

  it("'LEGACY' → legacy (case-insensitive)", () => {
    expect(resolveEngineMode({ LEDRUMS_ENGINE: 'LEGACY' })).toBe('legacy');
  });

  it("'voice' → voice (the old opt-in still names the mode it selects)", () => {
    expect(resolveEngineMode({ LEDRUMS_ENGINE: 'voice' })).toBe('voice');
  });

  it('an unrecognised value → voice (a typo can no longer downgrade a live rig)', () => {
    expect(resolveEngineMode({ LEDRUMS_ENGINE: 'garbage' })).toBe('voice');
  });
});
