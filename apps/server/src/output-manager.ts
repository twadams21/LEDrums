import {
  CHANNELS_PER_UNIVERSE,
  toByte,
  type DmxMap,
  type OutputSettings,
  type RgbOrder,
  type UniversePatch,
} from '@ledrums/core';
import { ArtNetOutput, SacnOutput, type PixelOutput } from '@ledrums/io';
import type { MonitorEvent } from './ws-protocol';
import type { OutputStatus } from './ws-protocol';

/** Reorder RGB bytes for a strip's wiring order (e.g. GRB). */
export function applyRgbOrder(order: RgbOrder, r: number, g: number, b: number): [number, number, number] {
  const ch: Record<string, number> = { R: r, G: g, B: b };
  return [ch[order[0]!]!, ch[order[1]!]!, ch[order[2]!]!];
}

/**
 * Build one universe's channel bytes from the frame. Pixels pack channel-DENSE in the
 * global stream (see core `buildDmxMap`), so each pixel writes its `channelsPerPixel`
 * channels at their GLOBAL positions, clipped to this universe's `[U*512, U*512+512)`
 * window — a pixel straddling the boundary writes part here and the rest in the next
 * universe. RGB ordering is applied; any channels beyond R/G/B (e.g. the W of RGBW)
 * stay zero.
 */
export function frameToUniverseBytes(rgba: Float32Array, patch: UniversePatch, rgbOrder: RgbOrder): Uint8Array {
  const base = patch.universe * CHANNELS_PER_UNIVERSE;
  const out = new Uint8Array(patch.channelCount);
  for (const px of patch.pixels) {
    const j = px.id * 4;
    const [r, g, b] = applyRgbOrder(rgbOrder, toByte(rgba[j]!), toByte(rgba[j + 1]!), toByte(rgba[j + 2]!));
    for (let n = 0; n < px.channelsPerPixel; n++) {
      const local = px.channel + n - base; // channel position within this universe
      if (local < 0 || local >= patch.channelCount) continue; // belongs to an adjacent universe
      out[local] = n === 0 ? r : n === 1 ? g : n === 2 ? b : 0;
    }
  }
  return out;
}

export type OutputFactory = (settings: OutputSettings) => PixelOutput;
export type OutputMonitorSink = (event: Omit<MonitorEvent, 'id' | 'time'>) => void;

function defaultFactory(settings: OutputSettings): PixelOutput {
  if (settings.protocol === 'sacn') {
    return new SacnOutput({
      host: settings.broadcast ? undefined : settings.host,
      port: settings.port,
      iface: settings.iface,
      priority: settings.priority,
    });
  }
  return new ArtNetOutput({
    host: settings.host,
    port: settings.port,
    broadcast: settings.broadcast,
    iface: settings.iface,
  });
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
  onMonitor?: OutputMonitorSink;

  constructor(private readonly factory: OutputFactory = defaultFactory) {}

  applySettings(settings: OutputSettings, dmxMap: DmxMap): void {
    this.universeCount = dmxMap.universes.length;
    // priority + iface are baked into the sender at construction, so a change to either must
    // re-create the transport (alongside protocol/host/broadcast/port).
    const sig = `${settings.protocol}|${settings.host}|${settings.broadcast}|${settings.port ?? ''}|${settings.iface ?? ''}|${settings.priority}`;
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
      this.blackout(dmxMap);
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
      this.monitor('dry-run', s, dmxMap.universes.length);
      return;
    }
    if (!this.output) return;
    try {
      this.output.nextFrame();
      for (const patch of dmxMap.universes) {
        const bytes = frameToUniverseBytes(rgba, patch, s.rgbOrder);
        this.output.send(patch.universe, bytes);
        this.packetsSent++;
        this.monitor('packet', s, 1, patch.universe, bytes.length);
      }
    } catch (err) {
      this.lastError = String(err);
      this.blackout(dmxMap);
    }
  }

  /** Transmit an all-zero frame across every universe (failsafe). */
  blackout(dmxMap: DmxMap): void {
    if (!this.output) return;
    try {
      this.output.nextFrame();
      for (const patch of dmxMap.universes) {
        const zero = new Uint8Array(patch.channelCount);
        this.output.send(patch.universe, zero);
        if (this.settings) this.monitor('blackout', this.settings, 1, patch.universe, zero.length);
      }
    } catch (err) {
      this.lastError = String(err);
    }
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

  private monitor(kind: string, settings: OutputSettings, packets: number, universe?: number, byteCount?: number): void {
    this.onMonitor?.({
      type: 'output',
      direction: 'out',
      source: 'server',
      destination: `${settings.protocol}:${settings.broadcast ? 'broadcast' : settings.host}:${settings.port}`,
      label: universe === undefined ? `${settings.protocol} ${kind}` : `${settings.protocol} universe ${universe}`,
      detail: `${kind}; packets=${packets}${byteCount === undefined ? '' : `; bytes=${byteCount}`}`,
    });
  }
}
