import { describe, expect, it } from 'vitest';
import { hotkeyLabel } from './graph-card-hotkey';

describe('hotkeyLabel', () => {
  it('labels the first nine cards 1–9', () => {
    expect(hotkeyLabel(0)).toBe('1');
    expect(hotkeyLabel(4)).toBe('5');
    expect(hotkeyLabel(8)).toBe('9');
  });

  it("labels the tenth card 0 (the global handler maps '0' back to index 9)", () => {
    expect(hotkeyLabel(9)).toBe('0');
  });

  it('gives no hotkey beyond the tenth card', () => {
    expect(hotkeyLabel(10)).toBeNull();
    expect(hotkeyLabel(42)).toBeNull();
  });

  it('gives no hotkey for a negative index', () => {
    expect(hotkeyLabel(-1)).toBeNull();
  });
});
