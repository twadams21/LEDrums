/* Pure derivations for the output status panel (S03). No Svelte / DOM / store — just
   data → display, so they unit-test in isolation and the panel stays a thin renderer.
   The panel reads OutputStatus (broadcast in every `stats`/`state` message) plus the
   packets/s rate the store derives from successive `packetsSent` counters. */
import type { ControllerStatus, ControllerUniverseRx, OutputStatus } from '../../../ws/protocol-types';
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

// ---------------------------------------------------------------------------
// PixLite controller (S48) — the confidence chain's last link. These derive the
// controller's own truth (rx verification, health, identity) into display, so the
// panel stays a thin renderer. The "not receiving" / LOST states are the emotional
// core: they resolve to the loud `live` tone (the app's error-red family), never a
// quiet grey — a controller that isn't hearing us must be impossible to miss.
// ---------------------------------------------------------------------------

/** The aggregate headline for the adopted controller — the one signal that answers "is the box
 * hearing us?". `alert` is the trigger for the LOUD callout (LOST or not-receiving); the other
 * states are calm. Precedence: unreachable (LOST) → no stats yet (waiting) → any universe not
 * receiving (NOT RECEIVING, unmissable) → all receiving (RECEIVING). */
export interface ControllerHeadline {
  tone: StatusTone;
  label: string;
  /** true → the panel renders the loud alert block (the unmissable states). */
  alert: boolean;
}

export function controllerHeadline(status: ControllerStatus): ControllerHeadline {
  // Whole controller lost — a poll timed out/errored. The loudest state.
  if (!status.reachable) return { tone: 'live', label: 'Lost', alert: true };
  // Adopted + reachable but no universe stats have landed yet (brief window post-adopt).
  if (status.universes.length === 0) return { tone: 'warn', label: 'Waiting', alert: false };
  // Reachable, but ≥1 universe isn't hearing valid data — the "not receiving" state the panel
  // must make unmissable, so it earns the loud tone + alert even when other universes are fine.
  if (!status.universes.every((u) => u.receiving)) return { tone: 'live', label: 'Not receiving', alert: true };
  // Every universe is receiving valid data — the confidence chain is whole.
  return { tone: 'ok', label: 'Receiving', alert: false };
}

/** Per-universe rx tone: receiving → calm ok (green); not receiving → the loud `live` red so a
 * single dead universe stands out in the list. */
export function universeRxTone(receiving: boolean): StatusTone {
  return receiving ? 'ok' : 'live';
}

/** Wire protocol tag → display label for a universe row. */
export function universeProtocolLabel(protocol: ControllerUniverseRx['protocol']): string {
  return protocol === 'sACN' ? 'sACN' : 'Art-Net';
}

/** Controller temperature → `"42°C"` (rounded), or "—" when the device didn't report it. */
export function formatTempC(tempC: number | undefined): string {
  return tempC === undefined ? '—' : `${Math.round(tempC)}°C`;
}

/** Detected frame rate (Hz) → `"40 Hz"` (rounded), or "—" when absent. Shared by in/out rates. */
export function formatFrameRate(hz: number | undefined): string {
  return hz === undefined ? '—' : `${Math.round(hz)} Hz`;
}

/** Per-bank input voltage (mV) → `"12.1 / 12.0 V"` (one decimal each), or "—" when none reported. */
export function formatBankVolts(bankVoltsMv: number[] | undefined): string {
  if (!bankVoltsMv || bankVoltsMv.length === 0) return '—';
  return `${bankVoltsMv.map((mv) => (mv / 1000).toFixed(1)).join(' / ')} V`;
}

/** Ethernet link summary → `"2/3 up"`, or "—" when the device didn't report port links. */
export function formatEthLinks(ethLinkUp: boolean[] | undefined): string {
  if (!ethLinkUp || ethLinkUp.length === 0) return '—';
  return `${ethLinkUp.filter(Boolean).length}/${ethLinkUp.length} up`;
}

/** How long the controller has been quiet, for the LOST state — `Date.now() - lastSeen` humanized
 * ("just now" / "12s ago" / "3m ago" / "1h ago"). `null` lastSeen (never reached) → "never". A
 * non-positive delta (clock skew / a fresh contact) reads "just now". */
export function formatQuietFor(lastSeen: number | null, nowMs: number): string {
  if (lastSeen === null) return 'never';
  const ms = nowMs - lastSeen;
  if (ms < 1000) return 'just now';
  const s = Math.floor(ms / 1000);
  if (s < 60) return `${s}s ago`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  return `${h}h ago`;
}
