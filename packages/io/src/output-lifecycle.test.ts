import { EventEmitter } from 'node:events';
import { describe, expect, it, vi } from 'vitest';
import { ArtNetOutput } from './artnet';
import { SacnOutput } from './sacn';
import type { PixelOutputStatus } from './interfaces';

/** No network: the socket boundary controls bind and send completion independently. */
class FakeSocket extends EventEmitter {
  sends: Array<{ packet: Uint8Array; done: (error: Error | null) => void }> = [];
  bind(): void {}
  setBroadcast(): void {}
  setMulticastInterface(): void {}
  setMulticastTTL(): void {}
  send(packet: Uint8Array, _port: number, _host: string, done: (error: Error | null) => void): void {
    this.sends.push({ packet, done });
  }
  closes = 0;
  close(): void { this.closes++; this.emit('close'); }
}

for (const protocol of ['artnet', 'sacn'] as const) {
  describe(`${protocol} lifecycle`, () => {
    function fixture() {
      const socket = new FakeSocket();
      const output = protocol === 'artnet'
        ? new ArtNetOutput({ host: '127.0.0.1' }, () => socket)
        : new SacnOutput({ host: '127.0.0.1' }, () => socket);
      return { socket, output };
    }

    it('reports async send failure, local acceptance and recovery without awaiting the socket', () => {
      const { socket, output } = fixture();
      const states: PixelOutputStatus[] = [];
      output.onStatus((status) => states.push(status));
      socket.emit('listening');
      const completions: Array<Error | null> = [];
      expect(output.send(1, new Uint8Array([255, 0, 0]), (e) => completions.push(e))).toBe(true);
      expect(completions).toEqual([]);
      const error = Object.assign(new Error('network unreachable'), { code: 'ENETUNREACH' });
      socket.sends[0]!.done(error);
      expect(completions).toEqual([error]);
      expect(states.at(-1)).toMatchObject({ state: 'error', phase: 'send', code: 'ENETUNREACH' });
      output.send(1, new Uint8Array(3), (e) => completions.push(e));
      socket.sends[1]!.done(null);
      expect(completions).toEqual([error, null]);
      expect(states.at(-1)).toEqual({ state: 'ready' });
      output.close();
    });

    it('drains queued datagrams on close, releases callbacks and reports drain errors separately', () => {
      const { socket, output } = fixture();
      socket.emit('listening');
      const status = vi.fn();
      output.onStatus(status);
      const sent = vi.fn();
      output.send(1, new Uint8Array(3), sent);
      const closed = vi.fn();
      output.close(closed);
      expect(output.send(1, new Uint8Array(3))).toBe(false);
      expect(socket.closes).toBe(0); // don't tear down before the blackout reaches local UDP
      const error = new Error('late send failure');
      socket.sends[0]!.done(error);
      expect(socket.closes).toBe(1);
      expect(closed).toHaveBeenCalledTimes(1);
      expect(closed).toHaveBeenCalledWith(error);
      expect(sent).not.toHaveBeenCalled();
      expect(status).toHaveBeenCalledTimes(2); // ready + closed only
      expect(socket.listenerCount('error')).toBe(0);
      expect(socket.listenerCount('listening')).toBe(0);
      output.close();
      expect(socket.closes).toBe(1);
    });

    it('close during bind cannot resurrect readiness or retain subscriptions', () => {
      const { socket, output } = fixture();
      const status = vi.fn();
      output.onStatus(status);
      output.close();
      socket.emit('listening');
      expect(status.mock.calls.map(([s]) => s.state)).toEqual(['binding', 'closed']);
      expect(output.send(1, new Uint8Array(3))).toBe(false);
      expect(socket.listenerCount('listening')).toBe(0);
      expect(socket.listenerCount('error')).toBe(0);
    });

    it('replays bind readiness/errors and never reports a pre-bind send as accepted', () => {
      const socket = new FakeSocket();
      const output = protocol === 'artnet'
        ? new ArtNetOutput({ host: '127.0.0.1' }, () => socket)
        : new SacnOutput({ host: '127.0.0.1' }, () => socket);
      const states: PixelOutputStatus[] = [];
      output.onStatus((status) => states.push(status));
      expect(states).toEqual([{ state: 'binding' }]);
      expect(output.send(1, new Uint8Array([255, 0, 0]))).toBe(false);
      expect(socket.sends).toHaveLength(0);
      socket.emit('error', Object.assign(new Error('bad interface'), { code: 'EADDRNOTAVAIL' }));
      expect(states.at(-1)).toMatchObject({ state: 'error', phase: 'bind', code: 'EADDRNOTAVAIL' });
      const replay: PixelOutputStatus[] = [];
      const unsubscribe = output.onStatus((status) => replay.push(status));
      expect(replay).toEqual([states.at(-1)]);
      unsubscribe();
      output.close();
    });
  });
}
