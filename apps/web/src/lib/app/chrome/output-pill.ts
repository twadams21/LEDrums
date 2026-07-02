/* Pure derivation of the engine-output pill from the WS link state + the server's
   OutputStatus (arming state, packetsSent, lastError, universeCount — broadcast on
   `state` at connect and in every `stats` tick). Split out of OutputPill.svelte so
   the truth table is unit-testable without a component.

   Why link state alone was wrong: Art-Net/sACN send is fire-and-forget, so a socket
   can be open and green while output is actually failing (lastError set, packets 0).
   The old pill showed "LIVE" off link state alone — the worst lie in the app.

   Colour intent (see tokens.css "State colours"): `live` (red) = LIVE / armed —
   "reads across a room"; `warn` (amber) = dry-run / warning; `muted` = inert. The
   palette has no separate error hue (red is deliberately overloaded for LIVE and
   for danger), so the erroring state reuses the `live` tone but is kept distinct by
   a pulsing dot, an "ERR" label, and the actual message in its tooltip.

   Invariant: "LIVE" is impossible unless the link is open, output is armed, packets
   have been sent, and no error is set — enforced by branch order (link, error, and
   the not-flowing case are all handled before LIVE can be returned). */
import type { OutputStatus } from '../../ws/protocol-types';
import type { StatusTone } from '../../ui/StatusDot.svelte';

/** WS engine-link state as tracked by the store ({@link TriggerLab.link}). */
export type LinkState = 'offline' | 'connecting' | 'open';

export interface OutputPillView {
  tone: StatusTone;
  /** Short uppercase pill label (LIVE / ERR / DRY / OFF / ARMED / SYNC / LOCAL). */
  label: string;
  /** Hover tooltip — carries the last error verbatim when erroring. */
  title: string;
  /** Animate the leading dot (connecting, erroring, armed-but-waiting). */
  pulse: boolean;
}

/** Derive the pill's tone/label/title/pulse from the link + latest OutputStatus.
    Pure: same inputs → same view, no clock, no globals. `output` is null before the
    first `state`/`stats` arrives (offline / pre-handshake). */
export function deriveOutputPill(link: LinkState, output: OutputStatus | null): OutputPillView {
  // Link down: the server owns arming, so an open link is a precondition for any
  // LIVE/armed claim. Never trust stale output while disconnected.
  if (link !== 'open') {
    return link === 'connecting'
      ? { tone: 'warn', label: 'SYNC', pulse: true, title: 'Connecting to the server engine…' }
      : { tone: 'muted', label: 'LOCAL', pulse: false, title: 'No engine link — local preview only' };
  }

  // Link open but the first stats/state hasn't populated output yet.
  if (!output) {
    return { tone: 'warn', label: 'SYNC', pulse: true, title: 'Engine linked — awaiting output status…' };
  }

  // Erroring wins over every armed/dry-run/disabled branch: red + pulse + the real
  // message. This is what guarantees LIVE can't show while lastError is set.
  if (output.lastError) {
    return { tone: 'live', label: 'ERR', pulse: true, title: `Output error: ${output.lastError}` };
  }

  switch (output.state) {
    case 'disabled':
      return { tone: 'muted', label: 'OFF', pulse: false, title: 'Output disabled — engine not transmitting' };
    case 'dry-run':
      return { tone: 'warn', label: 'DRY', pulse: false, title: 'Dry-run — computing frames but not transmitting to the wire' };
    case 'armed':
      // Armed + at least one packet sent + no error = genuinely LIVE. Cumulative
      // packetsSent is the snapshot-level "has transmitted" signal available here;
      // true per-second flow (armed but stalled) is S03's packets/s derivation.
      if (output.packetsSent > 0) {
        const uni = output.universeCount === 1 ? '1 universe' : `${output.universeCount} universes`;
        return {
          tone: 'live',
          label: 'LIVE',
          pulse: false,
          title: `Live — transmitting ${output.protocol} to ${output.host} (${uni})`,
        };
      }
      // Armed but nothing on the wire yet — honestly NOT live.
      return { tone: 'warn', label: 'ARMED', pulse: true, title: 'Armed — waiting for output packets' };
  }

  // Unreachable: output.state is the closed union disabled|dry-run|armed. Defensive
  // fallback keeps the function total if that union ever grows.
  return { tone: 'muted', label: 'OFF', pulse: false, title: 'Output status unavailable' };
}
