import { describe, expect, it } from 'vitest';
import { DocumentHistory, DEFAULT_HISTORY_BYTES, MAX_HISTORY_ENTRIES } from './document-history';

describe('document history', () => {
  it('detaches mutable input, structurally shares unchanged branches and keeps Undo order', () => {
    const history = new DocumentHistory<{ nodes: { x: number }[]; bpm: number }>();
    const source = { nodes: [{ x: 1 }, { x: 2 }], bpm: 120 };
    history.push('A', source);
    source.nodes[0]!.x = 9;
    history.push('A', source);
    source.nodes[0]!.x = 10;
    const second = history.pop('A')!;
    const first = history.pop('A')!;
    expect(second.nodes[0]!.x).toBe(9);
    expect(first.nodes[0]!.x).toBe(1);
    expect(second.nodes[1]).toBe(first.nodes[1]);
    expect(second.nodes[0]).not.toBe(first.nodes[0]);
    expect(history.stats).toEqual({ entries: 0, bytes: 0 });
  });

  it('rejects foreign ids and clears even same-id document replacements', () => {
    const history = new DocumentHistory<{ bpm: number }>();
    history.push('A', { bpm: 120 });
    expect(history.pop('B')).toBeNull();
    history.push('B', { bpm: 130 });
    history.replace('B');
    expect(history.pop('B')).toBeNull();
    history.push('B', { bpm: 150 });
    history.push('A', { bpm: 170 });
    expect(history.pop('A')).toEqual({ bpm: 170 });
    expect(history.pop('A')).toBeNull();
  });

  it('evicts oldest first by byte budget and releases shared references on pop/replace', () => {
    const history = new DocumentHistory<{ value: string }>({ maxBytes: 1400 });
    for (let i = 0; i < 20; i++) {
      history.push('A', { value: `${i}`.padEnd(150, 'x') });
      expect(history.stats.bytes).toBeLessThanOrEqual(1400);
    }
    expect(history.stats.entries).toBeGreaterThan(0);
    expect(history.stats.entries).toBeLessThan(20);
    expect(history.pop('A')?.value.startsWith('19')).toBe(true);
    history.replace('B');
    expect(history.stats).toEqual({ entries: 0, bytes: 0 });
  });

  it('an oversized checkpoint clears older history rather than skipping an un-undoable edit', () => {
    const history = new DocumentHistory<{ value: string }>({ maxBytes: 1024 });
    history.push('A', { value: 'small' });
    expect(history.push('A', { value: 'x'.repeat(2048) })).toBe('oversized');
    expect(history.stats).toEqual({ entries: 0, bytes: 0 });
    expect(history.pop('A')).toBeNull();
    expect(history.push('A', { value: 'small again' })).toBe('stored');
    expect(history.pop('A')).toEqual({ value: 'small again' });
  });

  it('retains 10,000 small/shared checkpoints inside the default 32 MiB budget', () => {
    expect(DEFAULT_HISTORY_BYTES).toBe(32 * 1024 * 1024);
    expect(MAX_HISTORY_ENTRIES).toBe(10000);
    const history = new DocumentHistory<{ stable: string; value: number }>();
    for (let i = 0; i < 10010; i++) history.push('A', { stable: 'fixture', value: i });
    expect(history.stats.entries).toBe(10000);
    expect(history.stats.bytes).toBeLessThan(DEFAULT_HISTORY_BYTES);
    for (let i = 10009; i >= 10; i--) expect(history.pop('A')?.value).toBe(i);
    expect(history.pop('A')).toBeNull();
    expect(history.stats.bytes).toBe(0);
  });

  it('preserves library insertion order when only the last entry changes', () => {
    const history = new DocumentHistory<{ first: number; second: number; third: number }>();
    history.push('A', { first: 1, second: 2, third: 3 });
    history.push('A', { first: 1, second: 2, third: 4 });
    expect(Object.keys(history.pop('A')!)).toEqual(['first', 'second', 'third']);
  });

  it('preserves sparse array length even when enumerable keys do not change', () => {
    const history = new DocumentHistory<{ list: unknown[] }>();
    history.push('A', { list: Array(2) });
    history.push('A', { list: Array(3) });
    expect(history.pop('A')!.list).toHaveLength(3);
    expect(history.pop('A')!.list).toHaveLength(2);
  });

  it('preserves deletion, absent-vs-undefined, array changes and Unicode values', () => {
    const history = new DocumentHistory<Record<string, unknown>>();
    history.push('A', { optional: undefined, list: ['🥁', 1], removed: true });
    history.push('A', { list: ['光'] });
    expect(history.pop('A')).toEqual({ list: ['光'] });
    const old = history.pop('A')!;
    expect(Object.hasOwn(old, 'optional')).toBe(true);
    expect(old).toEqual({ optional: undefined, list: ['🥁', 1], removed: true });
  });
});
