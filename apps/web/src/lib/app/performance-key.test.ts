import { describe, expect, it, vi } from 'vitest';
import { claimPerformanceKey, decidePerformanceKey, type PerformanceKeyInput } from './performance-key';

/* The performance bank is deliberately view-aware. Perform is the live context from PRODUCT.md;
   authoring controls keep their own keyboard contracts. Every app-owned decision is also tested
   through the claim seam because capture-phase handling without both calls causes double action. */

const at = (over: Partial<PerformanceKeyInput> = {}): PerformanceKeyInput => ({
  key: '1',
  view: 'perform',
  settingsOpen: false,
  isEditableTarget: false,
  inOpenPopup: false,
  inKeyboardControl: false,
  inFlowCanvas: false,
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
    ['a radio/toggle/segmented control', { inKeyboardControl: true }],
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

  it('never steals repeated keys from a focused control', () => {
    for (const key of ['1', 'ArrowLeft', 'ArrowRight', '0']) {
      expect(decidePerformanceKey(at({ key, inKeyboardControl: true }))).toEqual({ claim: false });
    }
  });
});

describe('decidePerformanceKey — context boundaries', () => {
  it('does nothing in authoring views, even when focus is on a non-editable surface', () => {
    for (const view of ['objects', 'sections', 'trigger', 'monitor'] as const) {
      expect(decidePerformanceKey(at({ view, key: '1' }))).toEqual({ claim: false });
      expect(decidePerformanceKey(at({ view, key: 'ArrowRight' }))).toEqual({ claim: false });
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
});
