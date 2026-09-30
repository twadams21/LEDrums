import { describe, expect, it } from 'vitest';
import { drumZoneId, hoopNodeId, outputNodeId, parseHoopNodeId, parseOutputNodeId } from './patch-graph';

/* The patch node-id grammar (uniformly 1-based hoops, A1) that Settings › Outputs & Chains keys
   hoops and outputs by. */

describe('hoop node id ⇄ HoopRef (both 1-based, A1)', () => {
  it('round-trips the shared 1-based hoop number in both directions', () => {
    expect(hoopNodeId({ drumId: 'snare', hoop: 1 })).toBe('hoop:snare:1');
    expect(hoopNodeId({ drumId: 'tom1', hoop: 4 })).toBe('hoop:tom1:4');
    expect(parseHoopNodeId('hoop:snare:1')).toEqual({ drumId: 'snare', hoop: 1 });
    expect(parseHoopNodeId('hoop:tom1:4')).toEqual({ drumId: 'tom1', hoop: 4 });
  });
  it('rejects non-hoop / malformed ids', () => {
    expect(parseHoopNodeId('output:1')).toBeNull();
    expect(parseHoopNodeId('controller')).toBeNull();
    expect(parseHoopNodeId('hoop:snare')).toBeNull();
  });
});

describe('output node id ⇄ OutputConfig.id', () => {
  it('round-trips and rejects non-output ids', () => {
    expect(outputNodeId('2')).toBe('output:2');
    expect(parseOutputNodeId('output:2')).toBe('2');
    expect(parseOutputNodeId('hoop:a:1')).toBeNull();
  });
});

describe('drum id', () => {
  it('prefixes the drum id so it never collides with a hoop or output id', () => {
    expect(drumZoneId('kick')).toBe('drum:kick');
    expect(parseHoopNodeId(drumZoneId('kick'))).toBeNull();
    expect(parseOutputNodeId(drumZoneId('kick'))).toBeNull();
  });
});
