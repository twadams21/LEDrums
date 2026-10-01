import { describe, expect, it } from 'vitest';
import { PROTOCOL_OPTS, RGB_OPTS, fmtSpan } from './output-options';

describe('fmtSpan', () => {
  it('renders a first–last pixel span, or an em-dash when absent', () => {
    expect(fmtSpan({ first: 0, last: 195 })).toBe('0 – 195');
    expect(fmtSpan(null)).toBe('—');
    expect(fmtSpan(undefined)).toBe('—');
  });
});

describe('option arrays — values / order / labels', () => {
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
});
