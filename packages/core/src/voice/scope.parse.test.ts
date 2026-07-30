import { describe, expect, it } from 'vitest';
import { HOOP_TARGET_POLICIES, encodeHoopTarget, intersectScopeTargets, parseHoopTarget } from './scope';

// The single canonical parse replaced the hand-rolled copies (compositor, scope inspector, and
// this module's own scope intersection). Each kept a deliberate behavioural quirk; these are the
// union of every site's cases, pinned per policy.
// Hoop indices are 1-based (A1): hoop 1 is the first hoop; 0 and negatives are dropped.
//
// INIT-06 S2: these three names are no longer local literals — they are the EXPORTED presets every
// production call site now passes. That makes this suite the assertion that the presets equal what
// the callers expect: if a preset drifts, the quirk tests below fail rather than a caller silently
// changing behaviour.
const { compositor, inspector, resolver: scope } = HOOP_TARGET_POLICIES;

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

describe('encodeHoopTarget — the single hoop-target encoder', () => {
  it('dedupes, drops indices below 1, and sorts ascending', () => {
    expect(encodeHoopTarget('snare', [3, 1, 3])).toBe('snare#1,3');
    expect(encodeHoopTarget('snare', [2, 0, -1, 1.5])).toBe('snare#2'); // 1-based (A1)
  });

  it('round-trips through the inspector policy', () => {
    expect(parseHoopTarget(encodeHoopTarget('snare', [3, 1]), 'kick', inspector)).toEqual({
      drumId: 'snare',
      hoopIndices: [1, 3],
    });
  });

  // PARITY HAZARD (INIT-06 S2). encodeHoopTarget and fromPixelSet share formatHoopTarget, but
  // fromPixelSet deliberately does NOT normalise: the resolver policy's `[-1]` sentinel is a
  // legitimate hoop set there, and encodeHoopTarget's `>= 1` filter would silently erase it into a
  // bare `"snare#"` — which then reparses as "no valid index" and, under the compositor policy,
  // falls back to lighting hoop 1. Intersecting two invalid hoop refs is the reachable path.
  it('does not let the sentinel hoop set leak through the normalising encoder', () => {
    const intersected = intersectScopeTargets(
      { scope: 'hoop', targetId: 'snare#x' },
      { scope: 'hoop', targetId: 'snare#y' },
      'kick',
    );
    expect(intersected).toEqual({ scope: 'hoop', targetId: 'snare#-1' }); // NOT 'snare#'
    // and the sentinel still reads back as unmatchable rather than as hoop 1
    expect(parseHoopTarget('snare#-1', 'kick', scope)).toEqual({ drumId: 'snare', hoopIndices: [-1] });
    expect(encodeHoopTarget('snare', [-1])).toBe('snare#'); // the erasure this test exists to prevent
  });

  // CHARACTERISATION, not a fix (see INIT-06 open question 1, owner: trent). The wire form
  // `"<drumId>#<h>[,<h>]"` has no escaping, so a drumId containing '#' does not round-trip: the
  // parse splits on the FIRST '#', so the tail of the drum id is read as the hoop portion, fails to
  // parse as a number, and collapses to the policy's empty fallback. Whether this is a live bug or
  // theoretical depends on whether the kit editor constrains drum ids — undecided, so this pins
  // TODAY'S WRONG BEHAVIOUR rather than changing it. Deliberately NOT accompanied by a new
  // TriggerGraphIssueCode: that would flow through normalizeTriggerGraphToGen3 into hydrate's
  // user-visible issue list and start warning on graphs that are silent today.
  it('documents-unescaped-drumid-limitation', () => {
    const encoded = encodeHoopTarget('kick#weird', [1]);
    expect(encoded).toBe('kick#weird#1');
    // WRONG, and pinned as wrong: the drum id loses its tail and the hoop selection is lost.
    expect(parseHoopTarget(encoded, 'kick', scope)).toEqual({ drumId: 'kick', hoopIndices: [-1] });
    expect(parseHoopTarget(encoded, 'kick', compositor)).toEqual({ drumId: 'kick', hoopIndices: [1] });
    // A ',' in a drum id is harmless by contrast — the split happens only after the '#'.
    expect(parseHoopTarget(encodeHoopTarget('kick,left', [2]), 'kick', scope)).toEqual({
      drumId: 'kick,left',
      hoopIndices: [2],
    });
  });
});
