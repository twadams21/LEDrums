import { describe, expect, it, vi } from 'vitest';
import type { TriggerLab } from '../../../trigger-lab/store.svelte';
import { commitLabel, onNum, patchLabel } from './forms';

describe('onNum', () => {
  it('ignores a cleared field', () => {
    const apply = vi.fn();
    onNum('', apply);
    expect(apply).not.toHaveBeenCalled();
  });

  it('applies a finite parsed number', () => {
    const apply = vi.fn();
    onNum('42', apply);
    expect(apply).toHaveBeenCalledWith(42);
  });

  it('ignores non-finite input', () => {
    const apply = vi.fn();
    onNum('abc', apply);
    expect(apply).not.toHaveBeenCalled();
  });
});

describe('patchLabel', () => {
  it('returns the trimmed override, else the fallback', () => {
    const store = { patchLabels: { a: ' Custom ', b: '   ' } } as unknown as TriggerLab;
    expect(patchLabel(store, 'a', 'Fallback')).toBe('Custom');
    expect(patchLabel(store, 'b', 'Fallback')).toBe('Fallback'); // blank override → fallback
    expect(patchLabel(store, 'missing', 'Fallback')).toBe('Fallback');
  });
});

describe('commitLabel', () => {
  it('commits a trimmed label, clearing when blank or equal to the fallback', () => {
    const calls: Array<[string, string]> = [];
    const store = { setPatchLabel: (id: string, v: string) => calls.push([id, v]) } as unknown as TriggerLab;
    commitLabel(store, 'a', 'Fallback', '  New  ');
    commitLabel(store, 'a', 'Fallback', 'Fallback');
    commitLabel(store, 'a', 'Fallback', '   ');
    expect(calls).toEqual([
      ['a', 'New'],
      ['a', ''],
      ['a', ''],
    ]);
  });
});
