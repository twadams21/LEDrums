import { describe, expect, it } from 'vitest';
import { defaultProject } from '@ledrums/core';
import {
  SingleClientLock,
  SUPERSEDED_CODE,
  SUPERSEDED_REASON,
  type CloseableSocket,
} from './client-lock';
import { EngineHost } from './engine-host';

class FakeSocket implements CloseableSocket {
  closed: { code?: number; reason?: string } | null = null;
  throwOnClose = false;
  close(code?: number, reason?: string): void {
    if (this.throwOnClose) throw new Error('already closed');
    this.closed = { code, reason };
  }
}

describe('SingleClientLock (newest wins)', () => {
  it('admits one client and holds exactly it', () => {
    const lock = new SingleClientLock<FakeSocket>();
    const a = new FakeSocket();
    expect(lock.admit(a)).toBeNull();
    expect(lock.get()).toBe(a);
    expect(lock.size).toBe(1);
    expect([...lock]).toEqual([a]);
    expect(a.closed).toBeNull();
  });

  it('a second connection cleanly supersedes the first', () => {
    const lock = new SingleClientLock<FakeSocket>();
    const a = new FakeSocket();
    const b = new FakeSocket();
    lock.admit(a);
    const evicted = lock.admit(b);
    expect(evicted).toBe(a);
    expect(a.closed).toEqual({ code: SUPERSEDED_CODE, reason: SUPERSEDED_REASON });
    expect(b.closed).toBeNull(); // the newcomer stays open
    expect(lock.get()).toBe(b);
    expect(lock.size).toBe(1);
    expect([...lock]).toEqual([b]);
  });

  it('a stale (already-superseded) socket removal does not drop the live one', () => {
    const lock = new SingleClientLock<FakeSocket>();
    const a = new FakeSocket();
    const b = new FakeSocket();
    lock.admit(a);
    lock.admit(b);
    lock.remove(a); // a's late close/error fires after it was evicted
    expect(lock.get()).toBe(b); // b is untouched
    expect(lock.size).toBe(1);
  });

  it('removing the live socket clears the slot', () => {
    const lock = new SingleClientLock<FakeSocket>();
    const a = new FakeSocket();
    lock.admit(a);
    lock.remove(a);
    expect(lock.get()).toBeNull();
    expect(lock.size).toBe(0);
    expect([...lock]).toEqual([]);
  });

  it('tolerates a throwing close during eviction', () => {
    const lock = new SingleClientLock<FakeSocket>();
    const a = new FakeSocket();
    a.throwOnClose = true;
    const b = new FakeSocket();
    lock.admit(a);
    expect(() => lock.admit(b)).not.toThrow();
    expect(lock.get()).toBe(b);
  });
});

describe('engine keeps running regardless of client count', () => {
  const STEP = 1000 / 60;

  it('the host keeps ticking and emitting frames through client churn', () => {
    // Output disabled (default): the render loop runs independently of any transport, so
    // the liveness signal is engine ticks + preview frames, not the output stream.
    const host = new EngineHost(defaultProject());
    host.reloadOutputSettings();
    let frames = 0;
    host.onFrame = () => {
      frames++;
    };
    const lock = new SingleClientLock<FakeSocket>();

    // No client connected — the engine still ticks and emits preview frames.
    for (let i = 0; i < 4; i++) host.step(STEP);
    expect(host.engineTimeMs).toBeCloseTo(STEP * 4);
    const framesWithNoClient = frames;
    expect(framesWithNoClient).toBeGreaterThan(0);

    // A client connects, is superseded by a second, then disconnects — and through all
    // of it the engine is untouched (the lock holds no reference to the host).
    const a = new FakeSocket();
    const b = new FakeSocket();
    lock.admit(a);
    lock.admit(b); // evicts a
    lock.remove(b); // b disconnects → zero clients again
    for (let i = 0; i < 4; i++) host.step(STEP);

    expect(host.engineTimeMs).toBeCloseTo(STEP * 8);
    expect(frames).toBeGreaterThan(framesWithNoClient); // still emitting frames
  });
});
