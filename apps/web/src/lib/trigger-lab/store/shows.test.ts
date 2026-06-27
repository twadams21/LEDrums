import { describe, expect, it } from 'vitest';
import { nextShowName, planDeleteShow, renameShowIn, withShow, type ShowMap } from './shows';
import type { AuthoredState, Show } from '../persistence';

/* Pure show-library decisions (the map arithmetic + delete re-point). The rune-level
   behaviour is covered in store.shows.test.ts; this locks the decision tree in isolation. */

const show = (id: string, name: string): Show => ({ id, name, authored: {} as AuthoredState });
const lib = (...ids: [string, string][]): ShowMap => Object.fromEntries(ids.map(([id, n]) => [id, show(id, n)]));

describe('nextShowName', () => {
  it('returns the base name when unused, else the first free numbered variant', () => {
    expect(nextShowName({})).toBe('Untitled Show');
    expect(nextShowName(lib(['a', 'Untitled Show']))).toBe('Untitled Show 2');
    expect(nextShowName(lib(['a', 'Untitled Show'], ['b', 'Untitled Show 2']))).toBe('Untitled Show 3');
  });
});

describe('withShow / renameShowIn', () => {
  it('inserts immutably', () => {
    const before = lib(['a', 'A']);
    const after = withShow(before, show('b', 'B'));
    expect(Object.keys(after)).toEqual(['a', 'b']);
    expect(before).not.toBe(after);
    expect('b' in before).toBe(false);
  });
  it('renames, and no-ops (same ref) on a blank name or unknown id', () => {
    const before = lib(['a', 'A']);
    expect(renameShowIn(before, 'a', 'New')['a']!.name).toBe('New');
    expect(renameShowIn(before, 'a', '   ')).toBe(before); // blank → same ref
    expect(renameShowIn(before, 'nope', 'X')).toBe(before); // unknown → same ref
  });
});

describe('planDeleteShow', () => {
  it('no-ops on an unknown id', () => {
    expect(planDeleteShow(lib(['a', 'A']), 'a', 'nope')).toEqual({ kind: 'noop' });
  });

  it('reseeds when the last show is deleted', () => {
    expect(planDeleteShow(lib(['a', 'A']), 'a', 'a')).toEqual({ kind: 'reseed' });
  });

  it('removes a non-active show without a runes reload', () => {
    const plan = planDeleteShow(lib(['a', 'A'], ['b', 'B']), 'b', 'a');
    expect(plan).toMatchObject({ kind: 'remove', activeShowId: 'b', reload: null });
    if (plan.kind === 'remove') expect(Object.keys(plan.library)).toEqual(['b']);
  });

  it('re-points the active show to its LEFT neighbour and flags a reload', () => {
    const plan = planDeleteShow(lib(['a', 'A'], ['b', 'B'], ['c', 'C']), 'b', 'b');
    expect(plan).toMatchObject({ kind: 'remove', activeShowId: 'a' });
    if (plan.kind === 'remove') {
      expect(plan.reload?.id).toBe('a');
      expect(Object.keys(plan.library)).toEqual(['a', 'c']);
    }
  });

  it('re-points the active FIRST show to the new first', () => {
    const plan = planDeleteShow(lib(['a', 'A'], ['b', 'B']), 'a', 'a');
    expect(plan).toMatchObject({ kind: 'remove', activeShowId: 'b' });
    if (plan.kind === 'remove') expect(plan.reload?.id).toBe('b');
  });
});
