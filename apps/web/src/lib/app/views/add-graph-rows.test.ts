import { describe, expect, it } from 'vitest';
import { copyNameFor, graphPickGroups, type GraphPickInput } from './add-graph-rows';

/* The Add-graph list: graphs grouped under the zones the kit declares (an empty zone still
   listed), an "Other triggers" tail, an A–Z alternative, and the usage / duplicate facts each row
   carries so the list can be tidied. */

const library = [
  { key: 'kick:0', label: 'Kick · centre' },
  { key: 'graph-1', label: 'Strobe hits' },
  { key: 'graph-2', label: 'Kick · centre' },
  { key: 'graph-3', label: 'Chorus wash' },
];
const zones = [
  { drumId: 'kick', slot: 0, title: 'Kick · centre' },
  { drumId: 'snare', slot: 1, title: 'Snare · rim' },
];
const zoneOf: Record<string, { drumId: string; slot: number } | null> = {
  'kick:0': { drumId: 'kick', slot: 0 },
  'graph-2': { drumId: 'kick', slot: 0 },
  'graph-1': null,
  'graph-3': { drumId: 'tom9', slot: 0 }, // a zone the kit no longer declares
};
const placements: Record<string, number> = { 'kick:0': 0, 'graph-2': 2, 'graph-1': 1, 'graph-3': 0 };

const input = (over: Partial<GraphPickInput> = {}): GraphPickInput => ({
  library,
  sectionGraphs: ['graph-2'],
  zones,
  sub: (key) => (key === 'graph-1' ? 'midi 38' : 'kick · centre'),
  zoneOf: (key) => zoneOf[key] ?? null,
  placements: (key) => placements[key] ?? 0,
  duplicates: new Set(['kick:0', 'graph-2']),
  query: '',
  sort: 'zone',
  ...over,
});

const shape = (groups: ReturnType<typeof graphPickGroups>) => groups.map((g) => [g.id, g.rows.map((r) => r.key)]);

describe('graphPickGroups — by zone', () => {
  it('lists every declared zone in order, then Other triggers', () => {
    expect(shape(graphPickGroups(input()))).toEqual([
      ['zone:kick:0', ['graph-2', 'kick:0']],
      ['zone:snare:1', []],
      ['other', ['graph-1', 'graph-3']],
    ]);
  });

  it('keeps a zone with no graph, carrying the zone so it can offer Create', () => {
    const snare = graphPickGroups(input()).find((g) => g.id === 'zone:snare:1')!;
    expect(snare).toMatchObject({ title: 'Snare · rim', zone: { drumId: 'snare', slot: 1 }, rows: [] });
  });

  it('puts the graph sections play above its unused copy', () => {
    const kick = graphPickGroups(input()).find((g) => g.id === 'zone:kick:0')!;
    expect(kick.rows.map((r) => [r.key, r.placements])).toEqual([['graph-2', 2], ['kick:0', 0]]);
  });

  it('marks duplicates and what the section already lists', () => {
    const kick = graphPickGroups(input()).find((g) => g.id === 'zone:kick:0')!;
    expect(kick.rows[0]).toMatchObject({ key: 'graph-2', duplicate: true, inSection: true });
    const other = graphPickGroups(input()).find((g) => g.id === 'other')!;
    expect(other.rows[0]).toMatchObject({ key: 'graph-1', duplicate: false, inSection: false });
  });

  it('a search keeps matching graphs, and a zone whose NAME matches keeps all of it', () => {
    expect(shape(graphPickGroups(input({ query: 'strobe' })))).toEqual([['other', ['graph-1']]]);
    expect(shape(graphPickGroups(input({ query: ' SNARE ' })))).toEqual([['zone:snare:1', []]]);
    expect(graphPickGroups(input({ query: 'zzz' }))).toEqual([]);
  });
});

describe('graphPickGroups — A–Z', () => {
  it('is one flat list sorted by name', () => {
    const groups = graphPickGroups(input({ sort: 'name' }));
    expect(groups).toHaveLength(1);
    expect(groups[0]).toMatchObject({ id: 'all', title: null, zone: null });
    expect(groups[0]!.rows.map((r) => r.label)).toEqual(['Chorus wash', 'Kick · centre', 'Kick · centre', 'Strobe hits']);
  });
});

describe('copyNameFor', () => {
  it('offers the same name duplicateGraph would mint', () => {
    expect(copyNameFor('Strobe hits')).toBe('Strobe hits copy');
  });
});
