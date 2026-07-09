import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { announceSystemActions, describeSystemActions } from './system-toasts';
import { toastStore } from '../../ui/toast.svelte';

/* R02 emission seam: a pure hydrate summary (migrations + auto-wires the app performed) turns into
   ONE plain-language toast. describeSystemActions owns the copy (null ⇒ nothing to announce);
   announceSystemActions pushes exactly one toast through the shared store on a real migration. */

beforeEach(() => toastStore.clear());
afterEach(() => toastStore.clear());

describe('describeSystemActions', () => {
  it('returns null when nothing was done on the user behalf', () => {
    expect(describeSystemActions({ migratedGraphs: 0, autoWiredNodes: 0 })).toBeNull();
  });

  it('announces a single migration + auto-wire in plain language', () => {
    expect(describeSystemActions({ migratedGraphs: 1, autoWiredNodes: 1 })).toBe(
      'Graph updated to the Gen3 schema. A node was wired up to the Output anchor.',
    );
  });

  it('pluralises and batches several graphs into one sentence', () => {
    expect(describeSystemActions({ migratedGraphs: 3, autoWiredNodes: 5 })).toBe(
      '3 graphs updated to the Gen3 schema. 5 nodes were wired up to the Output anchor.',
    );
  });

  it('announces migration alone when nothing needed auto-wiring', () => {
    expect(describeSystemActions({ migratedGraphs: 2, autoWiredNodes: 0 })).toBe(
      '2 graphs updated to the Gen3 schema.',
    );
  });
});

describe('announceSystemActions', () => {
  it('pushes exactly one info toast on a migration', () => {
    const id = announceSystemActions({ migratedGraphs: 2, autoWiredNodes: 1 });
    expect(id).not.toBeNull();
    expect(toastStore.items).toHaveLength(1);
    expect(toastStore.items[0]).toMatchObject({
      tone: 'info',
      message: '2 graphs updated to the Gen3 schema. A node was wired up to the Output anchor.',
    });
  });

  it('emits nothing (no toast) for an empty summary', () => {
    const id = announceSystemActions({ migratedGraphs: 0, autoWiredNodes: 0 });
    expect(id).toBeNull();
    expect(toastStore.items).toHaveLength(0);
  });
});
