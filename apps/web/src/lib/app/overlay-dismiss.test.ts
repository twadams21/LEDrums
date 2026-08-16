import { describe, expect, it } from 'vitest';
import { isModalDialogOpen, shouldDismissOnEscape } from './overlay-dismiss';

describe('shouldDismissOnEscape', () => {
  const base = { key: 'Escape', isEditableTarget: false, modalOpen: false };

  it('dismisses on a bare Escape', () => {
    expect(shouldDismissOnEscape(base)).toBe(true);
  });

  it('ignores every other key', () => {
    for (const key of ['Enter', 'Backspace', 'e', 'Esc', '']) {
      expect(shouldDismissOnEscape({ ...base, key })).toBe(false);
    }
  });

  it('leaves Escape to an editable target (CommitInput reverts, then blurs)', () => {
    expect(shouldDismissOnEscape({ ...base, isEditableTarget: true })).toBe(false);
  });

  it('leaves Escape to an open modal — it paints above this overlay', () => {
    expect(shouldDismissOnEscape({ ...base, modalOpen: true })).toBe(false);
  });

  it('stays closed when both guards apply', () => {
    expect(shouldDismissOnEscape({ ...base, isEditableTarget: true, modalOpen: true })).toBe(false);
  });
});

describe('isModalDialogOpen', () => {
  it('is true when a role=dialog node exists', () => {
    expect(isModalDialogOpen({ querySelector: () => ({}) })).toBe(true);
  });

  it('is false when the query finds nothing', () => {
    expect(isModalDialogOpen({ querySelector: () => null })).toBe(false);
  });

  it('asks for the role every Dialog.svelte modal renders', () => {
    let asked = '';
    isModalDialogOpen({
      querySelector: (s) => {
        asked = s;
        return null;
      },
    });
    expect(asked).toBe('[role="dialog"]');
  });
});
