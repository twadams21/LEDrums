import { describe, expect, it } from 'vitest';
import { om, OrderedMap, stringifyOrdered } from './json-order';

describe('stringifyOrdered', () => {
  it('emits members in explicit entry order, not key-sorted order', () => {
    // Keys deliberately in non-alphabetical, protocol-mandated order.
    const req = om(['req', 'statisticRead'], ['id', 1], ['params', om(['path', ['']])]);
    expect(stringifyOrdered(req)).toBe('{"req":"statisticRead","id":1,"params":{"path":[""]}}');
  });

  it('preserves order that contradicts insertion via a plain object round-trip', () => {
    // The strict-order guarantee must survive independently of JS object key
    // behavior: even members that a transform might reorder stay put.
    const map = new OrderedMap([
      ['net', om(['ipMode', true])],
      ['pix', om(['dataSrc', 'Art-Net'])],
    ]);
    expect(stringifyOrdered(map)).toBe('{"net":{"ipMode":true},"pix":{"dataSrc":"Art-Net"}}');
  });

  it('serializes nested arrays, booleans, numbers, null, and escaped strings', () => {
    const v = om(
      ['a', [1, 2, [3, false]]],
      ['b', null],
      ['c', 'quote"and\\slash'],
    );
    expect(stringifyOrdered(v)).toBe('{"a":[1,2,[3,false]],"b":null,"c":"quote\\"and\\\\slash"}');
  });

  it('produces no whitespace between members', () => {
    expect(stringifyOrdered(om(['x', 1], ['y', 2]))).not.toMatch(/\s/);
  });
});
