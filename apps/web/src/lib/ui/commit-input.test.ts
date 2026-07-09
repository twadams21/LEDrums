import { describe, expect, it } from 'vitest';
import { clampNumber, resolveCommit } from './commit-input';

/* The component owns focus / keyboard wiring (Enter → blur → commit, Esc → revert);
   the decision rules below are what those paths resolve to. Tested here in the repo's
   node test env (no DOM), the same way the rest of the suite tests pure logic. */

describe('clampNumber', () => {
  it('clamps to min and max, passes through when in range or unbounded', () => {
    expect(clampNumber(5, 0, 127)).toBe(5);
    expect(clampNumber(-3, 0, 127)).toBe(0);
    expect(clampNumber(200, 0, 127)).toBe(127);
    expect(clampNumber(200)).toBe(200); // no bounds
    expect(clampNumber(-3, 0)).toBe(0); // min only
    expect(clampNumber(200, undefined, 127)).toBe(127); // max only
  });
});

describe('resolveCommit — text mode (inline rename)', () => {
  it('commits a changed, non-empty draft (Enter / blur)', () => {
    expect(resolveCommit({ draft: 'Verse 2', value: 'Verse 1' })).toEqual({
      action: 'commit',
      value: 'Verse 2',
    });
  });

  it('trims before committing', () => {
    expect(resolveCommit({ draft: '  Chorus  ', value: 'Verse' })).toEqual({
      action: 'commit',
      value: 'Chorus',
    });
  });

  it('cancels (reverts) when blank — never commits an empty rename', () => {
    expect(resolveCommit({ draft: '   ', value: 'Verse' })).toEqual({ action: 'cancel' });
  });

  it('cancels when unchanged', () => {
    expect(resolveCommit({ draft: 'Verse', value: 'Verse' })).toEqual({ action: 'cancel' });
  });

  it('allowEmpty commits an emptied field as "" to clear', () => {
    expect(resolveCommit({ draft: '', value: '/kick', allowEmpty: true })).toEqual({
      action: 'commit',
      value: '',
    });
  });

  it('allowEmpty still cancels when unchanged-empty', () => {
    expect(resolveCommit({ draft: '', value: '', allowEmpty: true })).toEqual({ action: 'cancel' });
  });
});

describe('resolveCommit — number mode (clamped field)', () => {
  it('clamps to min on commit', () => {
    expect(resolveCommit({ draft: '-5', value: '10', type: 'number', min: 0, max: 127 })).toEqual({
      action: 'commit',
      value: '0',
    });
  });

  it('clamps to max on commit', () => {
    expect(resolveCommit({ draft: '200', value: '10', type: 'number', min: 0, max: 127 })).toEqual({
      action: 'commit',
      value: '127',
    });
  });

  it('commits a finite in-range number unchanged', () => {
    expect(resolveCommit({ draft: '64', value: '10', type: 'number', min: 0, max: 127 })).toEqual({
      action: 'commit',
      value: '64',
    });
  });

  it('commits "" when an existing number is cleared (caller decides)', () => {
    expect(resolveCommit({ draft: '  ', value: '64', type: 'number' })).toEqual({
      action: 'commit',
      value: '',
    });
  });

  it('cancels when an already-empty number field is left empty', () => {
    expect(resolveCommit({ draft: '', value: '', type: 'number' })).toEqual({ action: 'cancel' });
  });

  it('reverts on non-finite garbage, keeping the prior value', () => {
    expect(resolveCommit({ draft: 'abc', value: '64', type: 'number' })).toEqual({ action: 'revert' });
  });

  it('cancels when the clamped result equals the prior value (no spurious commit)', () => {
    // typing 200 into a max=127 field that already holds 127 → no-op
    expect(resolveCommit({ draft: '200', value: '127', type: 'number', max: 127 })).toEqual({
      action: 'cancel',
    });
  });
});

describe('resolveCommit — password (credential) mode (R29)', () => {
  it('commits a non-empty draft raw, WITHOUT trimming (whitespace can be significant in a credential)', () => {
    expect(resolveCommit({ draft: ' s3cret ', value: '', type: 'password' })).toEqual({
      action: 'commit',
      value: ' s3cret ', // untouched — never trimmed like text mode
    });
  });

  it('is a no-op for an empty draft (a blank submit never clears a set password)', () => {
    expect(resolveCommit({ draft: '', value: '', type: 'password' })).toEqual({ action: 'cancel' });
  });

  it('never round-trips the stored value — a same-looking draft still commits (only a hash is held)', () => {
    // The caller passes value='' (never the plaintext), so any typed password is a fresh set.
    expect(resolveCommit({ draft: 'pw', value: 'pw', type: 'password' })).toEqual({
      action: 'commit',
      value: 'pw',
    });
  });
});
