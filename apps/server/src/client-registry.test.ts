import { describe, expect, it } from 'vitest';
import { defaultProject } from '@ledrums/core';
import { ClientRegistry, type CloseableSocket } from './client-registry';
import { EngineHost } from './engine-host';

class FakeSocket implements CloseableSocket {
  closed: { code?: number; reason?: string } | null = null;
  close(code?: number, reason?: string): void {
    this.closed = { code, reason };
  }
}

describe('ClientRegistry (many clients, one editor)', () => {
  it('admits many clients without evicting any; the first auto-claims editor', () => {
    const reg = new ClientRegistry<FakeSocket>();
    const a = new FakeSocket();
    const b = new FakeSocket();
    const c = new FakeSocket();
    const idA = reg.admit(a);
    const idB = reg.admit(b);
    const idC = reg.admit(c);

    expect(reg.size).toBe(3);
    expect([...reg]).toEqual([a, b, c]); // insertion-ordered, all held
    expect(a.closed).toBeNull(); // nobody is superseded
    expect(b.closed).toBeNull();
    expect(idA).not.toBe(idB); // opaque, distinct ids
    expect(idB).not.toBe(idC);
    expect(reg.editorId).toBe(idA); // first client is the editor
    expect(reg.isEditor(a)).toBe(true);
    expect(reg.isEditor(b)).toBe(false);
  });

  it('re-admitting the same socket is idempotent (same id, editor untouched)', () => {
    const reg = new ClientRegistry<FakeSocket>();
    const a = new FakeSocket();
    const id1 = reg.admit(a);
    const id2 = reg.admit(a);
    expect(id1).toBe(id2);
    expect(reg.size).toBe(1);
    expect(reg.editorId).toBe(id1);
  });

  it('canMutate reflects the editor role', () => {
    const reg = new ClientRegistry<FakeSocket>();
    const a = new FakeSocket();
    const b = new FakeSocket();
    reg.admit(a);
    reg.admit(b);
    expect(reg.canMutate(a)).toBe(true); // editor
    expect(reg.canMutate(b)).toBe(false); // viewer
  });

  it('removing a non-editor leaves the editor unchanged', () => {
    const reg = new ClientRegistry<FakeSocket>();
    const a = new FakeSocket();
    const b = new FakeSocket();
    const c = new FakeSocket();
    const idA = reg.admit(a);
    reg.admit(b);
    reg.admit(c);
    reg.remove(b); // a viewer leaves
    expect(reg.editorId).toBe(idA); // editor stays a
    expect(reg.size).toBe(2);
    expect([...reg]).toEqual([a, c]);
  });

  it('when the editor leaves with viewers remaining, the slot empties (S2 takeover)', () => {
    const reg = new ClientRegistry<FakeSocket>();
    const a = new FakeSocket();
    const b = new FakeSocket();
    const c = new FakeSocket();
    reg.admit(a); // editor
    reg.admit(b);
    reg.admit(c);
    reg.remove(a); // editor leaves, two viewers remain
    expect(reg.editorId).toBeNull(); // nobody auto-claims with ≥2 remaining
    expect(reg.isEditor(b)).toBe(false);
    expect(reg.canMutate(b)).toBe(false);
  });

  it('when the editor leaves and exactly one client remains, it auto-claims (standalone editable)', () => {
    const reg = new ClientRegistry<FakeSocket>();
    const a = new FakeSocket();
    const b = new FakeSocket();
    reg.admit(a); // editor
    const idB = reg.admit(b);
    reg.remove(a); // editor leaves, one viewer remains
    expect(reg.editorId).toBe(idB); // the lone survivor claims the slot
    expect(reg.canMutate(b)).toBe(true);
  });

  it('removing the last client empties the registry and the editor slot', () => {
    const reg = new ClientRegistry<FakeSocket>();
    const a = new FakeSocket();
    reg.admit(a);
    reg.remove(a);
    expect(reg.size).toBe(0);
    expect(reg.editorId).toBeNull();
    expect([...reg]).toEqual([]);
  });

  it('removing an un-admitted socket is a no-op', () => {
    const reg = new ClientRegistry<FakeSocket>();
    const a = new FakeSocket();
    const stranger = new FakeSocket();
    const idA = reg.admit(a);
    reg.remove(stranger);
    expect(reg.size).toBe(1);
    expect(reg.editorId).toBe(idA);
  });

  it('presence payload is per-socket and tracks join/leave', () => {
    const reg = new ClientRegistry<FakeSocket>();
    const a = new FakeSocket();
    const b = new FakeSocket();
    const idA = reg.admit(a);
    expect(reg.presenceFor(a)).toEqual({ editorId: idA, youAreEditor: true, clientCount: 1 });

    reg.admit(b);
    expect(reg.presenceFor(a)).toEqual({ editorId: idA, youAreEditor: true, clientCount: 2 });
    expect(reg.presenceFor(b)).toEqual({ editorId: idA, youAreEditor: false, clientCount: 2 });

    reg.remove(a); // editor leaves, b is the lone survivor → claims editor
    expect(reg.presenceFor(b)).toEqual({ editorId: reg.editorId, youAreEditor: true, clientCount: 1 });
  });

  it('takeover assigns the editor and returns the demoted prior', () => {
    const reg = new ClientRegistry<FakeSocket>();
    const a = new FakeSocket();
    const b = new FakeSocket();
    reg.admit(a); // editor
    const idB = reg.admit(b);
    const demoted = reg.takeover(b);
    expect(demoted).toBe(a); // a handed off
    expect(reg.editorId).toBe(idB);
    expect(reg.isEditor(b)).toBe(true);
    expect(reg.isEditor(a)).toBe(false);
    // a non-member can't take over
    expect(reg.takeover(new FakeSocket())).toBeNull();
  });
});

describe('engine keeps running regardless of client count', () => {
  const STEP = 1000 / 60;

  it('the host keeps ticking and emitting frames through client churn', () => {
    // Output disabled (default): the render loop runs independently of any transport, so the
    // liveness signal is engine ticks + preview frames, not the output stream.
    const host = new EngineHost(defaultProject());
    host.reloadOutputSettings();
    let frames = 0;
    host.onFrame = () => {
      frames++;
    };
    const reg = new ClientRegistry<FakeSocket>();

    // No client connected — the engine still ticks and emits preview frames.
    for (let i = 0; i < 4; i++) host.step(STEP);
    expect(host.engineTimeMs).toBeCloseTo(STEP * 4);
    const framesWithNoClient = frames;
    expect(framesWithNoClient).toBeGreaterThan(0);

    // Two clients connect, then both disconnect — and through all of it the engine is untouched
    // (the registry holds no reference to the host).
    const a = new FakeSocket();
    const b = new FakeSocket();
    reg.admit(a);
    reg.admit(b);
    reg.remove(a);
    reg.remove(b); // zero clients again
    for (let i = 0; i < 4; i++) host.step(STEP);

    expect(host.engineTimeMs).toBeCloseTo(STEP * 8);
    expect(frames).toBeGreaterThan(framesWithNoClient); // still emitting frames
  });
});
