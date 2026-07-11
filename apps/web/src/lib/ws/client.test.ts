import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { WS_CLOSE_INVALID_PIN } from '@ledrums/protocol';
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
  /** Simulate the server closing with a specific close code (e.g. 4401 invalid-pin). */
  closeWith(code: number): void {
    this.readyState = 3; // CLOSED
    this.onclose?.({ code });
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
      // A runtime-valid minimal project (kit + one drum): decodeServer now validates `state.project`
      // through core's projectSchema, so an empty stub would be (correctly) rejected as malformed.
      project: {
        name: 'P',
        kit: { global: {}, drums: [{ id: 'd', diameterIn: 8, hoopSpacingMm: 50, origin: { x: 0, y: 0, z: 0 }, rotation: { x: 0, y: 0, z: 0 } }] },
      } as never,
      model: { count: 2, positions: [0, 0, 0, 1, 1, 1], tangents: [], normals: [], segmentLengths: [], drums: [], bounds: { center: [0, 0, 0], size: 1 } },
      effects: [],
      projects: ['default'],
      output: { state: 'disabled', protocol: 'artnet', host: '1.2.3.4', packetsSent: 0, lastError: null, universeCount: 0 },
      showLibrary: null,
      songLibrary: null,
      tunnel: null,
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

  it('dispatches monitor messages and reports outbound sends', () => {
    const { client } = makeClient();
    const onMonitor = vi.fn();
    const onSend = vi.fn();
    client.on({ onMonitor, onSend });
    client.connect();
    const ws = FakeWS.instances[0]!;
    ws.open();

    client.send({ t: 'midi', note: 60, velocity: 100, on: true });
    ws.emitText(
      JSON.stringify({
        t: 'monitor',
        event: { id: 1, time: 1, type: 'input', direction: 'in', source: 'native-midi', label: 'MIDI note on 60' },
      } satisfies ServerMessage),
    );

    expect(onSend).toHaveBeenCalledWith({ t: 'midi', note: 60, velocity: 100, on: true });
    expect(onMonitor).toHaveBeenCalledWith({ id: 1, time: 1, type: 'input', direction: 'in', source: 'native-midi', label: 'MIDI note on 60' });
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

describe('WSClient — room PIN (S3)', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    FakeWS.instances = [];
  });
  afterEach(() => vi.useRealTimers());

  const factory = (url: string): WSLike => new FakeWS(url);

  it('appends the PIN to the connect URL', () => {
    const client = new WSClient({ url: 'ws://test/ws', factory, pin: '1234' });
    client.connect();
    expect(FakeWS.instances[0]!.url).toBe('ws://test/ws?pin=1234');
  });

  it('dials the bare URL when no PIN is set', () => {
    const client = new WSClient({ url: 'ws://test/ws', factory });
    client.connect();
    expect(FakeWS.instances[0]!.url).toBe('ws://test/ws');
  });

  it('a 4401 close fires onAuthError and pauses the reconnect loop', () => {
    const onAuthError = vi.fn();
    const client = new WSClient({ url: 'ws://test/ws', factory, baseDelayMs: 10, maxDelayMs: 100 });
    client.on({ onAuthError });
    client.connect();
    FakeWS.instances[0]!.closeWith(WS_CLOSE_INVALID_PIN);

    expect(onAuthError).toHaveBeenCalledTimes(1);
    expect(client.hasAuthError).toBe(true);
    // Backoff must NOT dial again — we'd just be refused forever.
    vi.advanceTimersByTime(500);
    expect(FakeWS.instances.length).toBe(1);
  });

  it('reconnectWithPin retries with the new PIN and clears the auth-paused state', () => {
    const client = new WSClient({ url: 'ws://test/ws', factory, baseDelayMs: 10, maxDelayMs: 100 });
    client.connect();
    FakeWS.instances[0]!.closeWith(WS_CLOSE_INVALID_PIN);
    expect(client.hasAuthError).toBe(true);

    client.reconnectWithPin('4242');
    expect(client.hasAuthError).toBe(false);
    expect(FakeWS.instances.length).toBe(2);
    expect(FakeWS.instances[1]!.url).toBe('ws://test/ws?pin=4242');
  });

  it('a normal (non-4401) close still reconnects', () => {
    const client = new WSClient({ url: 'ws://test/ws', factory, baseDelayMs: 10, maxDelayMs: 100 });
    client.connect();
    FakeWS.instances[0]!.open();
    FakeWS.instances[0]!.closeWith(1006); // abnormal closure, not an auth refusal
    expect(client.hasAuthError).toBe(false);
    vi.advanceTimersByTime(50);
    expect(FakeWS.instances.length).toBe(2);
  });
});
