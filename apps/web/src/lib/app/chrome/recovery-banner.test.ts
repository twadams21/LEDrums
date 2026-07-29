import { describe, expect, it } from 'vitest';
import {
  acknowledge,
  isAcknowledged,
  recoveryAckToken,
  recoveryBannerView,
  RECOVERY_ACK_KEY,
  type AckStore,
} from './recovery-banner';
import type { BootRecoveryInfo } from '../../ws/protocol-types';

const SNAPSHOT: BootRecoveryInfo = { source: 'snapshot', reason: 'SyntaxError: bad json' };
const SEED: BootRecoveryInfo = { source: 'recovered-seed', reason: 'SyntaxError: bad json' };

function memoryStore(seed: Record<string, string> = {}): AckStore {
  const map = new Map(Object.entries(seed));
  return { getItem: (k) => map.get(k) ?? null, setItem: (k, v) => void map.set(k, v) };
}

describe('recoveryBannerView', () => {
  it('states the consequence identically on both rungs — edits may be missing either way', () => {
    for (const info of [SNAPSHOT, SEED]) {
      const view = recoveryBannerView(info);
      expect(view.title).toBe('Recovered from backup');
      expect(view.message).toBe('Your last edits may be missing.');
      expect(view.reason).toBe(info.reason);
    }
  });

  it('names which rung recovered the project', () => {
    expect(recoveryBannerView(SNAPSHOT).rung).toContain('newest backup snapshot');
    expect(recoveryBannerView(SEED).rung).toContain('fresh default kit');
  });
});

describe('acknowledgement', () => {
  it('keys the ack by rung AND reason, so two different recoveries are distinct events', () => {
    expect(recoveryAckToken(SNAPSHOT)).not.toBe(recoveryAckToken(SEED));
  });

  it('round-trips an ack through the store', () => {
    const store = memoryStore();
    expect(isAcknowledged(SNAPSHOT, store)).toBe(false);
    acknowledge(SNAPSHOT, store);
    expect(store.getItem(RECOVERY_ACK_KEY)).toBe(recoveryAckToken(SNAPSHOT));
    expect(isAcknowledged(SNAPSHOT, store)).toBe(true);
    // A different recovery is NOT covered by the earlier ack.
    expect(isAcknowledged(SEED, store)).toBe(false);
  });

  it('fails open with no store — an un-rememberable ack must re-warn, never silently suppress', () => {
    expect(isAcknowledged(SNAPSHOT, null)).toBe(false);
    expect(() => acknowledge(SNAPSHOT, null)).not.toThrow();
  });

  it('treats a throwing store as un-acknowledged instead of crashing the shell', () => {
    const hostile: AckStore = {
      getItem: () => {
        throw new Error('blocked');
      },
      setItem: () => {
        throw new Error('blocked');
      },
    };
    expect(isAcknowledged(SNAPSHOT, hostile)).toBe(false);
    expect(() => acknowledge(SNAPSHOT, hostile)).not.toThrow();
  });
});
