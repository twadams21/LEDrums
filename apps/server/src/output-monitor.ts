import type { OutputSettings } from '@ledrums/core';
import type { MonitorEvent } from './ws-protocol';

export type OutputMonitorDraft = Omit<MonitorEvent, 'id' | 'time'>;

export interface OutputPacketSample {
  settings: OutputSettings;
  kind: 'packet' | 'dry-run';
  universe?: number;
  universes?: Iterable<number>;
  byteCount?: number;
  packets: number;
  nowMs: number;
}

export interface OutputMonitorCoalescerOptions {
  windowMs?: number;
}

export function outputDestination(settings: OutputSettings): string {
  return `${settings.protocol}:${settings.broadcast ? 'broadcast' : settings.host}:${settings.port ?? ''}`;
}

export function universeRangeLabel(universes: Iterable<number>): string {
  const sorted = [...universes].sort((a, b) => a - b);
  if (sorted.length === 0) return 'none';
  if (sorted.length === 1) return `U${sorted[0]}`;
  return `U${sorted[0]}..U${sorted[sorted.length - 1]}`;
}

export function createOutputMonitorCoalescer(opts: OutputMonitorCoalescerOptions = {}) {
  const windowMs = opts.windowMs ?? 1000;

  let windowStart = 0;
  let protocol = '';
  let destination = '';
  let kind: OutputPacketSample['kind'] = 'packet';
  let frames = 0;
  let packets = 0;
  let bytes = 0;
  const universes = new Set<number>();

  function record(sample: OutputPacketSample): OutputMonitorDraft | null {
    if (windowStart === 0) windowStart = sample.nowMs;

    protocol = sample.settings.protocol;
    destination = outputDestination(sample.settings);
    kind = sample.kind;
    frames += 1;
    packets += sample.packets;
    bytes += sample.byteCount ?? 0;
    if (sample.universe !== undefined) universes.add(sample.universe);
    if (sample.universes) {
      for (const universe of sample.universes) universes.add(universe);
    }

    if (sample.nowMs - windowStart < windowMs) return null;
    return flush(sample.nowMs);
  }

  function flush(nowMs: number): OutputMonitorDraft | null {
    if (frames === 0 && packets === 0) return null;

    const event: OutputMonitorDraft = {
      type: 'output',
      direction: 'out',
      source: 'server',
      destination,
      label: `${protocol} ${kind === 'dry-run' ? 'dry-run' : 'output'} summary`,
      detail: `frames=${frames}; packets=${packets}; universes=${universeRangeLabel(universes)}; bytes=${bytes}; windowMs=${Math.round(nowMs - windowStart)}`,
    };

    windowStart = nowMs;
    frames = 0;
    packets = 0;
    bytes = 0;
    universes.clear();

    return event;
  }

  return { record, flush };
}
