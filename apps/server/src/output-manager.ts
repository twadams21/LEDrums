import { toByte, type DmxMap, type OutputSettings, type RgbOrder, type UniversePatch } from '@ledrums/core';
import { ArtNetOutput, SacnOutput, type PixelOutput } from '@ledrums/io';
import type { OutputStatus } from './ws-protocol';

/** Reorder RGB bytes for a strip's wiring order (e.g. GRB). */
export function applyRgbOrder(order: RgbOrder, r: number, g: number, b: number): [number, number, number] {
  const ch: Record<string, number> = { R: r, G: g, B: b };
  return [ch[order[0]!]!, ch[order[1]!]!, ch[order[2]!]!];
}

/** Build one universe's channel bytes from the frame, in patch order with RGB ordering. */
export function frameToUniverseBytes(rgba: Float32Array, patch: UniversePatch, rgbOrder: RgbOrder): Uint8Array {
  const cpp = patch.channelsPerPixel;
  const out = new Uint8Array(patch.pixelIds.length * cpp);
  for (let k = 0; k < patch.pixelIds.length; k++) {
    const j = patch.pixelIds[k]! * 4;
    const [r, g, b] = applyRgbOrder(rgbOrder, toByte(rgba[j]!), toByte(rgba[j + 1]!), toByte(rgba[j + 2]!));
    out[k * cpp] = r;
    out[k * cpp + 1] = g;
    out[k * cpp + 2] = b;
  }
  return out;
}

export type OutputFactory = (settings: OutputSettings) => PixelOutput;

function defaultFactory(settings: OutputSettings): PixelOutput {
  if (settings.protocol === 'sacn') {
    return new SacnOutput({ host: settings.broadcast ? undefined : settings.host, iface: settings.iface });
  }
  return new ArtNetOutput({ host: settings.host, port: settings.port, broadcast: settings.broadcast });
}

/**
 * Output state machine (R15): `disabled → dry-run → armed`, defaulting to disabled.
 * Dry-run forms/counts packets without transmitting; arming opens a transport; any
 * transition away from armed, or a send error, emits a blackout failsafe.
 */
export class OutputManager {
  private output: PixelOutput | null = null;
  private settings: OutputSettings | null = null;
  private signature = '';
  private packetsSent = 0;
  private lastError: string | null = null;
  private universeCount = 0;

  constructor(private readonly factory: OutputFactory = defaultFactory) {}

  applySettings(settings: OutputSettings, dmxMap: DmxMap): void {
    this.universeCount = dmxMap.universes.length;
    const sig = `${settings.protocol}|${settings.host}|${settings.broadcast}|${settings.port ?? ''}`;
    if (settings.state === 'armed') {
      if (!this.output || sig !== this.signature) {
        this.teardown(dmxMap, settings);
        try {
          this.output = this.factory(settings);
          this.signature = sig;
          this.lastError = null;
        } catch (err) {
          this.lastError = String(err);
          this.output = null;
        }
      }
    } else {
      // Leaving armed: blackout the rig, then drop the transport.
      this.teardown(dmxMap, settings);
    }
    this.settings = settings;
  }

  private teardown(dmxMap: DmxMap, settings: OutputSettings): void {
    if (this.output) {
      this.blackout(dmxMap, settings.rgbOrder);
      this.output.close();
      this.output = null;
      this.signature = '';
    }
  }

  /** Send a rendered frame according to the current state. */
  sendFrame(rgba: Float32Array, dmxMap: DmxMap): void {
    const s = this.settings;
    if (!s || s.state === 'disabled') return;
    if (s.state === 'dry-run') {
      this.packetsSent += dmxMap.universes.length; // formed, not transmitted
      return;
    }
    if (!this.output) return;
    try {
      this.output.nextFrame();
      for (const patch of dmxMap.universes) {
        this.output.send(patch.universe, frameToUniverseBytes(rgba, patch, s.rgbOrder));
        this.packetsSent++;
      }
    } catch (err) {
      this.lastError = String(err);
      this.blackout(dmxMap, s.rgbOrder);
    }
  }

  /** Transmit an all-zero frame across every universe (failsafe). */
  blackout(dmxMap: DmxMap, rgbOrder: RgbOrder): void {
    if (!this.output) return;
    try {
      this.output.nextFrame();
      for (const patch of dmxMap.universes) {
        const zero = new Uint8Array(patch.pixelIds.length * patch.channelsPerPixel);
        this.output.send(patch.universe, zero);
      }
    } catch (err) {
      this.lastError = String(err);
    }
    void rgbOrder;
  }

  status(): OutputStatus {
    return {
      state: this.settings?.state ?? 'disabled',
      protocol: this.settings?.protocol ?? 'artnet',
      host: this.settings?.host ?? '',
      packetsSent: this.packetsSent,
      lastError: this.lastError,
      universeCount: this.universeCount,
    };
  }

  close(): void {
    if (this.output) {
      this.output.close();
      this.output = null;
    }
  }
}
