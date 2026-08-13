import { describe, expect, it } from 'vitest';
import { copyNameFor, graphPickRows } from './add-graph-rows';

const library = [
  { key: 'kick:0', label: 'Kick · centre' },
  { key: 'graph-1', label: 'Strobe hits' },
  { key: 'graph-2', label: 'Chorus wash' },
];
const sub = (key: string): string => (key === 'graph-1' ? 'midi 38' : 'kick · centre');

describe('graphPickRows', () => {
  it('lists the whole library in order for a blank query', () => {
    const rows = graphPickRows(library, [], sub, '');
    expect(rows.map((r) => r.key)).toEqual(['kick:0', 'graph-1', 'graph-2']);
    expect(rows[1]).toEqual({ key: 'graph-1', label: 'Strobe hits', sub: 'midi 38', inSection: false });
  });

  it('flags the graphs the section already lists', () => {
    const rows = graphPickRows(library, ['graph-2'], sub, '');
    expect(rows.map((r) => r.inSection)).toEqual([false, false, true]);
  });

  it('matches label or trigger-source line, case-insensitively and trimmed', () => {
    expect(graphPickRows(library, [], sub, '  STROBE ').map((r) => r.key)).toEqual(['graph-1']);
    expect(graphPickRows(library, [], sub, 'midi').map((r) => r.key)).toEqual(['graph-1']);
    expect(graphPickRows(library, [], sub, 'centre').map((r) => r.key)).toEqual(['kick:0', 'graph-2']);
  });

  it('returns nothing when nothing matches', () => {
    expect(graphPickRows(library, [], sub, 'zzz')).toEqual([]);
  });
});

describe('copyNameFor', () => {
  it('offers the same name duplicateGraph would mint', () => {
    expect(copyNameFor('Strobe hits')).toBe('Strobe hits copy');
  });
});
