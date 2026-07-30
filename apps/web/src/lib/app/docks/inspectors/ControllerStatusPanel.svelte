<script lang="ts">
  /* Controller status panel (S48) — the confidence chain's LAST link, extending the S03 output
     status panel below its fault row: the adopted PixLite's own truth. It answers the one question
     the transport panel can't — "is the box actually HEARING us?" — from the server's ControllerStatus
     (identity, per-universe rx, frame rates, health) plus the discovery candidate list.

     Pure presentational composite: props in, action callbacks out (the store wiring + watchController
     lifecycle live in PatchControllerInspector), so it demos in the styleguide on stubs.

     INIT-09 S7 split this along the axes its git history moves on — each child owns its own markup
     AND its own scoped CSS, because Svelte styles do not cross a component boundary:
       · ControllerBanners      takeover banner + LOST / not-receiving alert
       · ControllerDiscovery    subnet recommendation + copy-IP + adopt-by-IP (rendered at two sites)
       · ControllerReadout      identity / rates / health rows + per-universe rx
       · ControllerAuthField    admin password (R29)
       · ControllerTestPatterns swatches + ops + back-to-live
       · ControllerCandidates   discovery results / scanning hint / empty explainer
     What is left here is the panel frame, the branch logic, the derivations that feed the children,
     and the `.actions` row. */
  import Cpu from '@lucide/svelte/icons/cpu';
  import Radar from '@lucide/svelte/icons/radar';
  import Lightbulb from '@lucide/svelte/icons/lightbulb';
  import type {
    ControllerStatus,
    ControllerTestPattern,
    DiscoveredController,
    NetworkAdapter,
  } from '../../../ws/protocol-types';
  import Eyebrow from '../../../ui/Eyebrow.svelte';
  import StatusPill from '../../../ui/StatusPill.svelte';
  import ActionButton from '../../../ui/ActionButton.svelte';
  import ControllerBanners from './ControllerBanners.svelte';
  import ControllerDiscovery from './ControllerDiscovery.svelte';
  import ControllerReadout from './ControllerReadout.svelte';
  import ControllerAuthField from './ControllerAuthField.svelte';
  import ControllerTestPatterns from './ControllerTestPatterns.svelte';
  import ControllerCandidates from './ControllerCandidates.svelte';
  import { controllerHeadline, formatQuietFor } from './output-status';

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
        takeover banner + highlights the running control. Server-authoritative (mirrors
        `store.controllerTest.takeover`), so every watcher agrees. Defaults null for the styleguide stub. */
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
</script>

<section class="controller" aria-label="Controller status">
  <header class="head">
    <Eyebrow icon={Cpu}>Controller</Eyebrow>
    {#if headline}
      <StatusPill tone={headline.tone} label={headline.label} pulse={headline.alert} />
    {/if}
  </header>

  {#if controller}
    <ControllerBanners
      {takeover}
      alert={headline?.alert === true}
      {lost}
      host={controller.host}
      {quietFor}
      {canEdit}
      {onBackToLive}
    />

    {#if lost}
      <!-- The box stopped answering — the likeliest cause is a subnet/IP mismatch, so surface the
           same subnet guidance + manual adopt here, right under the lost alert. -->
      <ControllerDiscovery {recommendation} {canEdit} {onAdopt} />
    {/if}

    <ControllerReadout {controller} />

    <ControllerAuthField
      authReqd={controller.identity?.authReqd === true}
      reachable={controller.reachable}
      {canEdit}
      {onSetAuth}
    />

    <div class="actions">
      {#if outputDrift}
        <ActionButton wide disabled={!canEdit} onclick={() => onAdopt?.(controller.host)}>Point output here</ActionButton>
      {/if}
      <ActionButton disabled={!canEdit} onclick={() => onIdentify?.()}>
        <Lightbulb size={13} aria-hidden="true" /> Identify
      </ActionButton>
      <ActionButton disabled={!canEdit} onclick={() => onDiscover?.()}>
        <Radar size={13} aria-hidden="true" /> Re-scan
      </ActionButton>
    </div>

    <ControllerTestPatterns {takeover} {canEdit} {onTestData} {onBackToLive} />
  {:else}
    <ActionButton wide tone="discover" {scanning} disabled={!canEdit || scanning} onclick={() => onDiscover?.()}>
      <Radar size={13} aria-hidden="true" /> {scanning ? 'Discovering...' : 'Discover controllers'}
    </ActionButton>
    <ControllerDiscovery {recommendation} {canEdit} {onAdopt} />
  {/if}

  <ControllerCandidates {candidates} {scanning} adopted={!!controller} {canEdit} {onAdopt} />
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
  /* Actions — the ROW. The buttons themselves are lib/ui/ActionButton; this is only their layout. */
  .actions {
    display: flex;
    gap: var(--space-2);
    margin-top: var(--space-1);
  }
</style>
