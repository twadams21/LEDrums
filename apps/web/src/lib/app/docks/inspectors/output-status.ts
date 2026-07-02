/* Pure derivations for the output status panel (S03). No Svelte / DOM / store — just
   data → display, so they unit-test in isolation and the panel stays a thin renderer.
   The panel reads OutputStatus (broadcast in every `stats`/`state` message) plus the
   packets/s rate the store derives from successive `packetsSent` counters. */
import type { OutputStatus } from '../../../ws/protocol-types';
import type { StatusTone } from '../../../ui/StatusDot.svelte';

/** A cumulative packet counter sampled at a wall-clock instant. The store keeps the
    last sample and feeds the pair to {@link packetsPerSecond} on each stats tick. */
export interface PacketSample {
  /** OutputStatus.packetsSent — monotonically rising while the transport is armed. */
  packetsSent: number;
  /** Arrival time of the sample (ms; `performance.now()` / `Date.now()`). */
  atMs: number;
}

/**
 * Instantaneous send rate (packets/second) from two cumulative samples. Pure.
 *
 * Returns `null` when a rate cannot be honestly derived:
 *  - no prior sample (the first tick after connect),
 *  - a non-advancing clock (`dt <= 0` — duplicate / reordered ticks),
 *  - a counter that went backwards (server restart / re-arm reset `packetsSent`).
 *
 * A zero delta over a positive interval yields `0` — "armed but nothing is flowing"
 * is a truth the confidence panel must show, not hide.
 */
export function packetsPerSecond(prev: PacketSample | null, cur: PacketSample): number | null {
  if (!prev) return null;
  const dtMs = cur.atMs - prev.atMs;
  if (dtMs <= 0) return null;
  const delta = cur.packetsSent - prev.packetsSent;
  if (delta < 0) return null;
  return (delta / dtMs) * 1000;
}

/** Human packets/s for the panel: `null` → "—", else a thousands-grouped integer + "/s". */
export function formatPacketsPerSecond(rate: number | null): string {
  if (rate === null) return '—';
  return `${Math.round(rate).toLocaleString('en-US')}/s`;
}

export type OutputState = OutputStatus['state']; // 'disabled' | 'dry-run' | 'armed'

/** Status tone for the output state — armed is the loud "live" red, dry-run warns,
    disabled is muted. Mirrors the app's state-colour taxonomy (StatusDot tones). */
export function outputStateTone(state: OutputState): StatusTone {
  switch (state) {
    case 'armed':
      return 'live';
    case 'dry-run':
      return 'warn';
    case 'disabled':
      return 'muted';
  }
}

/** Short label for the state pill (StatusPill renders it uppercase). */
export function outputStateLabel(state: OutputState): string {
  switch (state) {
    case 'armed':
      return 'Armed';
    case 'dry-run':
      return 'Dry-run';
    case 'disabled':
      return 'Disabled';
  }
}

/** Default transport port when the project hasn't overridden it — sACN 5568, Art-Net 6454. */
export function defaultPort(protocol: OutputStatus['protocol']): number {
  return protocol === 'sacn' ? 5568 : 6454;
}
