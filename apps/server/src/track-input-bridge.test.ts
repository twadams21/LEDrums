import { createSocket, type Socket } from 'node:dgram';
import { once } from 'node:events';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createTrackInputBridge } from './track-input-bridge';

const cleanup: Array<() => void> = [];
afterEach(() => { for (const close of cleanup.splice(0)) close(); });
const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
async function setup() {
  const sink = { midi: vi.fn(), cc: vi.fn(), osc: vi.fn(), audio: vi.fn() };
  const bridge = createTrackInputBridge({ enabled: true, port: 0, sink, publish: vi.fn() });
  cleanup.push(() => bridge.close());
  for (let i = 0; i < 100 && bridge.snapshot().status !== 'listening'; i++) await wait(10);
  expect(bridge.snapshot().status).toBe('listening');
  const sender = createSocket('udp4');
  sender.bind(0, '127.0.0.1');
  await once(sender, 'listening');
  cleanup.push(() => sender.close());
  const send = (data: unknown) => sender.send(typeof data === 'string' ? data : JSON.stringify(data), bridge.snapshot().port, '127.0.0.1');
  return { bridge, sink, sender, send };
}
const hello = { v: 1, t: 'hello', id: 'bridge-test', session: 'session-test', seq: 0, name: 'Synthetic MIDI', kind: 'midi' };
async function ack(sender: Socket, send: () => void) {
  const next = once(sender, 'message');
  send();
  const [data] = await next;
  return JSON.parse(String(data));
}

describe('loopback track bridge', () => {
  it('receives actual datagrams, registers, acknowledges and dispatches inputs', async () => {
    const f = await setup();
    expect(await ack(f.sender, () => f.send(hello))).toMatchObject({ v: 1, t: 'ack', ok: true, id: hello.id, session: hello.session });
    f.send({ v: 1, t: 'midi', id: hello.id, session: hello.session, seq: 1, note: 38, velocity: 100, on: true, channel: 2 });
    await vi.waitFor(() => expect(f.sink.midi).toHaveBeenCalledWith({ note: 38, velocity: 100, on: true, channel: 2 }));
    expect(f.bridge.snapshot().inputs).toMatchObject([{ name: hello.name, connected: true, received: 1 }]);
    f.bridge.close();
    expect(f.sink.midi).toHaveBeenLastCalledWith({ note: 38, velocity: 0, on: false, channel: 2 });
  });
  it('drops malformed/oversized/out-of-range packets without losing the receiver', async () => {
    const f = await setup();
    f.send('{'); f.send('x'.repeat(4096));
    f.send({ ...hello, name: 'x'.repeat(1000) });
    expect(await ack(f.sender, () => f.send(hello))).toMatchObject({ ok: true });
    f.send({ v: 1, t: 'midi', id: hello.id, session: hello.session, seq: 1, note: 128, velocity: 100, on: true, channel: 1 });
    await wait(30);
    expect(f.sink.midi).not.toHaveBeenCalled();
    expect(f.bridge.snapshot().inputs).toHaveLength(1);
  });
  it('reports duplicate saved IDs without transferring ownership', async () => {
    const f = await setup();
    await ack(f.sender, () => f.send(hello));
    expect(await ack(f.sender, () => f.send({ ...hello, session: 'session-copy' }))).toMatchObject({ ok: false, reason: 'duplicate-id' });
  });
  it('reports bind failure and leaves the rest of the app usable', async () => {
    const f = await setup();
    const second = createTrackInputBridge({ enabled: true, port: f.bridge.snapshot().port, sink: f.sink, publish: vi.fn() });
    cleanup.push(() => second.close());
    await vi.waitFor(() => expect(second.snapshot().status).toBe('error'));
    expect(second.snapshot().error).toContain('EADDRINUSE');
  });
  it('does not bind while disabled or with an invalid port', () => {
    const sink = { midi: vi.fn(), cc: vi.fn(), osc: vi.fn(), audio: vi.fn() };
    const off = createTrackInputBridge({ enabled: false, port: 0, sink, publish: vi.fn() });
    const invalid = createTrackInputBridge({ enabled: true, port: -1, sink, publish: vi.fn() });
    expect(off.snapshot()).toMatchObject({ status: 'off', inputs: [] });
    expect(invalid.snapshot()).toMatchObject({ status: 'error', inputs: [] });
    off.close(); invalid.close();
  });
});
