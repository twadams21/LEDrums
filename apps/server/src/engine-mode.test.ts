import { describe, expect, it } from 'vitest';
import { resolveEngineMode } from './engine-mode';

/* INIT-01 S1: the shipped engine default, asserted rather than read. The full truth table —
   what the server runs for an unset, empty, matching, and unrecognised LEDRUMS_ENGINE — is
   the evidence S7's default flip is measured against, so it is spelled out exhaustively
   rather than sampled. Behaviour here is today's: only the literal 'voice' selects voice. */

describe('resolveEngineMode — today\'s default (voice is the opt-in)', () => {
  it('unset LEDRUMS_ENGINE → legacy (what `pnpm start` ships)', () => {
    expect(resolveEngineMode({})).toBe('legacy');
  });

  it('empty LEDRUMS_ENGINE → legacy', () => {
    expect(resolveEngineMode({ LEDRUMS_ENGINE: '' })).toBe('legacy');
  });

  it("'voice' → voice", () => {
    expect(resolveEngineMode({ LEDRUMS_ENGINE: 'voice' })).toBe('voice');
  });

  it("'VOICE' → voice (case-insensitive)", () => {
    expect(resolveEngineMode({ LEDRUMS_ENGINE: 'VOICE' })).toBe('voice');
  });

  it("'legacy' → legacy", () => {
    expect(resolveEngineMode({ LEDRUMS_ENGINE: 'legacy' })).toBe('legacy');
  });

  it("an unrecognised value → legacy (never a silent third mode)", () => {
    expect(resolveEngineMode({ LEDRUMS_ENGINE: 'garbage' })).toBe('legacy');
  });
});
