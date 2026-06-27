import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { WSClient, type WSLike } from './client';
import type { ServerMessage } from './protocol-types';

/** A controllable fake WebSocket for driving the client in tests. */
class FakeWS implements WSLike {
  static instances: FakeWS[] = [];
  binaryType = 'blob';
  readyState = 0; // CONNECTING
  onopen: ((ev?: unknown) => void) | null = null;
  onclose: ((ev?: unknown) => void) | null = null;
  onerror: ((ev?: unknown) => void) | null = null;
  onmessage: ((ev: { data: unknown }) => void) | null = null;
  sent: string[] = [];

  constructor(public url: string) {
    FakeWS.instances.push(this);
  }

  send(data: string): void {
    this.sent.push(data);
  }

  close(): void {
    this.readyState = 3; // CLOSED
    this.onclose?.();
  }

  // test helpers
  open(): void {
    this.readyState = 1; // OPEN
    this.onopen?.();
  }
  emitText(data: string): void {
    this.onmessage?.({ data });
  }
  emitBinary(data: ArrayBuffer): void {
    this.onmessage?.({ data });
  }
}

function makeClient() {
  FakeWS.instances = [];
  const factory = (url: string): WSLike => new FakeWS(url);
  const client = new WSClient({ url: 'ws://test/ws', factory, baseDelayMs: 10, maxDelayMs: 100 });
  return { client, factory };
}

beforeEach(() => {
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
});

describe('WSClient', () => {
  it('sets binaryType to arraybuffer on connect', () => {
    const { client } = makeClient();
    client.connect();
    expect(FakeWS.instances[0]!.binaryType).toBe('arraybuffer');
  });

  it('dispatches a decoded state ServerMessage to onState', () => {
    const { client } = makeClient();
    const onState = vi.fn();
    client.on({ onState });
    client.connect();
    const ws = FakeWS.instances[0]!;
    ws.open();

    const msg: ServerMessage = {
      t: 'state',
      project: { name: 'P' } as never,
      model: { count: 2, positions: [0, 0, 0, 1, 1, 1], tangents: [], normals: [], segmentLengths: [], drums: [], bounds: { center: [0, 0, 0], size: 1 } },
      effects: [],
      projects: ['default'],
      output: { state: 'disabled', protocol: 'artnet', host: '1.2.3.4', packetsSent: 0, lastError: null, universeCount: 0 },
      showLibrary: null,
    };
    ws.emitText(JSON.stringify(msg));

    expect(onState).toHaveBeenCalledTimes(1);
    const [, model, , projects] = onState.mock.calls[0]!;
    expect(model.count).toBe(2);
    expect(projects).toEqual(['default']);
  });

  it('decodes a binary frame into a Uint8Array and invokes onFrame', () => {
    const { client } = makeClient();
    const onFrame = vi.fn();
    client.on({ onFrame });
    client.connect();
    const ws = FakeWS.instances[0]!;
    ws.open();

    const bytes = new Uint8Array([10, 20, 30, 40, 50, 60]);
    ws.emitBinary(bytes.buffer);

    expect(onFrame).toHaveBeenCalledTimes(1);
    const got = onFrame.mock.calls[0]![0] as Uint8Array;
    expect(Array.from(got)).toEqual([10, 20, 30, 40, 50, 60]);
  });

  it('ignores malformed text messages without throwing', () => {
    const { client } = makeClient();
    const onState = vi.fn();
    const onError = vi.fn();
    client.on({ onState, onError });
    client.connect();
    const ws = FakeWS.instances[0]!;
    ws.open();

    expect(() => ws.emitText('not json {{{')).not.toThrow();
    expect(() => ws.emitText(JSON.stringify({ t: 'bogus' }))).not.toThrow();
    expect(onState).not.toHaveBeenCalled();
    // 'error' is a known type, but bogus is not — neither callback fires.
    expect(onError).not.toHaveBeenCalled();
  });

  it('schedules a reconnect on close and opens a new socket', () => {
    const { client } = makeClient();
    const states: string[] = [];
    client.on({ onConnection: (s) => states.push(s) });
    client.connect();
    const ws = FakeWS.instances[0]!;
    ws.open();
    expect(FakeWS.instances.length).toBe(1);

    // Server drops the connection.
    ws.onclose?.();
    expect(states).toContain('closed');

    // Backoff timer fires → a brand new socket is created.
    vi.advanceTimersByTime(50);
    expect(FakeWS.instances.length).toBe(2);
  });

  it('does not reconnect after an explicit close()', () => {
    const { client } = makeClient();
    client.connect();
    const ws = FakeWS.instances[0]!;
    ws.open();

    client.close();
    vi.advanceTimersByTime(500);
    expect(FakeWS.instances.length).toBe(1);
  });

  it('send() serializes a client message only when open', () => {
    const { client } = makeClient();
    client.connect();
    const ws = FakeWS.instances[0]!;

    // Not open yet → dropped.
    client.send({ t: 'listProjects' });
    expect(ws.sent.length).toBe(0);

    ws.open();
    client.send({ t: 'setTransport', bpm: 128 });
    expect(ws.sent.length).toBe(1);
    expect(JSON.parse(ws.sent[0]!)).toEqual({ t: 'setTransport', bpm: 128 });
  });
});
