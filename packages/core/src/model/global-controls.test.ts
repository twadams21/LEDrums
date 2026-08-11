import { describe, expect, it } from 'vitest';
import {
  GLOBAL_CONTROL_ACTIONS,
  GLOBAL_CONTROL_CATALOG,
  globalControlDef,
  globalControlForNote,
  globalControlForOsc,
  globalControlsSchema,
  oscArgFires,
  withGlobalControlBinding,
  type GlobalControls,
} from './global-controls';
import { inputMapSchema } from './project-schema';

describe('global control catalogue', () => {
  it('covers every action id exactly once', () => {
    const ids = GLOBAL_CONTROL_CATALOG.map((d) => d.id);
    expect(ids).toEqual([...GLOBAL_CONTROL_ACTIONS]);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('resolves a definition for every action', () => {
    for (const id of GLOBAL_CONTROL_ACTIONS) {
      expect(globalControlDef(id).id).toBe(id);
      expect(globalControlDef(id).label).not.toBe('');
    }
  });
});

describe('globalControlsSchema', () => {
  it('defaults to no bindings', () => {
    expect(globalControlsSchema.parse(undefined)).toEqual({});
  });

  it('drops a binding for an action that no longer exists', () => {
    // A removed action's stale binding must not survive a load as an invisible ghost.
    const parsed = globalControlsSchema.parse({ nextSong: { midiNote: 60 }, retiredAction: { midiNote: 61 } });
    expect(parsed).toEqual({ nextSong: { midiNote: 60 } });
  });

  it('rejects an out-of-range note', () => {
    expect(() => globalControlsSchema.parse({ nextSong: { midiNote: 128 } })).toThrow();
  });

  it('rides on inputMap with an empty default, so an old project loads unchanged', () => {
    expect(inputMapSchema.parse({}).globalControls).toEqual({});
  });
});

describe('globalControlForNote', () => {
  const controls: GlobalControls = { nextSong: { midiNote: 60 }, prevSection: { midiNote: 62 } };

  it('finds the bound action', () => {
    expect(globalControlForNote(controls, 60)).toBe('nextSong');
    expect(globalControlForNote(controls, 62)).toBe('prevSection');
  });

  it('returns null for a free note', () => {
    expect(globalControlForNote(controls, 61)).toBeNull();
  });

  it('returns null when nothing is bound', () => {
    expect(globalControlForNote({}, 60)).toBeNull();
  });

  it('breaks a duplicate-note tie by catalogue order, not object key order', () => {
    // Built with prevSection FIRST so a naive Object.keys walk would pick it.
    const dup: GlobalControls = { prevSection: { midiNote: 60 }, nextSong: { midiNote: 60 } };
    expect(globalControlForNote(dup, 60)).toBe('nextSong');
  });
});

describe('globalControlForOsc', () => {
  const controls: GlobalControls = { nextSection: { oscAddress: '/ledrums/next' } };

  it('matches an exact address', () => {
    expect(globalControlForOsc(controls, '/ledrums/next')).toBe('nextSection');
  });

  it('matches around surrounding whitespace on the incoming address', () => {
    expect(globalControlForOsc(controls, '  /ledrums/next  ')).toBe('nextSection');
  });

  it('does not match a prefix or a different address', () => {
    expect(globalControlForOsc(controls, '/ledrums/next/section')).toBeNull();
    expect(globalControlForOsc(controls, '/ledrums/prev')).toBeNull();
  });

  it('never matches an empty address', () => {
    expect(globalControlForOsc({ nextSong: { oscAddress: '/x' } }, '')).toBeNull();
    expect(globalControlForOsc({ nextSong: { oscAddress: '   ' } }, '   ')).toBeNull();
  });
});

describe('oscArgFires', () => {
  it('fires on any nonzero argument and never on zero', () => {
    expect(oscArgFires(1)).toBe(true);
    expect(oscArgFires(0.5)).toBe(true);
    expect(oscArgFires(-1)).toBe(true);
    expect(oscArgFires(0)).toBe(false);
  });
});

describe('withGlobalControlBinding', () => {
  it('adds a binding without touching the others', () => {
    const before: GlobalControls = { nextSong: { midiNote: 60 } };
    const after = withGlobalControlBinding(before, 'prevSong', { midiNote: 61 });
    expect(after).toEqual({ nextSong: { midiNote: 60 }, prevSong: { midiNote: 61 } });
    expect(before).toEqual({ nextSong: { midiNote: 60 } }); // immutable
  });

  it('merges into an existing binding rather than replacing it', () => {
    const after = withGlobalControlBinding({ nextSong: { midiNote: 60 } }, 'nextSong', { oscAddress: '/n' });
    expect(after.nextSong).toEqual({ midiNote: 60, oscAddress: '/n' });
  });

  it('clears one field with undefined and keeps the rest', () => {
    const before: GlobalControls = { nextSong: { midiNote: 60, oscAddress: '/n' } };
    expect(withGlobalControlBinding(before, 'nextSong', { midiNote: undefined }).nextSong).toEqual({ oscAddress: '/n' });
  });

  it('removes the action entirely once nothing is left bound', () => {
    const before: GlobalControls = { nextSong: { midiNote: 60 } };
    const after = withGlobalControlBinding(before, 'nextSong', { midiNote: undefined });
    expect('nextSong' in after).toBe(false);
  });

  it('trims an address, and treats a whitespace-only one as cleared', () => {
    expect(withGlobalControlBinding({}, 'nextSong', { oscAddress: '  /n  ' }).nextSong).toEqual({ oscAddress: '/n' });
    expect('nextSong' in withGlobalControlBinding({}, 'nextSong', { oscAddress: '   ' })).toBe(false);
  });

  it('round-trips through the schema (no shape the schema would reject)', () => {
    const built = withGlobalControlBinding({}, 'nextSection', { midiNote: 64, oscAddress: '/s' });
    expect(globalControlsSchema.parse(built)).toEqual(built);
  });
});
