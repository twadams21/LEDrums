/** PixLite controller monitor (S48/S49/R29) — the reactive state + panel-facing helpers behind
    the ControllerStatusPanel, extracted from the store god-file (R20, store split 1/5) into a
    constructor-injected controller. Owns the "adopted controller" confidence-chain truth: live
    status, discovery candidates, the test-pattern takeover, and the send helpers that watch /
    discover / adopt / identify / drive the box.

    Reactivity lives here (Svelte 5 runes fields); the store delegates via getters/setter so its
    public surface is unchanged. The store passes a thin {@link ControllerMonitorHost}: how to send
    over the WS link, whether we're a read-only viewer, and how to re-point the output transport
    (Adopt-IP), keeping those cross-cutting concerns in one place. */

import type { ClientMessage, ControllerStatus, ControllerTestPattern, DiscoveredController } from '../ws/protocol-types';

/** The store-side surface the monitor depends on — injected so the controller stays free of the
    WS-client lifecycle, the presence/role derivation, and the output-settings write. */
export interface ControllerMonitorHost {
  /** Send a client message over the engine WS link. */
  send(msg: ClientMessage): void;
  /** Whether this client is a read-only viewer (S2) — device/network re-rig helpers no-op then. */
  isViewer(): boolean;
  /** Point the output transport at `host` (Adopt-IP) — delegated to the store's setOutput so the
      optimistic project write + `setOutput` WS send stay in one place. */
  setOutput(patch: { host: string }): void;
}

export class ControllerMonitor {
  /** Live status of the ADOPTED PixLite controller (S47/S48) — the last link in the confidence
      chain (controller received → controller outputting). null when nothing is adopted, and
      cleared on a link drop (a dropped socket can't confirm the box's rx truth). Populated by the
      server's `controllerStatus` broadcast while a client watches the controller panel. */
  status = $state<ControllerStatus | null>(null);
  /** Ranked discovery candidates (best-first) from the last discovery sweep — replaced wholesale by
      each `controllerDiscovery` reply, cleared on a link drop. Empty = none found / no sweep yet. */
  candidates = $state<DiscoveredController[]>([]);
  /** Whether a discovery sweep is in flight — true from {@link discover} until the reply lands. */
  scanning = $state(false);

  constructor(private readonly host: ControllerMonitorHost) {}

  /** The active controller test pattern (S49), or null in normal LIVE mode. Server-authoritative
      (carried on `status.testPattern`), so every client's takeover banner + output pill agree.
      Non-null = the LOUD takeover state: the box runs synthetic data and IGNORES live Art-Net. */
  get takeover(): ControllerTestPattern | null {
    return this.status?.testPattern ?? null;
  }

  // --- server broadcasts (ingest) -------------------------------------------

  /** Adopt the server's live controller truth (`controllerStatus`). null = nothing adopted. */
  ingestStatus(status: ControllerStatus | null): void {
    this.status = status;
  }

  /** A discovery sweep finished — replace the candidate list wholesale (best-first) and end scan. */
  ingestDiscovery(candidates: DiscoveredController[]): void {
    this.candidates = candidates;
    this.scanning = false;
  }

  /** Link drop: a dropped socket can't confirm the box's rx truth, so frozen status/candidates must
      not linger. The next `controllerStatus` after reconnect (once the panel re-subscribes via
      {@link watch}) repopulates it. Scanning is intentionally left untouched, matching prior art. */
  clearOnLinkDrop(): void {
    this.status = null;
    this.candidates = [];
  }

  // --- panel-facing send helpers --------------------------------------------
  // `watch` is the ONLY one NOT editor-gated: a viewer watching the panel keeps live status flowing
  // for everyone (server-side poll gating). The rest re-rig the device, so they no-op for a viewer.

  /** Client-interest signal that gates the server's controller poll loop — `true` when the panel
      opens (mounts), `false` when it closes. NOT editor-gated; a disconnect implicitly clears it. */
  watch(watching: boolean): void {
    this.host.send({ t: 'watchController', watching });
  }

  /** Kick off a one-shot discovery sweep. Editor-gated. Ranked results arrive asynchronously via
      `controllerDiscovery` → {@link candidates}. */
  discover(): void {
    if (this.host.isViewer()) return; // read-only viewer (S2): network re-rig no-op
    this.scanning = true;
    this.host.send({ t: 'discoverControllers' });
  }

  /** Adopt-IP: make `host` THE controller AND point the output transport at it in one click — the
      confidence chain wants the box we monitor to be the box we send to. Editor-gated. */
  adopt(host: string): void {
    if (this.host.isViewer()) return; // read-only viewer (S2): network re-rig no-op
    this.host.send({ t: 'adoptController', host });
    this.host.setOutput({ host });
  }

  /** Set the adopted controller's admin password (R29). Sends the PLAINTEXT over the local WS; the
      server hashes it and persists ONLY the hash. Empty restores the password-less default.
      Editor-gated; a no-op server-side when nothing is adopted. */
  setAuth(password: string): void {
    if (this.host.isViewer()) return; // read-only viewer (S2): device re-rig no-op
    this.host.send({ t: 'setControllerAuth', password });
  }

  /** Flash the adopted controller's status LED for `durationS` seconds — the "which box is this?"
      confirmation. Editor-gated; a no-op server-side when nothing is adopted. */
  identify(durationS = 5): void {
    if (this.host.isViewer()) return; // read-only viewer (S2): network re-rig no-op
    this.host.send({ t: 'identifyController', durationS });
  }

  /** Drive the controller's built-in test-data mode (S49): the box synthesizes a pattern and
      IGNORES the live Art-Net stream — a LOUD takeover. Editor-gated. The server echoes the active
      pattern back on `status.testPattern` ({@link takeover}), lighting the banner + output pill. */
  setTestData(pattern: ControllerTestPattern): void {
    if (this.host.isViewer()) return; // read-only viewer (S2): device re-rig no-op
    this.host.send({ t: 'controllerTestData', pattern });
  }

  /** Return the adopted controller to LIVE mode — the "back to live data" exit from a test pattern.
      Editor-gated. The server clears the takeover (and auto-reverts when the last watcher leaves). */
  backToLive(): void {
    if (this.host.isViewer()) return; // read-only viewer (S2): device re-rig no-op
    this.host.send({ t: 'controllerBackToLive' });
  }
}
