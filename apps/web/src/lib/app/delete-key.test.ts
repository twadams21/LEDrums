import { describe, expect, it } from 'vitest';
import { decideDeleteKey, isDeleteKey, type DeleteKeyInput } from './delete-key';
import { isEditableShortcutTarget } from './primary-shortcut';

/** Decide as App.svelte does: derive `isEditableTarget` from the real predicate. */
function decideFor(
  key: string,
  target: unknown,
  rest: Pick<DeleteKeyInput, 'selection' | 'resolvedNode'>,
) {
  return decideDeleteKey({
    key,
    isEditableTarget: isEditableShortcutTarget(target as EventTarget),
    ...rest,
  });
}

const canvas = { tagName: 'DIV', closest: () => null };

describe('isDeleteKey', () => {
  it('covers Backspace and forward Delete only', () => {
    expect(isDeleteKey('Backspace')).toBe(true);
    expect(isDeleteKey('Delete')).toBe(true);
    expect(isDeleteKey('Escape')).toBe(false);
    expect(isDeleteKey('d')).toBe(false);
  });
});

describe('decideDeleteKey', () => {
  it('claims the key while deleting a wire (nothing selected) so WebKit cannot navigate back', () => {
    // Clicking a wire never sets a shell selection — the old guard fell through here and
    // Backspace ran WebKit's history-back, stranding the desktop app on the boot shell.
    expect(decideFor('Backspace', canvas, { selection: null, resolvedNode: null })).toEqual({
      prevent: true,
      removeNode: false,
    });
  });

  it('claims the key for a selected trigger node without removing it', () => {
    expect(
      decideFor('Backspace', canvas, {
        selection: { kind: 'node' },
        resolvedNode: { kind: 'trigger' },
      }),
    ).toEqual({ prevent: true, removeNode: false });
  });

  it('claims the key and removes a selected regular node', () => {
    expect(
      decideFor('Backspace', canvas, {
        selection: { kind: 'node' },
        resolvedNode: { kind: 'effect' },
      }),
    ).toEqual({ prevent: true, removeNode: true });
  });

  it('claims the key but removes nothing when the selection is not a graph node', () => {
    expect(
      decideFor('Backspace', canvas, {
        selection: { kind: 'section' },
        resolvedNode: { kind: 'effect' },
      }),
    ).toEqual({ prevent: true, removeNode: false });
  });

  it('claims the key when a node selection resolves to nothing (stale id)', () => {
    expect(
      decideFor('Backspace', canvas, { selection: { kind: 'node' }, resolvedNode: null }),
    ).toEqual({ prevent: true, removeNode: false });
  });

  it('leaves the key alone inside an input', () => {
    expect(
      decideFor('Backspace', { tagName: 'INPUT' }, {
        selection: { kind: 'node' },
        resolvedNode: { kind: 'effect' },
      }),
    ).toEqual({ prevent: false, removeNode: false });
  });

  it('leaves the key alone inside a contenteditable element', () => {
    expect(
      decideFor('Backspace', { isContentEditable: true }, {
        selection: { kind: 'node' },
        resolvedNode: { kind: 'effect' },
      }),
    ).toEqual({ prevent: false, removeNode: false });
  });

  it('treats forward Delete exactly like Backspace', () => {
    expect(decideFor('Delete', canvas, { selection: null, resolvedNode: null })).toEqual({
      prevent: true,
      removeNode: false,
    });
    expect(
      decideFor('Delete', canvas, {
        selection: { kind: 'node' },
        resolvedNode: { kind: 'effect' },
      }),
    ).toEqual({ prevent: true, removeNode: true });
  });

  it('ignores every other key', () => {
    expect(
      decideFor('a', canvas, { selection: { kind: 'node' }, resolvedNode: { kind: 'effect' } }),
    ).toEqual({ prevent: false, removeNode: false });
  });
});
