import { describe, expect, it } from 'vitest';
import { decideMapModeKey, isBindableKey, isMapModeToggle, type MapKeyEvent } from './map-keys';

const ev = (code: string, init: Partial<MapKeyEvent> = {}): MapKeyEvent => ({
  code,
  key: init.key ?? code.replace(/^Key/, '').toLowerCase(),
  ctrlKey: false,
  metaKey: false,
  shiftKey: false,
  altKey: false,
  repeat: false,
  ...init,
});

describe('decideMapModeKey', () => {
  it('learns a plain key by its code', () => {
    expect(decideMapModeKey(ev('KeyQ'), 'mac')).toEqual({ kind: 'learn', code: 'KeyQ' });
    expect(decideMapModeKey(ev('Digit1', { key: '1' }), 'mac')).toEqual({ kind: 'learn', code: 'Digit1' });
    expect(decideMapModeKey(ev('Space', { key: ' ' }), 'other')).toEqual({ kind: 'learn', code: 'Space' });
  });

  it('Escape exits, Delete / Backspace clear', () => {
    expect(decideMapModeKey(ev('Escape', { key: 'Escape' }), 'mac')).toEqual({ kind: 'exit' });
    expect(decideMapModeKey(ev('Backspace', { key: 'Backspace' }), 'mac')).toEqual({ kind: 'clear' });
    expect(decideMapModeKey(ev('Delete', { key: 'Delete' }), 'mac')).toEqual({ kind: 'clear' });
  });

  it('the platform chord toggles; the other platform’s modifier does not', () => {
    expect(decideMapModeKey(ev('KeyM', { key: 'm', metaKey: true }), 'mac')).toEqual({ kind: 'toggle' });
    expect(decideMapModeKey(ev('KeyM', { key: 'm', ctrlKey: true }), 'other')).toEqual({ kind: 'toggle' });
    expect(decideMapModeKey(ev('KeyM', { key: 'm', ctrlKey: true }), 'mac')).toEqual({ kind: 'pass' });
  });

  it('passes modified chords, Tab and bare modifiers to the app (Undo, focus navigation)', () => {
    expect(decideMapModeKey(ev('KeyZ', { key: 'z', metaKey: true }), 'mac')).toEqual({ kind: 'pass' });
    expect(decideMapModeKey(ev('KeyQ', { key: 'Q', shiftKey: true }), 'mac')).toEqual({ kind: 'pass' });
    expect(decideMapModeKey(ev('Tab', { key: 'Tab' }), 'mac')).toEqual({ kind: 'pass' });
    expect(decideMapModeKey(ev('ShiftLeft', { key: 'Shift', shiftKey: true }), 'mac')).toEqual({ kind: 'pass' });
  });

  it('swallows a held key’s repeats rather than re-learning', () => {
    expect(decideMapModeKey(ev('KeyQ', { repeat: true }), 'mac')).toEqual({ kind: 'swallow' });
  });
});

describe('isBindableKey / isMapModeToggle', () => {
  it('only plain, non-reserved keys are bindable', () => {
    expect(isBindableKey(ev('KeyA'))).toBe(true);
    expect(isBindableKey(ev('KeyA', { altKey: true }))).toBe(false);
    expect(isBindableKey(ev('Escape'))).toBe(false);
    expect(isBindableKey(ev(''))).toBe(false);
  });

  it('matches mod+m exactly', () => {
    expect(isMapModeToggle(ev('KeyM', { key: 'm', metaKey: true }), 'mac')).toBe(true);
    expect(isMapModeToggle(ev('KeyM', { key: 'm', metaKey: true, shiftKey: true }), 'mac')).toBe(false);
    expect(isMapModeToggle(ev('KeyM', { key: 'm' }), 'mac')).toBe(false);
  });
});
