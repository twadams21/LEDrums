import { describe, expect, it } from 'vitest';
import { ClientRegistry } from './client-registry';
import { encodeServer } from './ws-protocol';
import { createBroadcaster, type BroadcastSocket } from './ws-broadcast';

/** Fake socket recording exactly what it was sent (payload + binary flag). */
class FakeSocket implements BroadcastSocket {
  readonly OPEN = 1;
  readyState = 1;
  readonly sent: { data: string | Uint8Array; binary: boolean }[] = [];
  send(data: string | Uint8Array, opts?: { binary?: boolean }): void {
    this.sent.push({ data, binary: opts?.binary ?? false });
  }
  close(): void {}
}

function harness(count: number) {
  const clients = new ClientRegistry<FakeSocket>();
  const sockets: FakeSocket[] = [];
  for (let i = 0; i < count; i++) {
    const s = new FakeSocket();
    clients.admit(s);
    sockets.push(s);
  }
  const broadcaster = createBroadcaster<FakeSocket>({ clients, encode: encodeServer });
  return { clients, sockets, ...broadcaster };
}

describe('createBroadcaster (S11 — pins today\'s contract, no guard yet)', () => {
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
