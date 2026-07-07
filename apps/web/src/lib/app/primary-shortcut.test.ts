import { describe, expect, it } from 'vitest';
import { hasPrimaryModifier, isEditableShortcutTarget, platformShortcutModifier } from './primary-shortcut';

describe('platformShortcutModifier', () => {
  it('maps macOS-like platforms to Cmd', () => {
    expect(platformShortcutModifier('MacIntel')).toBe('mac');
    expect(platformShortcutModifier('iPad')).toBe('mac');
  });

  it('maps Windows/Linux platforms to Ctrl', () => {
    expect(platformShortcutModifier('Win32')).toBe('other');
    expect(platformShortcutModifier('Linux x86_64')).toBe('other');
  });
});

describe('hasPrimaryModifier', () => {
  it('accepts Cmd on macOS and rejects Ctrl-only', () => {
    expect(hasPrimaryModifier({ metaKey: true, ctrlKey: false }, 'mac')).toBe(true);
    expect(hasPrimaryModifier({ metaKey: false, ctrlKey: true }, 'mac')).toBe(false);
  });

  it('accepts Ctrl on Windows/Linux and rejects Cmd-only', () => {
    expect(hasPrimaryModifier({ metaKey: false, ctrlKey: true }, 'other')).toBe(true);
    expect(hasPrimaryModifier({ metaKey: true, ctrlKey: false }, 'other')).toBe(false);
  });
});

describe('isEditableShortcutTarget', () => {
  it('detects direct form fields and contenteditable nodes', () => {
    expect(isEditableShortcutTarget({ tagName: 'INPUT' } as unknown as EventTarget)).toBe(true);
    expect(isEditableShortcutTarget({ tagName: 'textarea' } as unknown as EventTarget)).toBe(true);
    expect(isEditableShortcutTarget({ isContentEditable: true } as unknown as EventTarget)).toBe(true);
  });

  it('detects descendants of editable controls', () => {
    const child = { closest: (selector: string) => (selector.includes('textarea') ? {} : null) } as unknown as EventTarget;
    expect(isEditableShortcutTarget(child)).toBe(true);
  });

  it('allows non-editable shortcut targets', () => {
    expect(isEditableShortcutTarget(null)).toBe(false);
    expect(isEditableShortcutTarget({ tagName: 'BUTTON', closest: () => null } as unknown as EventTarget)).toBe(false);
  });
});
