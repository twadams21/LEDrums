<script lang="ts">
  /* Controller status panel (S48) — the confidence chain's LAST link, extending the S03 output
     status panel below its fault row: the adopted PixLite's own truth. It answers the one question
     the transport panel can't — "is the box actually HEARING us?" — from the server's ControllerStatus
     (identity, per-universe rx, frame rates, health) plus the discovery candidate list.

     Pure presentational composite: props in, action callbacks out (the store wiring + watchController
     lifecycle live in PatchControllerInspector), so it demos in the styleguide on stubs. The LOST and
     "not receiving" states are the emotional core — they borrow the S03 fault treatment (live-soft
     fill, live-bright glyph; the app's error-red family) so a controller that isn't receiving is
     impossible to miss, not a subtle grey.

     S49 extension point: the takeover banner (built-in test-data mode active) mounts in `.controller`
     directly under the header — a loud sibling of `.alert` — so the panel already owns the vertical
     rhythm it will slot into. */
  import Cpu from '@lucide/svelte/icons/cpu';
  import Radar from '@lucide/svelte/icons/radar';
  import Lightbulb from '@lucide/svelte/icons/lightbulb';
  import TriangleAlert from '@lucide/svelte/icons/triangle-alert';
  import type { ControllerStatus, DiscoveredController } from '../../../ws/protocol-types';
  import Eyebrow from '../../../ui/Eyebrow.svelte';
  import StatusPill from '../../../ui/StatusPill.svelte';
  import StatusDot from '../../../ui/StatusDot.svelte';
  import ReadRow from './ReadRow.svelte';
  import {
    controllerHeadline,
    universeRxTone,
    universeProtocolLabel,
    formatTempC,
    formatFrameRate,
    formatBankVolts,
    formatEthLinks,
    formatQuietFor,
  } from './output-status';

  let {
    controller,
    candidates,
    outputHost,
    canEdit = true,
    nowMs,
    onDiscover,
    onAdopt,
    onIdentify,
  }: {
    /** Live status of the adopted controller, or null when nothing is adopted (Discover affordance). */
    controller: ControllerStatus | null;
    /** Ranked discovery candidates (best-first); each offers Adopt-IP. Empty when none / no sweep. */
    candidates: DiscoveredController[];
    /** The output transport's current host — drives the "point output here" resync affordance when
        the adopted controller's IP has drifted from where packets are being sent. */
    outputHost?: string;
    /** Editor gate — a viewer sees live status but the re-rig actions (discover/adopt/identify) are
        disabled. Defaults true for the styleguide stub. */
    canEdit?: boolean;
    /** Wall-clock reference for the "last seen" age in the LOST state — passed in (not read here) so
        the composite stays pure and the age is deterministic in tests. */
    nowMs?: number;
    onDiscover?: () => void;
    /** Adopt-IP: adopt this host AND copy it into the output settings (one click). */
    onAdopt?: (host: string) => void;
    onIdentify?: () => void;
  } = $props();

  const headline = $derived(controller ? controllerHeadline(controller) : null);
  const lost = $derived(controller ? !controller.reachable : false);
  const quietFor = $derived(
    controller ? formatQuietFor(controller.lastSeen, nowMs ?? Date.now()) : '',
  );
  /** Adopted controller's IP has drifted from the output target — offer a one-click resync. */
  const outputDrift = $derived(
    !!controller && !!outputHost && controller.host !== outputHost,
  );
</script>

<section class="controller" aria-label="Controller status">
  <header class="head">
    <Eyebrow icon={Cpu}>Controller</Eyebrow>
    {#if headline}
      <StatusPill tone={headline.tone} label={headline.label} pulse={headline.alert} />
    {/if}
  </header>

  {#if controller}
    <!-- S49 takeover banner mounts here (under the header, above the alert). -->

    {#if headline?.alert}
      <div class="alert" role="alert">
        <TriangleAlert size={14} class="alert-glyph" aria-hidden="true" />
        <div class="alert-body">
          <span class="alert-label">{lost ? 'Controller lost' : 'Not receiving'}</span>
          <p class="alert-msg">
            {#if lost}
              No reply from {controller.host} — last seen {quietFor}. Check power and the network link.
            {:else}
              {controller.host} isn't hearing valid pixel data. Check the output target, cabling, and that output is armed.
            {/if}
          </p>
        </div>
      </div>
    {/if}

    <div class="readrows">
      <ReadRow label="Name" value={controller.identity?.nickname || '—'} />
      <ReadRow label="Model" value={controller.identity?.prodName || '—'} />
      <ReadRow label="Firmware" value={controller.identity?.fwVer || '—'} />
      <ReadRow label="IP" value={controller.host} />
    </div>

    <div class="readrows">
      <ReadRow label="In / Out" value={`${formatFrameRate(controller.rates.inFrmRate)} · ${formatFrameRate(controller.rates.outFrmRate)}`} />
      <ReadRow label="Temp" value={formatTempC(controller.health.tempC)} />
      <ReadRow label="Voltage" value={formatBankVolts(controller.health.bankVoltsMv)} />
      <ReadRow label="Eth link" value={formatEthLinks(controller.health.ethLinkUp)} />
    </div>

    {#if controller.universes.length}
      <div class="universes">
        <span class="uni-head">Universes</span>
        {#each controller.universes as u (u.protocol + ':' + u.uniNum)}
          <div class="uni-row" class:bad={!u.receiving}>
            <StatusDot tone={universeRxTone(u.receiving)} pulse={!u.receiving} />
            <span class="uni-num">U{u.uniNum}</span>
            <span class="uni-proto">{universeProtocolLabel(u.protocol)}</span>
            <span class="uni-counts">
              <span class="good">{u.inGood.toLocaleString('en-US')}</span
              ><span class="sep">/</span><span class="bad-count">{u.inBadSeq.toLocaleString('en-US')}</span>
              {#if u.priority != null}<span class="pri">p{u.priority}</span>{/if}
            </span>
          </div>
        {/each}
      </div>
    {/if}

    <div class="actions">
      {#if outputDrift}
        <button type="button" class="action wide" disabled={!canEdit} onclick={() => onAdopt?.(controller.host)}>
          Point output here
        </button>
      {/if}
      <button type="button" class="action" disabled={!canEdit} onclick={() => onIdentify?.()}>
        <Lightbulb size={13} aria-hidden="true" /> Identify
      </button>
      <button type="button" class="action" disabled={!canEdit} onclick={() => onDiscover?.()}>
        <Radar size={13} aria-hidden="true" /> Re-scan
      </button>
    </div>
  {:else}
    <button type="button" class="action wide discover" disabled={!canEdit} onclick={() => onDiscover?.()}>
      <Radar size={13} aria-hidden="true" /> Discover controllers
    </button>
  {/if}

  {#if candidates.length}
    <ul class="candidates">
      {#each candidates as c (c.host)}
        <li class="candidate">
          <div class="cand-id">
            <span class="cand-name">{c.nickname || c.prodName}</span>
            <span class="cand-meta">{c.prodName} · {c.host} · fw {c.fwVer}</span>
          </div>
          <button type="button" class="action" disabled={!canEdit} onclick={() => onAdopt?.(c.host)}>
            Adopt-IP
          </button>
        </li>
      {/each}
    </ul>
  {:else if !controller}
    <p class="hint">No controller adopted. Discover sweeps the output subnet for PixLite devices.</p>
  {/if}
</section>

<style>
  .controller {
    display: flex;
    flex-direction: column;
    gap: var(--space-2);
  }
  .head {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: var(--space-3);
  }
  .readrows {
    display: flex;
    flex-direction: column;
  }

  /* LOUD alert — LOST / not-receiving. Borrows the S03 fault treatment (live-soft fill, live-bright
     glyph) so it reads as the same "something is wrong with output" family. Fades + rises in,
     collapsing to instant under reduced motion via the global --dur-* reset. */
  .alert {
    display: flex;
    align-items: flex-start;
    gap: var(--space-2);
    padding: var(--space-2) var(--space-3);
    border: 1px solid color-mix(in oklch, var(--live) 45%, transparent);
    border-radius: var(--radius-3);
    background: var(--live-soft);
    animation: alert-in var(--dur-220) var(--ease-out-quart);
  }
  .alert :global(.alert-glyph) {
    flex: none;
    color: var(--live-bright);
    /* optical: sit the triangle on the label's cap height */
    margin-top: 1px;
  }
  .alert-body {
    display: flex;
    flex-direction: column;
    gap: 2px;
    min-width: 0;
  }
  .alert-label {
    font-size: var(--text-2xs);
    font-family: var(--font-mono);
    text-transform: uppercase;
    letter-spacing: var(--tracking-label);
    color: var(--live-bright);
  }
  .alert-msg {
    margin: 0;
    font-size: var(--text-xs);
    color: var(--text);
    line-height: var(--leading-snug);
    text-wrap: pretty;
    overflow-wrap: anywhere;
  }
  @keyframes alert-in {
    from {
      opacity: 0;
      transform: translateY(-2px);
    }
  }

  /* Per-universe rx — the row-level "not receiving" signal. A dead universe tints its whole row in
     the live family so a single bad one stands out at a glance. */
  .universes {
    display: flex;
    flex-direction: column;
    gap: 1px;
    margin-top: var(--space-1);
  }
  .uni-head {
    font-size: var(--text-2xs);
    font-family: var(--font-mono);
    text-transform: uppercase;
    letter-spacing: var(--tracking-label);
    color: var(--text-faint);
    margin-bottom: 2px;
  }
  .uni-row {
    display: flex;
    align-items: center;
    gap: var(--space-2);
    padding: var(--space-1) var(--space-2);
    border-radius: var(--radius-1);
    font-size: var(--text-xs);
    color: var(--text);
    transition: background-color var(--dur-150) ease;
  }
  .uni-row.bad {
    background: var(--live-soft);
    color: var(--live-bright);
  }
  .uni-num {
    font-family: var(--font-mono);
    font-variant-numeric: tabular-nums;
    min-width: 2.5em;
  }
  .uni-proto {
    font-size: var(--text-2xs);
    color: var(--text-faint);
    text-transform: uppercase;
    letter-spacing: var(--tracking-label);
  }
  .uni-row.bad .uni-proto {
    color: color-mix(in oklch, var(--live-bright) 70%, transparent);
  }
  .uni-counts {
    margin-left: auto;
    font-family: var(--font-mono);
    font-variant-numeric: tabular-nums;
    font-size: var(--text-2xs);
    display: inline-flex;
    align-items: baseline;
    gap: 3px;
  }
  .uni-counts .good {
    color: var(--ok);
  }
  .uni-row.bad .uni-counts .good {
    color: inherit;
  }
  .uni-counts .sep,
  .uni-counts .bad-count {
    color: var(--text-faint);
  }
  .uni-counts .bad-count {
    color: var(--warn);
  }
  .uni-counts .pri {
    color: var(--text-faint);
    margin-left: 3px;
  }

  /* Actions — reuse the app's soft text-button vocabulary (cf. ShareInfo .action). Scale-on-press
     for tactile feedback; hit area ≥ the row height. */
  .actions {
    display: flex;
    gap: var(--space-2);
    margin-top: var(--space-1);
  }
  .action {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    gap: 6px;
    flex: 1;
    min-height: 30px;
    padding: var(--space-1) var(--space-2);
    background: var(--surface-inset);
    border: 1px solid var(--border);
    border-radius: var(--radius-2);
    font-size: var(--text-xs);
    color: var(--ink);
    cursor: pointer;
    transition:
      border-color var(--dur-120) ease,
      color var(--dur-120) ease,
      scale var(--dur-120) ease;
  }
  .action :global(svg) {
    flex: none;
    opacity: 0.8;
  }
  .action:hover:not(:disabled) {
    border-color: var(--border-strong);
  }
  .action:active:not(:disabled) {
    scale: 0.96;
  }
  .action:disabled {
    opacity: 0.5;
    cursor: default;
  }
  .action.wide {
    width: 100%;
    flex: none;
  }
  .action.discover {
    color: var(--accent);
    border-color: color-mix(in oklch, var(--accent) 40%, var(--border));
  }
  .action.discover:hover:not(:disabled) {
    border-color: color-mix(in oklch, var(--accent) 60%, transparent);
  }

  .hint {
    margin: 0;
    font-size: var(--text-xs);
    color: var(--text-muted);
    line-height: var(--leading-normal);
    text-wrap: pretty;
  }

  /* Discovery candidate list — concentric radius (row --radius-2 inside the list's implicit block),
     name over meta, Adopt-IP trailing. */
  .candidates {
    list-style: none;
    margin: var(--space-1) 0 0;
    padding: 0;
    display: flex;
    flex-direction: column;
    gap: var(--space-1);
  }
  .candidate {
    display: flex;
    align-items: center;
    gap: var(--space-2);
    padding: var(--space-2);
    border: 1px solid var(--border-faint);
    border-radius: var(--radius-2);
    background: var(--surface-inset);
  }
  .cand-id {
    display: flex;
    flex-direction: column;
    gap: 1px;
    min-width: 0;
  }
  .cand-name {
    font-size: var(--text-xs);
    color: var(--text);
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }
  .cand-meta {
    font-size: var(--text-2xs);
    font-family: var(--font-mono);
    color: var(--text-faint);
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }
  .candidate .action {
    flex: none;
    margin-left: auto;
  }
</style>
