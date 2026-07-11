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
  import FlaskConical from '@lucide/svelte/icons/flask-conical';
  import RotateCcw from '@lucide/svelte/icons/rotate-ccw';
  import Network from '@lucide/svelte/icons/network';
  import Copy from '@lucide/svelte/icons/copy';
  import Check from '@lucide/svelte/icons/check';
  import type {
    ControllerStatus,
    ControllerTestPattern,
    DiscoveredController,
    NetworkAdapter,
  } from '../../../ws/protocol-types';
  import Eyebrow from '../../../ui/Eyebrow.svelte';
  import StatusPill from '../../../ui/StatusPill.svelte';
  import CommitInput from '../../../ui/CommitInput.svelte';
  import ReadRow from './ReadRow.svelte';
  import AdoptByIpRow from './AdoptByIpRow.svelte';
  import UniverseRxTable from './UniverseRxTable.svelte';
  import {
    controllerHeadline,
    formatTempC,
    formatFrameRate,
    formatBankVolts,
    formatEthLinks,
    formatQuietFor,
    testPatternLabel,
    testPatternTarget,
  } from './output-status';

  let {
    controller,
    candidates,
    scanning = false,
    outputHost,
    takeover = null,
    recommendation = null,
    canEdit = true,
    nowMs,
    onDiscover,
    onAdopt,
    onSetAuth,
    onIdentify,
    onTestData,
    onBackToLive,
  }: {
    /** Live status of the adopted controller, or null when nothing is adopted (Discover affordance). */
    controller: ControllerStatus | null;
    /** Ranked discovery candidates (best-first); each offers Adopt-IP. Empty when none / no sweep. */
    candidates: DiscoveredController[];
    /** True while the server is sweeping candidate subnets for PixLite devices. */
    scanning?: boolean;
    /** The output transport's current host — drives the "point output here" resync affordance when
        the adopted controller's IP has drifted from where packets are being sent. */
    outputHost?: string;
    /** Active built-in test pattern (S49), or null in normal LIVE mode. Non-null lights the LOUD
        takeover banner + highlights the running control. Server-authoritative (mirrors the store's
        `controllerTakeover`), so every watcher agrees. Defaults null for the styleguide stub. */
    takeover?: ControllerTestPattern | null;
    /** The featured network adapter (the NIC the output is bound to, else the first) — drives the
        "set the A4 to …" recommendation shown when nothing is adopted or the controller is lost.
        null hides the card (no adapters known / offline). */
    recommendation?: NetworkAdapter | null;
    /** Editor gate — a viewer sees live status but the re-rig actions (discover/adopt/identify/test)
        are disabled. Defaults true for the styleguide stub. */
    canEdit?: boolean;
    /** Wall-clock reference for the "last seen" age in the LOST state — passed in (not read here) so
        the composite stays pure and the age is deterministic in tests. */
    nowMs?: number;
    onDiscover?: () => void;
    /** Adopt-IP: adopt this host AND copy it into the output settings (one click). */
    onAdopt?: (host: string) => void;
    /** Set the adopted controller's admin password (R29) — plaintext, hashed + persisted server-side. */
    onSetAuth?: (password: string) => void;
    onIdentify?: () => void;
    /** Start / switch the controller's built-in test-data mode (S49). */
    onTestData?: (pattern: ControllerTestPattern) => void;
    /** Return the controller to live mode — the "back to live data" exit. */
    onBackToLive?: () => void;
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

  // --- Subnet recommendation copy -------------------------------------------
  // A copy button for the recommended controller IP. The common flow: read the recommended IP, set
  // the box to it, then adopt it via the AdoptByIpRow below (its placeholder pre-fills that value).
  let copied = $state(false);

  async function copyRecommendedIp(): Promise<void> {
    const ip = recommendation?.recommendedIp;
    if (!ip || typeof navigator === 'undefined' || !navigator.clipboard) return;
    try {
      await navigator.clipboard.writeText(ip);
      copied = true;
      setTimeout(() => (copied = false), 1400);
    } catch {
      /* clipboard blocked — the value is right there to copy by hand */
    }
  }

  // --- Admin password (R29) -------------------------------------------------
  // Authenticated controllers (non-empty admin password) need it for every management call. We hold
  // only the server-side hash, so the field never shows a stored value — it clears after each set.
  // The device's own `authReqd` + whether we're reaching it tell the honest story (no local flag).
  const authReqd = $derived(controller?.identity?.authReqd === true);
  const authHint = $derived(
    authReqd
      ? controller?.reachable
        ? 'Authenticated — the controller accepted this password.'
        : 'This controller requires an admin password to read its status.'
      : 'Only needed if the controller has an admin password set.',
  );

  // --- Test patterns (S49) --------------------------------------------------
  // Solid-colour presets double as the "set colour" affordance — one click sends a setColor pattern
  // (all ports, all pixels). White carries the W channel so an RGBW rig's white LEDs light too.
  const SWATCHES: { label: string; rgb: string; color: [number, number, number, number] }[] = [
    { label: 'White', rgb: 'rgb(255 255 255)', color: [255, 255, 255, 255] },
    { label: 'Red', rgb: 'rgb(255 45 65)', color: [255, 0, 0, 0] },
    { label: 'Green', rgb: 'rgb(40 210 120)', color: [0, 255, 0, 0] },
    { label: 'Blue', rgb: 'rgb(60 130 255)', color: [0, 0, 255, 0] },
    { label: 'Amber', rgb: 'rgb(255 170 0)', color: [255, 140, 0, 0] },
    { label: 'Magenta', rgb: 'rgb(230 60 190)', color: [255, 0, 150, 0] },
  ];
  const takeoverActive = $derived(takeover !== null);
  /** The active solid swatch's index, or -1 when the takeover isn't a matching solid colour. */
  const activeSwatch = $derived(
    takeover?.op === 'setColor'
      ? SWATCHES.findIndex((s) => takeover.color?.every((v, i) => v === s.color[i]))
      : -1,
  );

  function sendColor(color: [number, number, number, number]): void {
    onTestData?.({ op: 'setColor', color, colorRes: '8Bit', pixPortNum: 0, pixNum: 0 });
  }
  function sendOp(op: 'rgbwCycle' | 'colorFade'): void {
    onTestData?.({ op, pixPortNum: 0, pixNum: 0 });
  }
</script>

<!-- The "different IP addresses" guide: your PC's adapter subnet + a concrete IP to set the box to.
     Rendered when nothing is adopted OR the adopted controller is lost — the moments you're trying to
     get on the same subnet. Hidden when no adapter is known (offline / adapters not yet enumerated). -->
{#snippet recommendationCard()}
  {#if recommendation}
    <div class="recommend">
      <div class="rec-head">
        <Network size={13} aria-hidden="true" />
        <span class="rec-title">Put the controller on your subnet</span>
      </div>
      <p class="rec-pc">
        This PC · <span class="mono">{recommendation.name}</span> ·
        <span class="mono">{recommendation.cidr}</span>
      </p>
      <div class="rec-target">
        <span class="rec-set">Set the A4 to</span>
        <span class="rec-value mono">{recommendation.recommendedIp}</span>
        <button
          type="button"
          class="copy"
          onclick={copyRecommendedIp}
          aria-label="Copy recommended IP"
          title="Copy recommended IP"
        >
          {#if copied}<Check size={12} aria-hidden="true" />{:else}<Copy size={12} aria-hidden="true" />{/if}
        </button>
      </div>
      <p class="rec-hint">
        Mask <span class="mono">{recommendation.netmask}</span> · any address on
        <span class="mono">{recommendation.subnet}</span> works, then Discover.
      </p>
    </div>
  {/if}
{/snippet}

<!-- Manual adopt: connect to a controller at a known IP even when Discover can't see it (still on a
     different subnet, across a router, or simply missed). Seeds its placeholder from the recommended
     IP so the "set the box, then adopt it" flow is one glance. -->
{#snippet adoptByIp()}
  <AdoptByIpRow recommendedIp={recommendation?.recommendedIp} {canEdit} {onAdopt} />
{/snippet}

<section class="controller" aria-label="Controller status">
  <header class="head">
    <Eyebrow icon={Cpu}>Controller</Eyebrow>
    {#if headline}
      <StatusPill tone={headline.tone} label={headline.label} pulse={headline.alert} />
    {/if}
  </header>

  {#if controller}
    {#if takeover}
      <!-- S49 takeover: the box is running synthetic data and IGNORING your live show. LOUD, but the
           amber warn family (not the red LOST/error family) — this is a deliberate state you chose,
           not a fault. Visible the ENTIRE time a pattern runs; the button is the one-click exit. -->
      <div class="takeover" role="status">
        <FlaskConical size={14} class="takeover-glyph" aria-hidden="true" />
        <div class="takeover-body">
          <span class="takeover-label">Test pattern active</span>
          <p class="takeover-msg">
            {testPatternLabel(takeover)} on {testPatternTarget(takeover)} — the controller is showing
            test data, <strong>not your live show</strong>.
          </p>
        </div>
        <button
          type="button"
          class="back-to-live"
          disabled={!canEdit}
          onclick={() => onBackToLive?.()}
        >
          <RotateCcw size={13} aria-hidden="true" /> Back to live data
        </button>
      </div>
    {/if}

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

    {#if lost}
      <!-- The box stopped answering — the likeliest cause is a subnet/IP mismatch, so surface the
           same subnet guidance + manual adopt here, right under the lost alert. -->
      {@render recommendationCard()}
      {@render adoptByIp()}
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

    <UniverseRxTable universes={controller.universes} />

    <!-- Admin password (R29): authenticated controllers need it for every management call. The field
         holds no stored value (we keep only the server-side hash), so it reads empty and clears after
         a set; the hint reflects the device's own authReqd + whether we're reaching it. -->
    <div class="auth" class:needs={authReqd && !controller.reachable}>
      <span class="auth-label">Admin password</span>
      <CommitInput
        type="password"
        value=""
        placeholder="•••••••• · leave blank if none"
        disabled={!canEdit}
        ariaLabel="Controller admin password"
        onCommit={(pw) => onSetAuth?.(pw)}
      />
      <p class="auth-hint">{authHint}</p>
    </div>

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

    <!-- Test patterns (S49): drive the controller's built-in test-data mode without an input source.
         Solid-colour swatches double as "set colour"; the two ops cover cycle + fade. Starting any
         one takes the box over (banner above) — the active control stays lit so it's obvious which
         pattern runs. -->
    <div class="testpatterns">
      <Eyebrow icon={FlaskConical}>Test patterns</Eyebrow>
      <div class="swatches" role="group" aria-label="Solid colour test">
        {#each SWATCHES as s, i (s.label)}
          <button
            type="button"
            class="swatch"
            class:on={activeSwatch === i}
            style="--swatch: {s.rgb}"
            disabled={!canEdit}
            title={`Solid ${s.label}`}
            aria-label={`Solid ${s.label} test`}
            aria-pressed={activeSwatch === i}
            onclick={() => sendColor(s.color)}
          ></button>
        {/each}
      </div>
      <div class="ops">
        <button
          type="button"
          class="action"
          class:on={takeover?.op === 'rgbwCycle'}
          disabled={!canEdit}
          aria-pressed={takeover?.op === 'rgbwCycle'}
          onclick={() => sendOp('rgbwCycle')}
        >
          RGBW cycle
        </button>
        <button
          type="button"
          class="action"
          class:on={takeover?.op === 'colorFade'}
          disabled={!canEdit}
          aria-pressed={takeover?.op === 'colorFade'}
          onclick={() => sendOp('colorFade')}
        >
          Colour fade
        </button>
        <button
          type="button"
          class="action"
          disabled={!canEdit || !takeoverActive}
          onclick={() => onBackToLive?.()}
        >
          <RotateCcw size={13} aria-hidden="true" /> Live
        </button>
      </div>
    </div>
  {:else}
    <button type="button" class="action wide discover" class:scanning disabled={!canEdit || scanning} onclick={() => onDiscover?.()}>
      <Radar size={13} aria-hidden="true" /> {scanning ? 'Discovering...' : 'Discover controllers'}
    </button>
    {@render recommendationCard()}
    {@render adoptByIp()}
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
  {:else if scanning}
    <p class="hint scanning-row"><Radar size={13} aria-hidden="true" /> Scanning output subnet for PixLite controllers...</p>
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

  /* LOUD takeover banner (S49) — the amber warn family (deliberate state you chose), distinct from
     the red LOST/error alert above. A soft-pulsing left edge keeps it alive in peripheral vision the
     whole time a pattern runs, without the anxious full-element flash of an error. Collapses to a
     static bar under reduced motion (the --dur reset zeroes the animation duration). */
  .takeover {
    display: flex;
    align-items: flex-start;
    gap: var(--space-2);
    padding: var(--space-2) var(--space-3);
    border: 1px solid color-mix(in oklch, var(--warn) 45%, transparent);
    border-left: 3px solid var(--warn);
    border-radius: var(--radius-3);
    background: color-mix(in oklch, var(--warn) 15%, transparent);
    animation:
      alert-in var(--dur-220) var(--ease-out-quart),
      takeover-breathe 2.4s ease-in-out infinite;
  }
  .takeover :global(.takeover-glyph) {
    flex: none;
    color: var(--warn);
    margin-top: 1px;
  }
  .takeover-body {
    display: flex;
    flex-direction: column;
    gap: 2px;
    min-width: 0;
  }
  .takeover-label {
    font-size: var(--text-2xs);
    font-family: var(--font-mono);
    text-transform: uppercase;
    letter-spacing: var(--tracking-label);
    color: var(--warn);
  }
  .takeover-msg {
    margin: 0;
    font-size: var(--text-xs);
    color: var(--text);
    line-height: var(--leading-snug);
    text-wrap: pretty;
    overflow-wrap: anywhere;
  }
  .takeover-msg strong {
    color: var(--warn);
    font-weight: 600;
  }
  /* Trailing exit — always reachable while the takeover shows (mirrors the .ops "Live" button so the
     one-click revert is present whether the operator's eye is on the banner or the controls). */
  .back-to-live {
    flex: none;
    align-self: center;
    display: inline-flex;
    align-items: center;
    gap: 5px;
    min-height: 28px;
    padding: var(--space-1) var(--space-2);
    background: color-mix(in oklch, var(--warn) 18%, var(--surface-inset));
    border: 1px solid color-mix(in oklch, var(--warn) 55%, transparent);
    border-radius: var(--radius-2);
    font-size: var(--text-xs);
    color: var(--text);
    white-space: nowrap;
    cursor: pointer;
    transition:
      border-color var(--dur-120) ease,
      background-color var(--dur-120) ease,
      scale var(--dur-120) ease;
  }
  .back-to-live :global(svg) {
    flex: none;
    opacity: 0.9;
  }
  .back-to-live:hover:not(:disabled) {
    border-color: var(--warn);
    background: color-mix(in oklch, var(--warn) 26%, var(--surface-inset));
  }
  .back-to-live:active:not(:disabled) {
    scale: 0.96;
  }
  .back-to-live:disabled {
    opacity: 0.5;
    cursor: default;
  }
  @keyframes takeover-breathe {
    50% {
      border-left-color: color-mix(in oklch, var(--warn) 55%, transparent);
    }
  }

  /* Admin password (R29) — a quiet config field under the readouts. Reuses the CommitInput primitive;
     the label + hint sit above/below it so the credential reads as deliberate device config, not a
     status readout. `.needs` warms the label when the device demands a password we don't yet have. */
  .auth {
    display: flex;
    flex-direction: column;
    gap: var(--space-1);
    margin-top: var(--space-1);
  }
  .auth-label {
    font-size: var(--text-2xs);
    font-family: var(--font-mono);
    text-transform: uppercase;
    letter-spacing: var(--tracking-label);
    color: var(--text-faint);
  }
  .auth.needs .auth-label {
    color: var(--warn);
  }
  .auth-hint {
    margin: 0;
    font-size: var(--text-2xs);
    color: var(--text-muted);
    line-height: var(--leading-snug);
    text-wrap: pretty;
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
  .action.scanning :global(svg),
  .scanning-row :global(svg) {
    animation: scan-spin 1s linear infinite;
  }
  .scanning-row {
    display: inline-flex;
    align-items: center;
    gap: var(--space-2);
  }
  @keyframes scan-spin {
    to {
      transform: rotate(360deg);
    }
  }
  /* An action currently driving the takeover (cycle / fade) reads as "on" in the warn family, so the
     running pattern is obvious among its siblings. */
  .action.on {
    color: var(--warn);
    border-color: color-mix(in oklch, var(--warn) 55%, transparent);
    background: color-mix(in oklch, var(--warn) 14%, var(--surface-inset));
  }

  /* Test patterns (S49) — the drive controls. Kept visually quieter than the live-status readouts
     above (it's a diagnostic tool), but each control lights warn when it's the one taking the box
     over, tying back to the banner. */
  .testpatterns {
    display: flex;
    flex-direction: column;
    gap: var(--space-2);
    margin-top: var(--space-1);
    padding-top: var(--space-2);
    border-top: 1px solid var(--border-faint);
  }
  .swatches {
    display: flex;
    gap: var(--space-2);
  }
  .swatch {
    flex: 1;
    height: 26px;
    padding: 0;
    border: 1px solid var(--border);
    border-radius: var(--radius-2);
    background: var(--swatch);
    cursor: pointer;
    /* concentric: inner colour chip inside the row's radius, thin ring for contrast on any hue */
    box-shadow: inset 0 0 0 1px oklch(0 0 0 / 0.25);
    transition:
      transform var(--dur-120) var(--ease-control),
      box-shadow var(--dur-120) ease,
      outline-color var(--dur-120) ease;
    outline: 2px solid transparent;
    outline-offset: 2px;
  }
  .swatch:hover:not(:disabled) {
    transform: translateY(-1px);
  }
  .swatch:active:not(:disabled) {
    transform: translateY(0) scale(0.94);
  }
  .swatch.on {
    outline-color: var(--warn);
    box-shadow:
      inset 0 0 0 1px oklch(0 0 0 / 0.25),
      0 0 10px color-mix(in oklch, var(--warn) 45%, transparent);
  }
  .swatch:disabled {
    opacity: 0.5;
    cursor: default;
  }
  .ops {
    display: flex;
    gap: var(--space-2);
  }

  @media (prefers-reduced-motion: reduce) {
    .takeover {
      animation: none;
    }
  }

  /* Subnet recommendation — the "different IP addresses" guide. A calm accent-tinted card (info, not
     a fault): your PC's adapter subnet + a concrete IP to set the controller to, with one-tap copy. */
  .recommend {
    display: flex;
    flex-direction: column;
    gap: var(--space-1);
    padding: var(--space-2) var(--space-3);
    border: 1px solid color-mix(in oklch, var(--accent) 30%, var(--border));
    border-radius: var(--radius-3);
    background: color-mix(in oklch, var(--accent) 8%, var(--surface-inset));
    /* Same gentle fade+rise as the sibling .alert/.takeover callouts, so the guidance reads as one
       family. Collapses to instant under reduced motion via the --dur-* token reset. */
    animation: alert-in var(--dur-220) var(--ease-out-quart);
  }
  .rec-head {
    display: flex;
    align-items: center;
    gap: var(--space-2);
    color: var(--accent);
  }
  .rec-head :global(svg) {
    flex: none;
  }
  .rec-title {
    font-size: var(--text-2xs);
    font-family: var(--font-mono);
    text-transform: uppercase;
    letter-spacing: var(--tracking-label);
    color: var(--accent);
  }
  .rec-pc {
    margin: 0;
    font-size: var(--text-xs);
    color: var(--text-muted);
    line-height: var(--leading-snug);
    overflow-wrap: anywhere;
  }
  .recommend .mono {
    font-family: var(--font-mono);
    font-variant-numeric: tabular-nums;
    color: var(--text);
  }
  .rec-target {
    display: flex;
    align-items: center;
    gap: var(--space-2);
    flex-wrap: wrap;
    margin-top: 2px;
  }
  .rec-set {
    font-size: var(--text-xs);
    color: var(--text-muted);
  }
  .rec-value {
    font-size: var(--text-md);
    font-weight: 600;
    color: var(--text);
    letter-spacing: 0.01em;
  }
  .copy {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    width: 24px;
    height: 24px;
    padding: 0;
    border: 1px solid var(--border);
    border-radius: var(--radius-2);
    background: var(--surface-inset);
    color: var(--text-muted);
    cursor: pointer;
    transition:
      border-color var(--dur-120) ease,
      color var(--dur-120) ease,
      scale var(--dur-120) ease;
  }
  .copy:hover {
    border-color: var(--border-strong);
    color: var(--text);
  }
  .copy:active {
    scale: 0.96;
  }
  .rec-hint {
    margin: 0;
    font-size: var(--text-2xs);
    color: var(--text-muted);
    line-height: var(--leading-snug);
    overflow-wrap: anywhere;
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
