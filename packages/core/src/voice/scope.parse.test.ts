import { describe, expect, it } from 'vitest';
import { parseHoopTarget, type ParseHoopTargetOptions } from './scope';

// The single canonical parse replaced four hand-rolled copies (compositor, lab renderer,
// scope inspector, and this module's own scope intersection). Each kept a deliberate
// behavioural quirk; these are the union of all four sites' cases, pinned per option set.
// Hoop indices are 1-based (A1): hoop 1 is the first hoop; 0 and negatives are dropped.

const compositor: ParseHoopTargetOptions = { sourceDrumOnNoHash: true, emptyFallback: 'first', sort: false };
const inspector: ParseHoopTargetOptions = { sourceDrumOnNoHash: true, emptyFallback: 'none', sort: true };
const scope: ParseHoopTargetOptions = { sourceDrumOnNoHash: false, emptyFallback: 'sentinel', sort: true };

describe('parseHoopTarget — canonical scope-target grammar', () => {
  it('decodes a well-formed multi-hoop id the same way for every caller', () => {
    expect(parseHoopTarget('snare#1,3', 'kick', compositor)).toEqual({ drumId: 'snare', hoopIndices: [1, 3] });
    expect(parseHoopTarget('snare#1,3', 'kick', inspector)).toEqual({ drumId: 'snare', hoopIndices: [1, 3] });
    expect(parseHoopTarget('snare#1,3', 'kick', scope)).toEqual({ drumId: 'snare', hoopIndices: [1, 3] });
  });

  it('drops zero, negative, fractional, and non-numeric indices', () => {
    expect(parseHoopTarget('snare#2,0,-1,1.5,foo', 'kick', compositor)).toEqual({ drumId: 'snare', hoopIndices: [2] });
  });

  it('reads the drum id before the hash, falling back to the source drum when blank', () => {
    expect(parseHoopTarget('#1,2', 'kick', compositor)).toEqual({ drumId: 'kick', hoopIndices: [1, 2] });
    expect(parseHoopTarget('snare#1', null, compositor)).toEqual({ drumId: 'snare', hoopIndices: [1] });
  });

  describe('sort quirk', () => {
    it('preserves authoring order for the compositor / lab renderer', () => {
      expect(parseHoopTarget('snare#3,1,3', 'kick', compositor)).toEqual({ drumId: 'snare', hoopIndices: [3, 1] });
    });
    it('sorts ascending for the scope inspector and scope intersection', () => {
      expect(parseHoopTarget('snare#3,1,3', 'kick', inspector)).toEqual({ drumId: 'snare', hoopIndices: [1, 3] });
      expect(parseHoopTarget('snare#3,1,3', 'kick', scope)).toEqual({ drumId: 'snare', hoopIndices: [1, 3] });
    });
  });

  describe('empty-hoop fallback quirk', () => {
    // A `#` followed by a portion that parses to no valid index (all zero / negative / non-numeric).
    it('never renders nothing: compositor falls back to hoop [1]', () => {
      expect(parseHoopTarget('snare#x', 'kick', compositor)).toEqual({ drumId: 'snare', hoopIndices: [1] });
    });
    it('scope intersection uses the unmatchable [-1] sentinel so invalid refs light nothing', () => {
      expect(parseHoopTarget('snare#x', 'kick', scope)).toEqual({ drumId: 'snare', hoopIndices: [-1] });
    });
    it('the inspector leaves the hoop set empty for an explicit "none" selection', () => {
      expect(parseHoopTarget('snare#x', 'kick', inspector)).toEqual({ drumId: 'snare', hoopIndices: [] });
    });
  });

  describe('hash-less id quirk', () => {
    it('compositor / inspector short-circuit a hash-less id to the source drum, hoop [1]', () => {
      expect(parseHoopTarget('snare', 'kick', compositor)).toEqual({ drumId: 'kick', hoopIndices: [1] });
      expect(parseHoopTarget('snare', 'kick', inspector)).toEqual({ drumId: 'kick', hoopIndices: [1] });
    });
    it('scope intersection instead parses the drum id from the raw string (empty index → sentinel)', () => {
      expect(parseHoopTarget('snare', 'kick', scope)).toEqual({ drumId: 'snare', hoopIndices: [-1] });
    });
  });

  describe('absent id', () => {
    it('always falls back to the source drum, hoop [1]', () => {
      expect(parseHoopTarget(undefined, 'kick', compositor)).toEqual({ drumId: 'kick', hoopIndices: [1] });
      expect(parseHoopTarget(undefined, 'kick', inspector)).toEqual({ drumId: 'kick', hoopIndices: [1] });
      expect(parseHoopTarget(undefined, 'kick', scope)).toEqual({ drumId: 'kick', hoopIndices: [1] });
    });
  });
});
