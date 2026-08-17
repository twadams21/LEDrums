import { describe, expect, it } from 'vitest';
import {
  availableFaceParams,
  cycleChoice,
  faceChoice,
  faceNumber,
  faceParamValue,
  formatFaceValue,
  isModulatable,
  isParamOnFace,
  nodeParamSpecs,
  type FaceParamSpec,
} from './face-params';
import { makeNode, type EffectDef } from '../sim';

/* The face-param layer (S5): the ONE normalized param list behind both the node-face rows and
   the inspector's expose affordance. The point of these tests is the widening — a face row may
   be an enum or a bool, which `modTargetSpecs` (numbers only) can never surface — and the two
   spec dialects (effect `kind` / modifier `type`) folding into one shape. */

const effect: EffectDef = {
  id: 'swirl',
  name: 'Swirl',
  busId: 'b',
  scope: 'kit',
  attackMs: 0,
  sustainMs: 0,
  releaseMs: 0,
  params: [
    { key: 'size', label: 'Size', kind: 'number', min: 0, max: 1, step: 0.01, default: 0.5 },
    { key: 'hue', label: 'Hue', kind: 'number', min: 0, max: 360, unit: '°', default: 0 },
    { key: 'blend', label: 'Blend', kind: 'enum', options: ['add', 'over'], default: 'add' },
    { key: 'mirror', label: 'Mirror', kind: 'bool', default: false },
  ],
};

const specOf = (key: string): FaceParamSpec => nodeParamSpecs(makeNode('play', 'p'), effect).find((s) => s.key === key)!;

describe('nodeParamSpecs', () => {
  it('returns EVERY declared param of a play node — not only the modulatable numbers', () => {
    const specs = nodeParamSpecs(makeNode('play', 'p'), effect);
    expect(specs.map((s) => s.key)).toEqual(['size', 'hue', 'blend', 'mirror']);
    expect(specs.map((s) => s.kind)).toEqual(['number', 'number', 'enum', 'bool']);
  });

  it('carries the control metadata the face needs (range, step, unit, options, default)', () => {
    expect(specOf('size')).toEqual({
      key: 'size',
      label: 'Size',
      kind: 'number',
      min: 0,
      max: 1,
      step: 0.01,
      unit: undefined,
      options: undefined,
      default: 0.5,
    });
    expect(specOf('blend').options).toEqual(['add', 'over']);
    expect(specOf('hue').unit).toBe('°');
  });

  it('folds the modifier registry dialect (`type`) into the same `kind` field', () => {
    const specs = nodeParamSpecs(makeNode('modifier', 'm', 0, 0, { modifierId: 'trail' }), undefined);
    expect(specs.length).toBeGreaterThan(0);
    for (const s of specs) expect(['number', 'bool', 'enum', 'color']).toContain(s.kind);
    // trail declares a numeric decay and an enum mode — both must surface, unlike modTargetSpecs
    expect(specs.map((s) => s.key)).toContain('mode');
    expect(specs.find((s) => s.key === 'mode')?.kind).toBe('enum');
  });

  it('is empty for a play node with no resolved effect, and for a non-param kind', () => {
    expect(nodeParamSpecs(makeNode('play', 'p'), undefined)).toEqual([]);
    expect(nodeParamSpecs(makeNode('random', 'r'), effect)).toEqual([]);
  });
});

describe('isParamOnFace / availableFaceParams', () => {
  it('reads the SAME `modInputs` list the modulation section uses', () => {
    const node = makeNode('play', 'p', 0, 0, { modInputs: [{ param: 'size' }] });
    expect(isParamOnFace(node, 'size')).toBe(true);
    expect(isParamOnFace(node, 'hue')).toBe(false);
  });

  it('offers every declared param not yet on the face, INCLUDING enum and bool', () => {
    const node = makeNode('play', 'p', 0, 0, { modInputs: [{ param: 'size' }] });
    expect(availableFaceParams(node, effect)).toEqual([
      { key: 'hue', label: 'Hue' },
      { key: 'blend', label: 'Blend' },
      { key: 'mirror', label: 'Mirror' },
    ]);
  });
});

describe('isModulatable', () => {
  it('is true only for numbers — an enum / bool row carries no wire handle', () => {
    expect(isModulatable(specOf('size'))).toBe(true);
    expect(isModulatable(specOf('blend'))).toBe(false);
    expect(isModulatable(specOf('mirror'))).toBe(false);
    expect(isModulatable(undefined)).toBe(false);
  });
});

describe('faceParamValue / faceNumber / faceChoice', () => {
  it('falls back to the spec default for a param the node has never written', () => {
    expect(faceParamValue(specOf('size'), {})).toBe(0.5);
    expect(faceParamValue(specOf('size'), { size: 0.2 })).toBe(0.2);
    expect(faceParamValue(specOf('mirror'), undefined)).toBe(false);
  });

  it('coerces a wrong-typed persisted value back to something the control can render', () => {
    expect(faceNumber(specOf('size'), { size: 'nope' as unknown as number })).toBe(0.5);
    expect(faceChoice(specOf('blend'), { blend: 'gone' })).toBe('add');
    expect(faceChoice(specOf('blend'), { blend: 'over' })).toBe('over');
  });
});

describe('cycleChoice', () => {
  it('walks forward and wraps', () => {
    expect(cycleChoice(['a', 'b', 'c'], 'a')).toBe('b');
    expect(cycleChoice(['a', 'b', 'c'], 'c')).toBe('a');
  });
  it('walks backward and wraps', () => {
    expect(cycleChoice(['a', 'b', 'c'], 'a', -1)).toBe('c');
    expect(cycleChoice(['a', 'b', 'c'], 'b', -1)).toBe('a');
  });
  it('starts from the first option when the current value is not in the list', () => {
    expect(cycleChoice(['a', 'b'], 'zzz')).toBe('b');
  });
  it('is a no-op for a degenerate enum (so a click never stacks a spurious undo)', () => {
    expect(cycleChoice(['only'], 'only')).toBe('only');
    expect(cycleChoice([], 'x')).toBe('x');
  });
});

describe('formatFaceValue', () => {
  it('honours the step precision and drops trailing zeros', () => {
    expect(formatFaceValue(specOf('size'), 0.5)).toBe('0.5');
    expect(formatFaceValue(specOf('size'), 0.25)).toBe('0.25');
  });
  it('rounds a step-less / integer-stepped number and appends its unit', () => {
    expect(formatFaceValue(specOf('hue'), 180.4)).toBe('180°');
  });
  it('renders a bool as on/off and an enum as its choice', () => {
    expect(formatFaceValue(specOf('mirror'), true)).toBe('on');
    expect(formatFaceValue(specOf('mirror'), false)).toBe('off');
    expect(formatFaceValue(specOf('blend'), 'over')).toBe('over');
  });
});
