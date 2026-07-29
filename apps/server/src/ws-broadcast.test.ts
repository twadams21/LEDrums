import { describe, expect, it } from 'vitest';
import { ClientRegistry } from './client-registry';
import { encodeServer } from './ws-protocol';
import { BACKPRESSURE_BYTES, SLOW_PEER_SWEEPS, createBroadcaster, type BroadcastSocket } from './ws-broadcast';

/** Fake socket recording exactly what it was sent (payload + binary flag). */
class FakeSocket implements BroadcastSocket {
  readonly OPEN = 1;
  readyState = 1;
  bufferedAmount = 0;
  terminated = false;
  readonly sent: { data: string | Uint8Array; binary: boolean }[] = [];
  send(data: string | Uint8Array, opts?: { binary?: boolean }): void {
    this.sent.push({ data, binary: opts?.binary ?? false });
  }
  close(): void {}
  terminate(): void {
    this.terminated = true;
    this.readyState = 3;
  }
  types(): string[] {
    return this.sent.filter((m) => !m.binary).map((m) => (JSON.parse(m.data as string) as { t: string }).t);
  }
}

const STATS = { t: 'stats', stats: {}, latencyMs: 0, fps: 0 } as never;

function harness(count: number) {
  const clients = new ClientRegistry<FakeSocket>();
  const sockets: FakeSocket[] = [];
  for (let i = 0; i < count; i++) {
    const s = new FakeSocket();
    clients.admit(s);
    sockets.push(s);
  }
  const dead: FakeSocket[] = [];
  const errors: { label: string; detail?: string }[] = [];
  const broadcaster = createBroadcaster<FakeSocket>({
    clients,
    encode: encodeServer,
    onSlowPeerDead: (ws) => {
      clients.remove(ws);
      dead.push(ws);
    },
    monitor: (e) => {
      if (e.type === 'error') errors.push({ label: e.label, detail: e.detail });
    },
  });
  return { clients, sockets, dead, errors, broadcaster, ...broadcaster };
}

describe('createBroadcaster (S11 — pins today\'s contract)', () => {
  it('broadcastJson: only OPEN sockets receive; the payload is encoded ONCE (same string to all)', () => {
    const { sockets, broadcastJson } = harness(3);
    sockets[1]!.readyState = 3; // CLOSED
    broadcastJson({ t: 'projects', names: ['a'] });
    expect(sockets[0]!.sent).toHaveLength(1);
    expect(sockets[1]!.sent).toHaveLength(0);
    expect(sockets[2]!.sent).toHaveLength(1);
    expect(sockets[0]!.sent[0]!.data).toBe(sockets[2]!.sent[0]!.data); // same reference
    expect(sockets[0]!.sent[0]!.binary).toBe(false);
  });

  it('broadcastBinary passes { binary: true } to every OPEN socket', () => {
    const { sockets, broadcastBinary } = harness(2);
    const rgb = new Uint8Array([1, 2, 3]);
    broadcastBinary(rgb);
    for (const s of sockets) {
      expect(s.sent).toHaveLength(1);
      expect(s.sent[0]!.data).toBe(rgb);
      expect(s.sent[0]!.binary).toBe(true);
    }
  });

  it('broadcastPresence sends a per-socket payload (two sockets get different youAreEditor)', () => {
    const { sockets, broadcastPresence } = harness(2);
    broadcastPresence();
    const p0 = JSON.parse(sockets[0]!.sent[0]!.data as string) as { t: string; youAreEditor: boolean };
    const p1 = JSON.parse(sockets[1]!.sent[0]!.data as string) as { t: string; youAreEditor: boolean };
    expect(p0.t).toBe('presence');
    expect(p0.youAreEditor).toBe(true); // first admitted client claims the editor slot
    expect(p1.youAreEditor).toBe(false);
  });

  it('relayToOthers excludes the sender and ONLY the sender', () => {
    const { sockets, relayToOthers } = harness(3);
    relayToOthers(sockets[1]!, { t: 'projects', names: [] });
    expect(sockets[0]!.sent).toHaveLength(1);
    expect(sockets[1]!.sent).toHaveLength(0);
    expect(sockets[2]!.sent).toHaveLength(1);
  });
});

describe('backpressure guard (S14 — resilience-hole-0005)', () => {
  it('the threshold and strike count are the named constants (a value change is a visible test change)', () => {
    expect(BACKPRESSURE_BYTES).toBe(1_000_000);
    expect(SLOW_PEER_SWEEPS).toBe(3);
  });

  it('an over-threshold socket is skipped on stats + preview while its OPEN sibling receives, counted on stats()', () => {
    const { sockets, broadcastJson, broadcastBinary, stats } = harness(2);
    sockets[0]!.bufferedAmount = 2_000_000;
    broadcastJson(STATS);
    broadcastBinary(new Uint8Array([1]));
    expect(sockets[0]!.sent).toHaveLength(0);
    expect(sockets[1]!.sent).toHaveLength(2);
    expect(stats().skipped).toBe(2);
  });

  it('the SAME over-threshold socket still receives state, presence, monitor and error frames', () => {
    const { sockets, broadcastJson, broadcastPresence } = harness(2);
    const slow = sockets[0]!;
    slow.bufferedAmount = 2_000_000;
    broadcastJson({ t: 'error', message: 'x' });
    broadcastJson({ t: 'monitor', event: { id: 1, at: 0, type: 'system', direction: 'local', source: 's', label: 'l' } } as never);
    broadcastJson({ t: 'projects', names: [] }); // event-driven stand-in for state
    broadcastPresence();
    expect(slow.types()).toEqual(['error', 'monitor', 'projects', 'presence']);
  });

  it('a socket back under the threshold resumes receiving and its consecutive-over counter resets to 0', () => {
    const { sockets, broadcastJson, sweepSlowPeers } = harness(1);
    const ws = sockets[0]!;
    ws.bufferedAmount = 2_000_000;
    sweepSlowPeers();
    sweepSlowPeers(); // 2 strikes — one short of termination
    ws.bufferedAmount = 0;
    sweepSlowPeers(); // recovered → counter resets
    broadcastJson(STATS);
    expect(ws.types()).toEqual(['stats']);
    ws.bufferedAmount = 2_000_000;
    sweepSlowPeers();
    sweepSlowPeers(); // 2 fresh strikes — would be 4th/5th had the counter survived
    expect(ws.terminated).toBe(false);
  });

  it('strikes advance ONLY on the sweep clock: 10_000 broadcasts advance the counter by ZERO; three sweeps terminate', () => {
    const { sockets, dead, broadcastJson, sweepSlowPeers } = harness(1);
    const ws = sockets[0]!;
    ws.bufferedAmount = 2_000_000;
    for (let i = 0; i < 10_000; i++) broadcastJson(STATS);
    expect(ws.terminated).toBe(false); // no broadcast-clock strikes
    expect(dead).toEqual([]);
    sweepSlowPeers();
    sweepSlowPeers();
    expect(ws.terminated).toBe(false); // 2 of 3
    sweepSlowPeers();
    expect(ws.terminated).toBe(true);
  });

  it('at the third sweep the socket is terminated exactly once, reaped via onDead, and receives no further sends', () => {
    const { sockets, dead, broadcastJson, broadcastPresence, sweepSlowPeers } = harness(2);
    const slow = sockets[0]!;
    slow.bufferedAmount = 2_000_000;
    sweepSlowPeers();
    sweepSlowPeers();
    sweepSlowPeers();
    expect(dead).toEqual([slow]);
    const after = slow.sent.length;
    sweepSlowPeers(); // no double-terminate on later sweeps
    broadcastJson({ t: 'projects', names: [] });
    broadcastPresence();
    expect(slow.sent.length).toBe(after); // removed from the registry — no further sends
    expect(sockets[1]!.types()).toContain('projects');
  });

  it('the monitor sink gets exactly one error event naming the dropped peer', () => {
    const { sockets, errors, sweepSlowPeers } = harness(2);
    sockets[1]!.bufferedAmount = 2_000_000;
    for (let i = 0; i < 5; i++) sweepSlowPeers();
    expect(errors).toHaveLength(1);
    expect(errors[0]!.label).toBe('Slow WebSocket client terminated');
    expect(errors[0]!.detail).toContain('c2'); // the registry id of the second-admitted socket
  });
});
