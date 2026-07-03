import { describe, expect, it } from 'vitest';
import type { ParamSpec } from '../../trigger-lab/sim';
import {
  KIND_OPTS,
  MIDI_OPTS,
  MODE_OPTS,
  POLY_OPTS,
  PROTOCOL_OPTS,
  RGB_OPTS,
  SOURCE_OPTS,
  SWITCH_OPTS,
  VALUEMODE_OPTS,
  fmt,
  fmtSpan,
  num,
  pct,
  uLabel,
} from './node-options';
import { NODE_KINDS, type BlockKind } from '../../trigger-lab/sim';
import { kindIcon, kindLabel, tint } from './trigger-node-meta';
import { voice } from '@ledrums/core';

/* The shared node form-options + formatters, tested as pure logic (no DOM) — the same
   way the rest of the suite tests pure helpers. The arrays must keep the exact options,
   order and labels the Inspector / SegmentedControls relied on before extraction (S1.3). */

const spec = (over: Partial<ParamSpec> = {}): ParamSpec => ({
  key: 'k',
  label: 'K',
  kind: 'number',
  default: 0,
  ...over,
});

describe('pct', () => {
  it('renders a 0–1 ratio as a rounded whole percent', () => {
    expect(pct(0)).toBe('0%');
    expect(pct(0.5)).toBe('50%');
    expect(pct(1)).toBe('100%');
    expect(pct(0.333)).toBe('33%'); // rounds
    expect(pct(0.005)).toBe('1%'); // rounds half-up
  });
});

describe('num', () => {
  it('passes numbers through and falls back for booleans / undefined', () => {
    expect(num(7, 0)).toBe(7);
    expect(num(0, 3)).toBe(0); // a real 0 is kept, not treated as falsy
    expect(num(true, 5)).toBe(5);
    expect(num(false, 5)).toBe(5);
    expect(num(undefined, 9)).toBe(9);
  });
});

describe('fmt', () => {
  it('rounds integer-step numbers and appends the unit', () => {
    expect(fmt(spec({ step: 1, unit: 'px' }), 12.6)).toBe('13px');
    expect(fmt(spec({ unit: '°' }), 90)).toBe('90°'); // no step → integer
    expect(fmt(spec({ step: 5 }), 42.4)).toBe('42'); // step ≥ 1, no unit
  });
  it('shows 2 decimals when the step is sub-integer', () => {
    expect(fmt(spec({ step: 0.01, unit: '×' }), 0.5)).toBe('0.50×');
    expect(fmt(spec({ step: 0.1 }), 1.234)).toBe('1.23');
  });
  it('renders booleans as on / off', () => {
    expect(fmt(spec({ kind: 'bool' }), true)).toBe('on');
    expect(fmt(spec({ kind: 'bool' }), false)).toBe('off');
    expect(fmt(spec(), undefined)).toBe('off');
  });
});

describe('fmtSpan', () => {
  it('renders a first–last pixel span, or an em-dash when absent', () => {
    expect(fmtSpan({ first: 0, last: 195 })).toBe('0 – 195');
    expect(fmtSpan(null)).toBe('—');
    expect(fmtSpan(undefined)).toBe('—');
  });
});

describe('uLabel', () => {
  it('renders an explicit universe, or "dense" when auto-packing', () => {
    expect(uLabel(0)).toBe('u0');
    expect(uLabel(3)).toBe('u3');
    expect(uLabel(undefined)).toBe('dense');
  });
});

describe('static option arrays — values / order / labels', () => {
  it('PROTOCOL_OPTS', () => {
    expect(PROTOCOL_OPTS).toEqual([
      { value: 'artnet', label: 'Art-Net' },
      { value: 'sacn', label: 'sACN (E1.31)' },
    ]);
  });

  it('RGB_OPTS — all six orders, value === label, in order', () => {
    expect(RGB_OPTS.map((o) => o.value)).toEqual(['RGB', 'RBG', 'GRB', 'GBR', 'BRG', 'BGR']);
    expect(RGB_OPTS.every((o) => o.value === o.label)).toBe(true);
  });

  it('POLY_OPTS / MIDI_OPTS', () => {
    expect(POLY_OPTS).toEqual([
      { value: 'mono', label: 'mono' },
      { value: 'poly', label: 'poly' },
    ]);
    expect(MIDI_OPTS).toEqual([
      { value: 'note', label: 'Note' },
      { value: 'cc', label: 'CC' },
    ]);
  });

  it('SWITCH_OPTS — value, section, beat (in that order)', () => {
    expect(SWITCH_OPTS).toEqual([
      { value: 'value', label: 'value' },
      { value: 'section', label: 'section' },
      { value: 'beat', label: 'beat' },
    ]);
  });

  it('VALUEMODE_OPTS — gate, bands', () => {
    expect(VALUEMODE_OPTS).toEqual([
      { value: 'gate', label: 'Gate' },
      { value: 'bands', label: 'Bands' },
    ]);
  });

  it('SOURCE_OPTS — drum, midi, osc', () => {
    expect(SOURCE_OPTS).toEqual([
      { value: 'drum', label: 'Drum' },
      { value: 'midi', label: 'MIDI' },
      { value: 'osc', label: 'OSC' },
    ]);
  });
});

describe('iconed option arrays', () => {
  it('MODE_OPTS — oneshot / loop / hold, each with an icon component', () => {
    expect(MODE_OPTS.map((o) => o.value)).toEqual(['oneshot', 'loop', 'hold']);
    expect(MODE_OPTS.map((o) => o.label)).toEqual(['One-shot', 'Loop', 'Hold']);
    expect(MODE_OPTS.every((o) => typeof o.icon !== 'undefined')).toBe(true);
  });

  it('KIND_OPTS — every conversion-target kind (excludes modulation sources), meta-mirrored', () => {
    // Modulation sources (envelope/LFO/CC) are added from their own palette + edited in their
    // own inspector, so they are NOT conversion targets in the kind selector (doc 10, S34).
    const expected = NODE_KINDS.filter((k) => !voice.isModSourceKind(k));
    expect(KIND_OPTS.map((o) => o.value)).toEqual(expected);
    for (const opt of KIND_OPTS) {
      const k = opt.value as BlockKind;
      expect(opt.label).toBe(kindLabel[k]);
      expect(opt.icon).toBe(kindIcon[k]);
      expect(opt.iconColor).toBe(tint[k]);
    }
    // never includes the trigger root nor a modulation source (not selectable kinds)
    expect(KIND_OPTS.some((o) => o.value === ('trigger' as BlockKind))).toBe(false);
    expect(KIND_OPTS.some((o) => voice.isModSourceKind(o.value))).toBe(false);
  });
});
