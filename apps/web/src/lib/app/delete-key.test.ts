import { describe, expect, it } from 'vitest';
import { decideDeleteKey, isDeleteKey } from './delete-key';
import { isEditableShortcutTarget } from './primary-shortcut';

/** Decide as App.svelte does: derive `isEditableTarget` from the real predicate. */
function decideFor(key: string, target: unknown) {
  return decideDeleteKey({ key, isEditableTarget: isEditableShortcutTarget(target as EventTarget) });
}

const surface = { tagName: 'DIV', closest: () => null };

describe('isDeleteKey', () => {
  it('covers Backspace and forward Delete only', () => {
    expect(isDeleteKey('Backspace')).toBe(true);
    expect(isDeleteKey('Delete')).toBe(true);
    expect(isDeleteKey('Escape')).toBe(false);
    expect(isDeleteKey('d')).toBe(false);
  });
});

describe('decideDeleteKey', () => {
  it('claims Backspace outside editable text so WebKit cannot navigate back', () => {
    expect(decideFor('Backspace', surface)).toEqual({ prevent: true });
  });

  it('treats forward Delete exactly like Backspace', () => {
    expect(decideFor('Delete', surface)).toEqual({ prevent: true });
  });

  it('leaves the key alone inside an input', () => {
    expect(decideFor('Backspace', { tagName: 'INPUT' })).toEqual({ prevent: false });
  });

  it('leaves the key alone inside a contenteditable element', () => {
    expect(decideFor('Backspace', { isContentEditable: true })).toEqual({ prevent: false });
  });

  it('ignores every other key', () => {
    expect(decideFor('a', surface)).toEqual({ prevent: false });
  });
});
