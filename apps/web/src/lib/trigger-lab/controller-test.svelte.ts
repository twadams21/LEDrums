/** PixLite controller test-pattern (S49) — the "controller test" concern of the trigger-lab store
    split (R22, store split 3/5), extracted into its own constructor-injected controller alongside the
    sibling {@link ControllerMonitor} (R20). Owns the LOUD takeover: drive the adopted box into its
    built-in test-data mode (it synthesizes a pattern and IGNORES the live Art-Net stream) and the
    exit back to live data, plus the reactive `takeover` view of the active pattern.

    R20 first landed these send helpers bundled inside ControllerMonitor because they share the same
    WS-send + viewer gating; R22 gives the spec's separately-named "controller test" controller its
    own module so the five slices read as five controllers. Reactivity for the active pattern lives on
    the server-reported controller status (owned by ControllerMonitor), so this reads it through the
    injected {@link ControllerTestHost} rather than duplicating that state — one source of truth. The
    store delegates its public surface (`controllerTakeover` / `setControllerTestData` / `backToLive`)
    to this via getter + forwarders, so callers/tests are unchanged. */

import type { ClientMessage, ControllerTestPattern } from '../ws/protocol-types';

/** The store-side surface the test controller depends on — injected so it stays free of the WS-client
    lifecycle, the presence/role derivation, and the monitor's status state. */
export interface ControllerTestHost {
  /** Send a client message over the engine WS link. */
  send(msg: ClientMessage): void;
  /** Whether this client is a read-only viewer (S2) — device re-rig helpers no-op then. */
  isViewer(): boolean;
  /** The active test pattern the server reports on the adopted controller's status (`status.testPattern`),
      or null in normal LIVE mode. Server-authoritative and owned by {@link ControllerMonitor}, so every
      client's takeover banner + output pill agree; read through the host to keep one source of truth. */
  currentTestPattern(): ControllerTestPattern | null;
}

export class ControllerTest {
  constructor(private readonly host: ControllerTestHost) {}

  /** The active controller test pattern (S49), or null in normal LIVE mode. Non-null = the LOUD
      takeover state: the box runs synthetic data and IGNORES live Art-Net. Mirrors the server-reported
      `status.testPattern` via the host so the banner + output pill agree across clients. */
  get takeover(): ControllerTestPattern | null {
    return this.host.currentTestPattern();
  }

  /** Drive the controller's built-in test-data mode (S49): the box synthesizes a pattern and IGNORES
      the live Art-Net stream — a LOUD takeover. Editor-gated. The server echoes the active pattern back
      on `status.testPattern` ({@link takeover}), lighting the banner + output pill. */
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
