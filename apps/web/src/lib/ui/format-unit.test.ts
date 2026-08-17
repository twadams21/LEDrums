import { describe, expect, it } from 'vitest';
import { splitValueUnit } from './format-unit';

/* The regression that forced this module out of Slider.svelte: a 0.01-step param formats as
   `0.60` while the input renders `0.6`, and slicing one from the other left a bare `0` sitting
   outside the input box as if it were the unit. */

describe('splitValueUnit', () => {
  it('keeps a trailing zero with the NUMBER, never as a unit', () => {
    expect(splitValueUnit('0.60')).toEqual({ number: '0.60', unit: '' });
    expect(splitValueUnit('0.50×')).toEqual({ number: '0.50', unit: '×' });
    expect(splitValueUnit('1.10 s')).toEqual({ number: '1.10', unit: 's' });
  });

  it('splits a symbol unit hugging the digits', () => {
    expect(splitValueUnit('210°')).toEqual({ number: '210', unit: '°' });
    expect(splitValueUnit('45%')).toEqual({ number: '45', unit: '%' });
  });

  it('splits a word unit separated by a space', () => {
    expect(splitValueUnit('1500 ms')).toEqual({ number: '1500', unit: 'ms' });
    expect(splitValueUnit('4 beats')).toEqual({ number: '4', unit: 'beats' });
    expect(splitValueUnit('0.25 rev/beat')).toEqual({ number: '0.25', unit: 'rev/beat' });
  });

  it('handles signs, bare decimals and exponent form', () => {
    expect(splitValueUnit('-12 px')).toEqual({ number: '-12', unit: 'px' });
    expect(splitValueUnit('+3')).toEqual({ number: '+3', unit: '' });
    expect(splitValueUnit('.5 x')).toEqual({ number: '.5', unit: 'x' });
    expect(splitValueUnit('1e-3 s')).toEqual({ number: '1e-3', unit: 's' });
  });

  it('reports no number for a read-out that is pure text', () => {
    expect(splitValueUnit('swept')).toEqual({ number: null, unit: 'swept' });
    expect(splitValueUnit('')).toEqual({ number: null, unit: '' });
  });
});
