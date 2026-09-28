import { describe, expect, it, vi } from 'vitest';
import { claimPerformanceKey, decidePerformanceKey, type PerformanceKeyInput } from './performance-key';

/* The graph-digit bank is view-INDEPENDENT: authoring a graph means firing it to hear it, so
   the digits work wherever you are. What keeps them safe outside Perform is the accessibility
   yield set below, not a view gate. Section arrows stay Perform-only. Every app-owned decision
   is also tested through the claim seam because capture-phase handling without both calls
   causes double action. */

const at = (over: Partial<PerformanceKeyInput> = {}): PerformanceKeyInput => ({
  key: '1',
  view: 'perform',
  settingsOpen: false,
  isEditableTarget: false,
  inOpenPopup: false,
  inKeyboardControl: false,
  inFlowCanvas: false,
  ctrlKey: false,
  metaKey: false,
  altKey: false,
  shiftKey: false,
  repeat: false,
  ...over,
});

describe('decidePerformanceKey — Perform ownership', () => {
  it('fires 1–9 and 0 as graph indexes and claims each event', () => {
    expect(decidePerformanceKey(at({ key: '1' }))).toEqual({ fireGraphIndex: 0, claim: true });
    expect(decidePerformanceKey(at({ key: '9' }))).toEqual({ fireGraphIndex: 8, claim: true });
    expect(decidePerformanceKey(at({ key: '0' }))).toEqual({ fireGraphIndex: 9, claim: true });
  });

  it('steps sections from the live surface and claims the arrows', () => {
    expect(decidePerformanceKey(at({ key: 'ArrowRight' }))).toEqual({ sectionStep: 1, claim: true });
    expect(decidePerformanceKey(at({ key: 'ArrowLeft' }))).toEqual({ sectionStep: -1, claim: true });
  });

  it('claims an owned event with both preventDefault and stopPropagation', () => {
    const event = { preventDefault: vi.fn(), stopPropagation: vi.fn() };
    claimPerformanceKey(event, decidePerformanceKey(at({ key: '4' })));
    expect(event.preventDefault).toHaveBeenCalledOnce();
    expect(event.stopPropagation).toHaveBeenCalledOnce();
  });
});

describe('decidePerformanceKey — accessibility owners', () => {
  it.each([
    ['editable text', { isEditableTarget: true }],
    ['an open combobox/listbox/select', { inOpenPopup: true }],
    ['a radio/toggle/segmented/slider control, for its arrows', { inKeyboardControl: true, key: 'ArrowRight' }],
    ['the graph canvas', { inFlowCanvas: true, key: 'ArrowRight' }],
  ])('yields to %s', (_surface, input) => {
    expect(decidePerformanceKey(at(input))).toEqual({ claim: false });
  });

  it('keeps graph-canvas digits available to the live Perform bank', () => {
    expect(decidePerformanceKey(at({ key: '2', inFlowCanvas: true }))).toEqual({ fireGraphIndex: 1, claim: true });
  });

  it('does not claim Enter or Escape, including after a numeric edit', () => {
    for (const key of ['Enter', 'Escape']) {
      expect(decidePerformanceKey(at({ key, isEditableTarget: true }))).toEqual({ claim: false });
    }
  });

  it('never steals arrows from a focused control', () => {
    for (const key of ['ArrowLeft', 'ArrowRight']) {
      expect(decidePerformanceKey(at({ key, inKeyboardControl: true }))).toEqual({ claim: false });
    }
  });

  it('fires digits through a focused slider / segmented / toggle / closed dropdown — none uses them', () => {
    // Clicking a control leaves it focused; the digit bank used to go dead until you clicked away.
    expect(decidePerformanceKey(at({ key: '4', inKeyboardControl: true }))).toEqual({ fireGraphIndex: 3, claim: true });
    expect(decidePerformanceKey(at({ key: '0', inKeyboardControl: true, view: 'trigger' }))).toEqual({ fireGraphIndex: 9, claim: true });
    // A held digit still repeats to nobody.
    expect(decidePerformanceKey(at({ key: '4', inKeyboardControl: true, repeat: true }))).toEqual({ claim: false });
  });
});

describe('decidePerformanceKey — context boundaries', () => {
  it('fires graph digits in every authoring view — the author must be able to hear the graph', () => {
    for (const view of ['objects', 'sections', 'trigger', 'monitor'] as const) {
      expect(decidePerformanceKey(at({ view, key: '1' }))).toEqual({ fireGraphIndex: 0, claim: true });
      expect(decidePerformanceKey(at({ view, key: '0' }))).toEqual({ fireGraphIndex: 9, claim: true });
    }
  });

  it('fires graph digits over the trigger graph canvas, where authoring actually happens', () => {
    expect(decidePerformanceKey(at({ view: 'trigger', key: '3', inFlowCanvas: true }))).toEqual({
      fireGraphIndex: 2,
      claim: true,
    });
  });

  it('still yields authoring-view digits to a field being typed in, or an open list', () => {
    for (const owner of [{ isEditableTarget: true }, { inOpenPopup: true }]) {
      expect(decidePerformanceKey(at({ view: 'trigger', key: '1', ...owner }))).toEqual({ claim: false });
    }
  });

  it('keeps section arrows to Perform — authoring views own their arrows', () => {
    for (const view of ['objects', 'sections', 'trigger', 'monitor'] as const) {
      expect(decidePerformanceKey(at({ view, key: 'ArrowRight' }))).toEqual({ claim: false });
      expect(decidePerformanceKey(at({ view, key: 'ArrowLeft' }))).toEqual({ claim: false });
    }
  });

  it('does nothing behind Settings', () => {
    expect(decidePerformanceKey(at({ settingsOpen: true, key: '1' }))).toEqual({ claim: false });
    expect(decidePerformanceKey(at({ settingsOpen: true, key: 'ArrowRight' }))).toEqual({ claim: false });
  });

  it('does not claim unrelated keys', () => {
    for (const key of ['a', 'ArrowUp', 'Backspace', ' ']) {
      expect(decidePerformanceKey(at({ key }))).toEqual({ claim: false });
    }
  });

  it('yields every modified chord', () => {
    for (const modifier of ['ctrlKey', 'metaKey', 'altKey', 'shiftKey'] as const) {
      expect(decidePerformanceKey(at({ key: '1', [modifier]: true }))).toEqual({ claim: false });
      expect(decidePerformanceKey(at({ key: 'ArrowRight', [modifier]: true }))).toEqual({ claim: false });
    }
  });

  it('suppresses repeated graph digits but deliberately repeats section arrows', () => {
    expect(decidePerformanceKey(at({ key: '1', repeat: true }))).toEqual({ claim: false });
    expect(decidePerformanceKey(at({ key: 'ArrowRight', repeat: true }))).toEqual({ sectionStep: 1, claim: true });
  });
});
