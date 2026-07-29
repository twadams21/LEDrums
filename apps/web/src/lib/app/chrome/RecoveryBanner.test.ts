// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';
import { fireEvent, render } from '@testing-library/svelte';
import RecoveryBanner from './RecoveryBanner.svelte';
import { RECOVERY_ACK_KEY, recoveryAckToken, type AckStore } from './recovery-banner';
import type { BootRecoveryInfo } from '../../ws/protocol-types';

const SNAPSHOT: BootRecoveryInfo = { source: 'snapshot', reason: 'SyntaxError: Unexpected end of JSON input' };
const SEED: BootRecoveryInfo = { source: 'recovered-seed', reason: 'ZodError: kit.hoops invalid' };

/** In-memory ack store — the component's sessionStorage seam, so no test leaks into another. */
function memoryStore(seed: Record<string, string> = {}): AckStore {
  const map = new Map(Object.entries(seed));
  return {
    getItem: (k) => map.get(k) ?? null,
    setItem: (k, v) => void map.set(k, v),
  };
}

describe('RecoveryBanner', () => {
  it('renders nothing when the server reports no boot recovery', () => {
    const { container } = render(RecoveryBanner, { props: { recovery: null, ackStore: memoryStore() } });
    expect(container.querySelector('.recovery-scrim')).toBeNull();
  });

  it('blocks with honest copy naming the snapshot rung when the project was recovered', () => {
    const { container } = render(RecoveryBanner, { props: { recovery: SNAPSHOT, ackStore: memoryStore() } });
    const scrim = container.querySelector('.recovery-scrim')!;
    expect(scrim.getAttribute('role')).toBe('alertdialog');
    expect(scrim.getAttribute('aria-modal')).toBe('true');
    expect(container.querySelector('.title')?.textContent).toBe('Recovered from backup');
    expect(container.querySelector('.message')?.textContent).toBe('Your last edits may be missing.');
    expect(container.querySelector('.rung')?.textContent).toContain('newest backup snapshot');
    expect(container.querySelector('.reason')?.textContent).toBe(SNAPSHOT.reason);
  });

  it('says a fresh default was used when no readable snapshot existed', () => {
    const { container } = render(RecoveryBanner, { props: { recovery: SEED, ackStore: memoryStore() } });
    expect(container.querySelector('.rung')?.textContent).toContain('fresh default kit');
  });

  it('dismisses on acknowledge and records the ack for the browser session', async () => {
    const store = memoryStore();
    const { container } = render(RecoveryBanner, { props: { recovery: SNAPSHOT, ackStore: store } });
    await fireEvent.click(container.querySelector('.ack')!);
    expect(container.querySelector('.recovery-scrim')).toBeNull();
    expect(store.getItem(RECOVERY_ACK_KEY)).toBe(recoveryAckToken(SNAPSHOT));
  });

  it('stays dismissed for a recovery already acknowledged this session (a reconnect must not re-raise it)', () => {
    const store = memoryStore({ [RECOVERY_ACK_KEY]: recoveryAckToken(SNAPSHOT) });
    const { container } = render(RecoveryBanner, { props: { recovery: SNAPSHOT, ackStore: store } });
    expect(container.querySelector('.recovery-scrim')).toBeNull();
  });

  it('re-raises for a DIFFERENT recovery even after an earlier ack', () => {
    const store = memoryStore({ [RECOVERY_ACK_KEY]: recoveryAckToken(SNAPSHOT) });
    const { container } = render(RecoveryBanner, { props: { recovery: SEED, ackStore: store } });
    expect(container.querySelector('.recovery-scrim')).not.toBeNull();
  });

  it('a LIVE source change re-raises the banner even mid-session after an in-page ack (review N10)', async () => {
    // Same reason string, different rung: the in-page ack must key on recoveryAckToken
    // (source:reason) exactly like the persisted ack, or the later recovery is swallowed.
    const sameReasonSeed: BootRecoveryInfo = { source: 'recovered-seed', reason: SNAPSHOT.reason };
    const store = memoryStore();
    const { container, rerender } = render(RecoveryBanner, { props: { recovery: SNAPSHOT, ackStore: store } });
    await fireEvent.click(container.querySelector('.ack')!);
    expect(container.querySelector('.recovery-scrim')).toBeNull();
    await rerender({ recovery: sameReasonSeed, ackStore: store });
    expect(container.querySelector('.recovery-scrim')).not.toBeNull();
  });

  it('focuses the acknowledge action so the only way out is reachable from the keyboard', () => {
    const { container } = render(RecoveryBanner, { props: { recovery: SNAPSHOT, ackStore: memoryStore() } });
    expect(document.activeElement).toBe(container.querySelector('.ack'));
  });

  it('shows the banner when storage is unavailable rather than suppressing a real warning', () => {
    const { container } = render(RecoveryBanner, { props: { recovery: SNAPSHOT, ackStore: null } });
    expect(container.querySelector('.recovery-scrim')).not.toBeNull();
  });
});
