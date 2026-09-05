import { EventEmitter } from 'node:events';
import { describe, expect, it } from 'vitest';
import type { DmxMap, OutputSettings } from '@ledrums/core';
import { ArtNetOutput, SacnOutput, type PixelSendCallback } from '@ledrums/io';
import { OutputManager } from './output-manager';

class Socket extends EventEmitter {
  packets: Array<{ bytes: Buffer; host: string; done: PixelSendCallback }> = [];
  closes = 0;
  bind(): void {}
  setBroadcast(): void {}
  setMulticastInterface(): void {}
  setMulticastTTL(): void {}
  send(packet: Uint8Array, _port: number, host: string, done: PixelSendCallback): void {
    this.packets.push({ bytes: Buffer.from(packet), host, done });
  }
  close(): void { this.closes++; this.emit('close'); }
}
const red = new Float32Array([1, 0, 0, 1]);
function map(...counts: number[]): DmxMap {
  return { perPixel: [], universes: counts.map((channelCount, i) => ({
    universe: i + 1, channelCount, pixels: [{ id: 0, channel: (i + 1) * 512, channelsPerPixel: 3 }],
  })) };
}

for (const protocol of ['artnet', 'sacn'] as const) {
  const settings: OutputSettings = {
    state: 'armed', protocol, host: '127.0.0.1', broadcast: false, rgbOrder: 'RGB', fps: 44, priority: 100,
  };
  function fixture() {
    const sockets: Socket[] = [];
    const manager = new OutputManager((opts) => {
      const socket = new Socket();
      sockets.push(socket);
      return protocol === 'artnet'
        ? new ArtNetOutput(opts, () => socket)
        : new SacnOutput(opts, () => socket);
    });
    return { manager, sockets };
  }
  const offset = protocol === 'artnet' ? 18 : 126;

  describe(`${protocol} manager → real adapter → fake UDP`, () => {
    it('sends full old wire coverage to the old destination, drains it before disposal, and fences late results', () => {
      const { manager, sockets } = fixture();
      manager.applySettings(settings, map(6, 6));
      sockets[0]!.emit('listening');
      manager.sendFrame(red, map(6, 6));
      sockets[0]!.packets.forEach((packet) => packet.done(null));
      expect(manager.status().packetsSent).toBe(2);
      manager.applySettings({ ...settings, host: '127.0.0.2' }, map(3));
      const old = sockets[0]!;
      expect(old.closes).toBe(0);
      expect(old.packets.slice(2).map((packet) => ({ host: packet.host, data: [...packet.bytes.subarray(offset)] })))
        .toEqual([
          { host: '127.0.0.1', data: [0, 0, 0, 0, 0, 0] },
          { host: '127.0.0.1', data: [0, 0, 0, 0, 0, 0] },
        ]);
      const fresh = sockets[1]!;
      fresh.emit('listening');
      manager.sendFrame(red, map(3));
      fresh.packets[0]!.done(null);
      expect(manager.status().packetsSent).toBe(3);
      old.packets[2]!.done(new Error('old blackout ENETUNREACH'));
      old.packets[3]!.done(null);
      expect(old.closes).toBe(1);
      expect(old.listenerCount('error')).toBe(0);
      expect(manager.status().lastError).toContain('old blackout ENETUNREACH');
      expect(manager.status().lastError).toContain('127.0.0.1');
      expect(manager.status().host).toBe('127.0.0.2');
      expect(manager.status().packetsSent).toBe(3); // retired completion cannot credit the new adapter
      manager.close();
      fresh.packets[1]!.done(null);
    });

    it('encodes same-universe shrink zeros before the new live data without waiting for completions', () => {
      const { manager, sockets } = fixture();
      manager.applySettings(settings, map(6));
      const socket = sockets[0]!;
      socket.emit('listening');
      manager.sendFrame(red, map(6));
      manager.applySettings(settings, map(3));
      manager.sendFrame(red, map(3));
      const [oldFrame, blackout, newFrame] = socket.packets;
      expect([...oldFrame!.bytes.subarray(offset)]).toEqual([255, 0, 0, 0, 0, 0]);
      expect([...blackout!.bytes.subarray(offset)]).toEqual([0, 0, 0, 0, 0, 0]);
      expect([...newFrame!.bytes.subarray(offset)]).toEqual(protocol === 'artnet' ? [255, 0, 0, 0] : [255, 0, 0]);
      expect(manager.status().packetsSent).toBe(0);
      socket.packets.forEach((packet) => packet.done(null));
      expect(manager.status().packetsSent).toBe(3);
      manager.close();
      socket.packets.at(-1)!.done(null);
    });
  });
}
