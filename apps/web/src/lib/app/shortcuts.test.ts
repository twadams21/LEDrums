import { describe, expect, it, vi } from 'vitest';
import {
  describeShortcuts,
  dispatchShortcut,
  matchShortcut,
  parseCombo,
  type KeyEventLike,
  type ShortcutEntry,
} from './shortcuts';

function key(over: Partial<KeyEventLike>): KeyEventLike {
  return { key: 'd', ctrlKey: false, metaKey: false, shiftKey: false, altKey: false, ...over };
}

describe('parseCombo', () => {
  it('parses modifier tokens and the key', () => {
    expect(parseCombo('mod+d')).toEqual({ key: 'd', mod: true, shift: false, alt: false });
    expect(parseCombo('mod+shift+z')).toEqual({ key: 'z', mod: true, shift: true, alt: false });
    expect(parseCombo('alt+k')).toEqual({ key: 'k', mod: false, shift: false, alt: true });
  });

  it('is case- and whitespace-insensitive and accepts modifier aliases', () => {
    expect(parseCombo(' Cmd + D ')).toEqual({ key: 'd', mod: true, shift: false, alt: false });
    expect(parseCombo('Ctrl+Z')).toEqual({ key: 'z', mod: true, shift: false, alt: false });
  });
});

describe('matchShortcut — mac/win modifier normalization', () => {
  it('matches Cmd+D on mac but not Ctrl+D on mac', () => {
    const combo = parseCombo('mod+d');
    expect(matchShortcut(key({ metaKey: true }), combo, 'mac')).toBe(true);
    expect(matchShortcut(key({ ctrlKey: true }), combo, 'mac')).toBe(false);
  });

  it('matches Ctrl+D on other but not Cmd+D on other', () => {
    const combo = parseCombo('mod+d');
    expect(matchShortcut(key({ ctrlKey: true }), combo, 'other')).toBe(true);
    expect(matchShortcut(key({ metaKey: true }), combo, 'other')).toBe(false);
  });

  it('matches modifier state exactly — extra modifiers do not collide', () => {
    const undo = parseCombo('mod+z');
    const redo = parseCombo('mod+shift+z');
    expect(matchShortcut(key({ key: 'z', metaKey: true }), undo, 'mac')).toBe(true);
    expect(matchShortcut(key({ key: 'z', metaKey: true, shiftKey: true }), undo, 'mac')).toBe(false);
    expect(matchShortcut(key({ key: 'z', metaKey: true, shiftKey: true }), redo, 'mac')).toBe(true);
  });

  it('requires the key to match', () => {
    expect(matchShortcut(key({ key: 's', metaKey: true }), parseCombo('mod+d'), 'mac')).toBe(false);
  });
});

describe('dispatchShortcut', () => {
  function ev(over: Partial<KeyEventLike> & { target?: EventTarget | null }) {
    return {
      ...key(over),
      target: over.target ?? null,
      preventDefault: vi.fn(),
      stopPropagation: vi.fn(),
    };
  }

  const undo: ShortcutEntry = { combo: 'mod+z', description: 'Undo', run: vi.fn(() => true) };

  it('claims a matched combo: runs, preventDefault + stopPropagation', () => {
    const run = vi.fn(() => true);
    const e = ev({ key: 'z', metaKey: true });
    const handled = dispatchShortcut(e, [{ combo: 'mod+z', description: 'Undo', run }], 'mac');
    expect(run).toHaveBeenCalledOnce();
    expect(e.preventDefault).toHaveBeenCalledOnce();
    expect(e.stopPropagation).toHaveBeenCalledOnce();
    expect(handled?.description).toBe('Undo');
  });

  it('input-focus guard: skips non-global entries when focus is editable', () => {
    const run = vi.fn(() => true);
    const e = ev({ key: 'z', metaKey: true, target: { tagName: 'INPUT' } as unknown as EventTarget });
    const handled = dispatchShortcut(e, [{ combo: 'mod+z', description: 'Undo', run }], 'mac');
    expect(handled).toBeNull();
    expect(run).not.toHaveBeenCalled();
    expect(e.preventDefault).not.toHaveBeenCalled();
  });

  it('global entries fire even inside an editable target', () => {
    const run = vi.fn(() => true);
    const e = ev({ key: 'z', metaKey: true, target: { tagName: 'INPUT' } as unknown as EventTarget });
    const handled = dispatchShortcut(e, [{ combo: 'mod+z', description: 'Undo', global: true, run }], 'mac');
    expect(handled?.description).toBe('Undo');
    expect(run).toHaveBeenCalledOnce();
  });

  it('no-op run (returns false) lets the key fall through — not claimed', () => {
    const run = vi.fn(() => false);
    const e = ev({ key: 'd', metaKey: true });
    const handled = dispatchShortcut(e, [{ combo: 'mod+d', description: 'Duplicate', run }], 'mac');
    expect(handled).toBeNull();
    expect(e.preventDefault).not.toHaveBeenCalled();
    expect(e.stopPropagation).not.toHaveBeenCalled();
  });

  it('returns null when nothing matches', () => {
    const e = ev({ key: 'x', metaKey: true });
    expect(dispatchShortcut(e, [undo], 'mac')).toBeNull();
  });
});

describe('describeShortcuts', () => {
  it('projects the registry to render-ready help data', () => {
    const registry: ShortcutEntry[] = [
      { combo: 'mod+z', description: 'Undo', run: () => true },
      { combo: 'mod+d', description: 'Duplicate selected node', run: () => true },
    ];
    expect(describeShortcuts(registry)).toEqual([
      { combo: 'mod+z', description: 'Undo' },
      { combo: 'mod+d', description: 'Duplicate selected node' },
    ]);
  });
});
