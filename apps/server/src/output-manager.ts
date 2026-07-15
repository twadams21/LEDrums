import {
  CHANNELS_PER_UNIVERSE,
  toByte,
  type DmxMap,
  type OutputSettings,
  type RgbOrder,
  type UniversePatch,
} from '@ledrums/core';
import { ArtNetOutput, SacnOutput, type PixelOutput } from '@ledrums/io';
import { createOutputMonitorCoalescer, outputDestination, universeRangeLabel } from './output-monitor';
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
 * universe. RGB ordering is applied PER-PIXEL from its owning output's `rgbOrder` (B5),
 * so a universe spanning two outputs of different orders is byte-exact; a pixel whose
 * output declared no order uses `fallbackOrder`. Any channels beyond R/G/B (e.g. the W of
 * RGBW) stay zero.
 */
export function frameToUniverseBytes(rgba: Float32Array, patch: UniversePatch, fallbackOrder: RgbOrder): Uint8Array {
  const base = patch.universe * CHANNELS_PER_UNIVERSE;
  const out = new Uint8Array(patch.channelCount);
  for (const px of patch.pixels) {
    const j = px.id * 4;
    const [r, g, b] = applyRgbOrder(px.rgbOrder ?? fallbackOrder, toByte(rgba[j]!), toByte(rgba[j + 1]!), toByte(rgba[j + 2]!));
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

export interface OutputManagerOptions {
  now?: () => number;
  monitorWindowMs?: number;
}

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
  private settingsMonitorSignature = '';
  private readonly now: () => number;
  private readonly outputDiag: ReturnType<typeof createOutputMonitorCoalescer>;
  /** Active hoop-identify override (E1): pixels [start,end) are forced full-on until `expiresAt`
   * (ms on this manager's clock). Composited over the live frame in {@link sendFrame} — a bounded,
   * fire-and-forget override that NEVER blocks or mutates the engine's frame buffer. */
  private identify: { start: number; end: number; expiresAt: number } | null = null;
  onMonitor?: OutputMonitorSink;

  constructor(
    private readonly factory: OutputFactory = defaultFactory,
    opts: OutputManagerOptions = {},
  ) {
    this.now = opts.now ?? (() => performance.now());
    this.outputDiag = createOutputMonitorCoalescer({ windowMs: opts.monitorWindowMs });
  }

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
          this.monitorError('Output setup failed', settings, this.lastError);
        }
      }
    } else {
      // Leaving armed: blackout the rig, then drop the transport.
      this.teardown(dmxMap, settings);
    }
    this.settings = settings;
    this.monitorSettings(settings, dmxMap);
  }

  private teardown(dmxMap: DmxMap, settings: OutputSettings): void {
    if (this.output) {
      this.blackout(dmxMap);
      this.output.close();
      this.output = null;
      this.signature = '';
    }
  }

  /**
   * Arm/refresh a fire-and-forget hoop identify (E1): force pixels `[range.start, range.end)`
   * full-on for `durationMs`, composited over the live frame. `null` range or `durationMs <= 0`
   * clears any active identify. Bounded by construction (self-clears at `expiresAt`); the render
   * loop is never blocked — the override is applied per-frame in {@link sendFrame} on a scratch copy.
   */
  setIdentify(range: { start: number; end: number } | null, durationMs: number): void {
    if (!range || durationMs <= 0 || range.end <= range.start) {
      this.identify = null;
      return;
    }
    this.identify = { start: range.start, end: range.end, expiresAt: this.now() + durationMs };
  }

  /** The active (non-expired) identify pixel range, or `null` when none is armed. Lets callers
   * (and tests) observe what the next frame will override, without touching the transmit path. */
  identifyRange(): { start: number; end: number } | null {
    const id = this.identify;
    if (!id) return null;
    if (this.now() >= id.expiresAt) {
      this.identify = null;
      return null;
    }
    return { start: id.start, end: id.end };
  }

  /** Return the frame to transmit: `rgba` untouched when no identify is armed (zero hot-path cost),
   * or a scratch COPY with the identify range forced full-on white. Never mutates the caller's
   * buffer (the engine's live framebuffer). Expiry clears the override lazily here. */
  private withIdentify(rgba: Float32Array): Float32Array {
    const id = this.identify;
    if (!id) return rgba;
    if (this.now() >= id.expiresAt) {
      this.identify = null;
      return rgba;
    }
    const out = rgba.slice();
    const end = Math.min(id.end, Math.floor(out.length / 4));
    for (let p = Math.max(0, id.start); p < end; p++) {
      const j = p * 4;
      out[j] = 1;
      out[j + 1] = 1;
      out[j + 2] = 1;
      out[j + 3] = 1;
    }
    return out;
  }

  /** Send a rendered frame according to the current state. */
  sendFrame(rgba: Float32Array, dmxMap: DmxMap): void {
    const s = this.settings;
    if (!s || s.state === 'disabled') return;
    if (s.state === 'dry-run') {
      this.packetsSent += dmxMap.universes.length; // formed, not transmitted
      this.monitorPacketSummary({
        settings: s,
        kind: 'dry-run',
        universes: dmxMap.universes.map((patch) => patch.universe),
        packets: dmxMap.universes.length,
        nowMs: this.now(),
      });
      return;
    }
    if (!this.output) return;
    // Composite the hoop-identify override (E1) onto a scratch copy — full-on for the identified
    // hoop, live frame everywhere else. No-op (same buffer) when nothing is armed.
    const frame = this.withIdentify(rgba);
    try {
      this.output.nextFrame();
      let packets = 0;
      let byteCount = 0;
      const universes: number[] = [];
      for (const patch of dmxMap.universes) {
        // Per-pixel RGB order (B5) comes from each pixel's owning output; the controller-level
        // `s.rgbOrder` is only the fallback for pixels whose output declared none (parity with
        // pre-B5 single-order behaviour).
        const bytes = frameToUniverseBytes(frame, patch, s.rgbOrder);
        this.output.send(patch.universe, bytes);
        this.packetsSent++;
        packets++;
        byteCount += bytes.length;
        universes.push(patch.universe);
      }
      this.monitorPacketSummary({
        settings: s,
        kind: 'packet',
        universes,
        byteCount,
        packets,
        nowMs: this.now(),
      });
    } catch (err) {
      this.lastError = String(err);
      this.monitorError('Output send failed', s, this.lastError);
      this.blackout(dmxMap);
    }
  }

  /** Transmit an all-zero frame across every universe (failsafe). */
  blackout(dmxMap: DmxMap): void {
    if (!this.output) return;
    try {
      this.output.nextFrame();
      let packets = 0;
      const universes: number[] = [];
      for (const patch of dmxMap.universes) {
        const zero = new Uint8Array(patch.channelCount);
        this.output.send(patch.universe, zero);
        packets++;
        universes.push(patch.universe);
      }
      if (this.settings) {
        this.onMonitor?.({
          type: 'output',
          direction: 'out',
          source: 'server',
          destination: outputDestination(this.settings),
          label: 'Blackout sent',
          detail: `packets=${packets}; universes=${universeRangeLabel(universes)}`,
        });
      }
    } catch (err) {
      this.lastError = String(err);
      if (this.settings) this.monitorError('Output blackout failed', this.settings, this.lastError);
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

  private monitorPacketSummary(sample: Parameters<typeof this.outputDiag.record>[0]): void {
    const event = this.outputDiag.record(sample);
    if (event) this.onMonitor?.(event);
  }

  private monitorSettings(settings: OutputSettings, dmxMap: DmxMap): void {
    const signature = `${settings.state}|${settings.protocol}|${settings.host}|${settings.broadcast}|${settings.port ?? ''}|${settings.fps}|${dmxMap.universes.length}`;
    if (signature === this.settingsMonitorSignature) return;
    this.settingsMonitorSignature = signature;

    const label = settings.state === 'armed' ? 'Output armed' : settings.state === 'dry-run' ? 'Output dry-run' : 'Output disabled';
    this.onMonitor?.({
      type: 'output',
      direction: 'out',
      source: 'server',
      destination: outputDestination(settings),
      label,
      detail: `protocol=${settings.protocol}; fps=${settings.fps}; universes=${dmxMap.universes.length}`,
    });
  }

  private monitorError(label: string, settings: OutputSettings, detail: string): void {
    this.onMonitor?.({
      type: 'error',
      direction: 'out',
      source: 'server/output',
      destination: outputDestination(settings),
      label,
      detail,
    });
  }
}
