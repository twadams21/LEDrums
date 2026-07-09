import { describe, expect, it } from 'vitest';
import type { WireRejection } from './graph-wiring';
import { wireRejectionMessage } from './wire-toasts';

describe('wireRejectionMessage', () => {
  const reasons: WireRejection[] = ['direction', 'duplicate', 'cycle'];

  it('has a distinct, non-empty, plain-language message for every reason', () => {
    const messages = reasons.map(wireRejectionMessage);
    for (const m of messages) expect(m.trim().length).toBeGreaterThan(0);
    expect(new Set(messages).size).toBe(reasons.length); // no two reasons share copy
  });

  it('names what is wrong per reason', () => {
    expect(wireRejectionMessage('direction')).toMatch(/output|input/i);
    expect(wireRejectionMessage('duplicate')).toMatch(/already/i);
    expect(wireRejectionMessage('cycle')).toMatch(/loop/i);
  });
});
