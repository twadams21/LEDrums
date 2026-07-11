import { describe, expect, it } from 'vitest';
import { parseHoopTarget, type ParseHoopTargetOptions } from './scope';

// The single canonical parse replaced four hand-rolled copies (compositor, lab renderer,
// scope inspector, and this module's own scope intersection). Each kept a deliberate
// behavioural quirk; these are the union of all four sites' cases, pinned per option set.

const compositor: ParseHoopTargetOptions = { sourceDrumOnNoHash: true, emptyFallback: 'zero', sort: false };
const inspector: ParseHoopTargetOptions = { sourceDrumOnNoHash: true, emptyFallback: 'none', sort: true };
const scope: ParseHoopTargetOptions = { sourceDrumOnNoHash: false, emptyFallback: 'sentinel', sort: true };

describe('parseHoopTarget — canonical scope-target grammar', () => {
  it('decodes a well-formed multi-hoop id the same way for every caller', () => {
    expect(parseHoopTarget('snare#0,3', 'kick', compositor)).toEqual({ drumId: 'snare', hoopIndices: [0, 3] });
    expect(parseHoopTarget('snare#0,3', 'kick', inspector)).toEqual({ drumId: 'snare', hoopIndices: [0, 3] });
    expect(parseHoopTarget('snare#0,3', 'kick', scope)).toEqual({ drumId: 'snare', hoopIndices: [0, 3] });
  });

  it('drops negative, fractional, and non-numeric indices', () => {
    expect(parseHoopTarget('snare#2,-1,1.5,foo', 'kick', compositor)).toEqual({ drumId: 'snare', hoopIndices: [2] });
  });

  it('reads the drum id before the hash, falling back to the source drum when blank', () => {
    expect(parseHoopTarget('#0,2', 'kick', compositor)).toEqual({ drumId: 'kick', hoopIndices: [0, 2] });
    expect(parseHoopTarget('snare#0', null, compositor)).toEqual({ drumId: 'snare', hoopIndices: [0] });
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
    // A `#` followed by a portion that parses to no valid index (all negative / non-numeric).
    it('never renders nothing: compositor falls back to hoop [0]', () => {
      expect(parseHoopTarget('snare#x', 'kick', compositor)).toEqual({ drumId: 'snare', hoopIndices: [0] });
    });
    it('scope intersection uses the unmatchable [-1] sentinel so invalid refs light nothing', () => {
      expect(parseHoopTarget('snare#x', 'kick', scope)).toEqual({ drumId: 'snare', hoopIndices: [-1] });
    });
    it('the inspector leaves the hoop set empty for an explicit "none" selection', () => {
      expect(parseHoopTarget('snare#x', 'kick', inspector)).toEqual({ drumId: 'snare', hoopIndices: [] });
    });
  });

  describe('hash-less id quirk', () => {
    it('compositor / inspector short-circuit a hash-less id to the source drum, hoop [0]', () => {
      expect(parseHoopTarget('snare', 'kick', compositor)).toEqual({ drumId: 'kick', hoopIndices: [0] });
      expect(parseHoopTarget('snare', 'kick', inspector)).toEqual({ drumId: 'kick', hoopIndices: [0] });
    });
    it('scope intersection instead parses the drum id from the raw string', () => {
      expect(parseHoopTarget('snare', 'kick', scope)).toEqual({ drumId: 'snare', hoopIndices: [0] });
    });
  });

  describe('absent id', () => {
    it('always falls back to the source drum, hoop [0]', () => {
      expect(parseHoopTarget(undefined, 'kick', compositor)).toEqual({ drumId: 'kick', hoopIndices: [0] });
      expect(parseHoopTarget(undefined, 'kick', inspector)).toEqual({ drumId: 'kick', hoopIndices: [0] });
      expect(parseHoopTarget(undefined, 'kick', scope)).toEqual({ drumId: 'kick', hoopIndices: [0] });
    });
  });
});
