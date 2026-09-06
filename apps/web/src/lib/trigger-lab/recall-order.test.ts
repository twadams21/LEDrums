import { describe, expect, it } from 'vitest';
import { compareRecallIdentity } from './recall-order';

describe('recall ordering', () => {
  it('orders revisions before sequences within one server session', () => {
    expect(compareRecallIdentity(
      { sessionId: 's', showRevision: 2, recallSequence: 1 },
      { sessionId: 's', showRevision: 1, recallSequence: 99 },
    )).toBeGreaterThan(0);
    expect(compareRecallIdentity(
      { sessionId: 's', showRevision: 2, recallSequence: 3 },
      { sessionId: 's', showRevision: 2, recallSequence: 4 },
    )).toBeLessThan(0);
  });
});
