import { EventEmitter, once } from 'node:events';
import { createSocket } from 'node:dgram';
import { describe, expect, it, vi } from 'vitest';
import { ArtNetOutput } from './artnet';
import { SacnOutput } from './sacn';
import type { PixelOutputStatus } from './interfaces';

/** No network: the socket boundary controls bind and send completion independently. */
class FakeSocket extends EventEmitter {
  sends: Array<{ packet: Uint8Array; done: (error: Error | null) => void }> = [];
  bindError?: Error;
  setupError?: Error;
  sendError?: Error;
  boundAddress?: string;
  bind(options: { address?: string }): void {
    this.boundAddress = options.address;
    if (this.bindError) throw this.bindError;
  }
  setBroadcast(): void { if (this.setupError) throw this.setupError; }
  setMulticastInterface(): void { if (this.setupError) throw this.setupError; }
  setMulticastTTL(): void { if (this.setupError) throw this.setupError; }
  send(packet: Uint8Array, _port: number, _host: string, done: (error: Error | null) => void): void {
    if (this.sendError) throw this.sendError;
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

    it('does not let an older in-flight success hide a newer failure', () => {
      const { socket, output } = fixture();
      socket.emit('listening');
      const status = vi.fn();
      output.onStatus(status);
      output.send(1, new Uint8Array(3));
      output.send(2, new Uint8Array(3));
      socket.sends[1]!.done(new Error('newer failure'));
      socket.sends[0]!.done(null);
      expect(status.mock.lastCall![0]).toMatchObject({ state: 'error' });
      output.send(1, new Uint8Array(3));
      socket.sends[2]!.done(null);
      expect(status.mock.lastCall![0]).toEqual({ state: 'ready' });
      output.close();
    });

    it('surfaces synchronous bind, setup and send errors and bound-socket errors', () => {
      const socket = new FakeSocket();
      socket.bindError = new Error('bind threw');
      const output = protocol === 'artnet'
        ? new ArtNetOutput({ host: '127.0.0.1', broadcast: true, iface: '127.0.0.1' }, () => socket)
        : new SacnOutput({ host: '127.0.0.1', iface: '127.0.0.1' }, () => socket);
      expect(socket.boundAddress).toBe('127.0.0.1');
      const status = vi.fn();
      output.onStatus(status);
      expect(status.mock.lastCall![0]).toMatchObject({ state: 'error', phase: 'bind', message: 'Error: bind threw' });
      socket.setupError = new Error('setup threw');
      socket.emit('listening');
      expect(status.mock.lastCall![0]).toMatchObject({ state: 'error', phase: 'setup' });
      expect(output.send(1, new Uint8Array(3))).toBe(false);
      socket.setupError = undefined;
      socket.emit('listening');
      socket.emit('error', new Error('socket error'));
      expect(status.mock.lastCall![0]).toMatchObject({ state: 'error', phase: 'socket' });
      socket.sendError = new Error('send threw');
      const done = vi.fn();
      expect(() => output.send(1, new Uint8Array(3), done)).not.toThrow();
      expect(done).toHaveBeenCalledWith(socket.sendError);
      expect(status.mock.lastCall![0]).toMatchObject({ state: 'error', phase: 'send' });
      output.close();
    });

    it('bounds outstanding callbacks and reports backpressure instead of growing forever', () => {
      const { socket, output } = fixture();
      socket.emit('listening');
      const status = vi.fn();
      output.onStatus(status);
      for (let i = 0; i < 1024; i++) expect(output.send(1, new Uint8Array(3))).toBe(true);
      expect(output.send(1, new Uint8Array(3))).toBe(false);
      expect(socket.sends).toHaveLength(1024);
      expect(status.mock.lastCall![0]).toMatchObject({ state: 'error', code: 'EOUTPUTBACKPRESSURE' });
      socket.sends[0]!.done(null);
      expect(output.send(1, new Uint8Array(3))).toBe(true);
      socket.sends.forEach((send) => send.done(null));
      expect(status.mock.lastCall![0]).toEqual({ state: 'ready' });
      output.close();
    });

    it('observes an unexpected socket close and stops all further sends', () => {
      const { socket, output } = fixture();
      socket.emit('listening');
      const status = vi.fn();
      output.onStatus(status);
      const done = vi.fn();
      output.send(1, new Uint8Array(3), done);
      socket.emit('close');
      expect(status.mock.lastCall![0]).toEqual({ state: 'closed' });
      expect(output.send(1, new Uint8Array(3))).toBe(false);
      socket.sends[0]!.done(null);
      expect(done).not.toHaveBeenCalled();
      expect(socket.listenerCount('listening')).toBe(0);
    });

    it('bounds close drain time and discards late callbacks after timeout', () => {
      vi.useFakeTimers();
      try {
        const { socket, output } = fixture();
        socket.emit('listening');
        const sent = vi.fn();
        output.send(1, new Uint8Array(3), sent);
        const closed = vi.fn();
        output.close(closed);
        vi.advanceTimersByTime(250);
        expect(socket.closes).toBe(1);
        expect(closed.mock.lastCall![0].message).toContain('timed out');
        socket.sends[0]!.done(null);
        expect(sent).not.toHaveBeenCalled();
        expect(closed).toHaveBeenCalledTimes(1);
        expect(vi.getTimerCount()).toBe(0);
      } finally { vi.useRealTimers(); }
    });

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

    it('closes a real socket during its loopback bind without becoming ready later', async () => {
      const output = protocol === 'artnet'
        ? new ArtNetOutput({ host: '127.0.0.1', iface: '127.0.0.1' })
        : new SacnOutput({ host: '127.0.0.1', iface: '127.0.0.1' });
      const statuses: PixelOutputStatus[] = [];
      output.onStatus((status) => statuses.push(status));
      await new Promise<void>((resolve, reject) => output.close((error) => error ? reject(error) : resolve()));
      await new Promise<void>((resolve) => setImmediate(resolve));
      expect(statuses).toEqual([{ state: 'binding' }, { state: 'closed' }]);
    });

    it('sends real encoded UDP only over loopback, including a queued packet drained by close', async () => {
      const receiver = createSocket('udp4');
      receiver.bind(0, '127.0.0.1');
      await once(receiver, 'listening');
      const port = receiver.address().port;
      const output = protocol === 'artnet'
        ? new ArtNetOutput({ host: '127.0.0.1', port, iface: '127.0.0.1' })
        : new SacnOutput({ host: '127.0.0.1', port, iface: '127.0.0.1' });
      try {
        await new Promise<void>((resolve, reject) => output.onStatus((status) => {
          if (status.state === 'ready') resolve();
          if (status.state === 'error') reject(new Error(status.message));
        }));
        output.nextFrame();
        const received = once(receiver, 'message', { signal: AbortSignal.timeout(2000) });
        await new Promise<void>((resolve, reject) => {
          expect(output.send(7, new Uint8Array([17, 34, 51]), (error) => error ? reject(error) : resolve())).toBe(true);
        });
        const [packet] = await received;
        const offset = protocol === 'artnet' ? 18 : 126;
        expect([...packet.subarray(offset, offset + 3)]).toEqual([17, 34, 51]);
        expect(packet[protocol === 'artnet' ? 12 : 111]).toBe(1);
        expect(protocol === 'artnet' ? packet.readUInt16LE(14) : packet.readUInt16BE(113)).toBe(7);
        const drained = once(receiver, 'message', { signal: AbortSignal.timeout(2000) });
        output.send(7, new Uint8Array(6));
        await new Promise<void>((resolve, reject) => output.close((error) => error ? reject(error) : resolve()));
        const [blackout] = await drained;
        expect([...blackout.subarray(offset)]).toEqual([0, 0, 0, 0, 0, 0]);
      } finally {
        output.close();
        receiver.close();
      }
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
