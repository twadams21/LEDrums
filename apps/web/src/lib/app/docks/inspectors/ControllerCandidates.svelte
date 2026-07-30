<script lang="ts">
  /* What Discover found — the panel's trailing block, and the one place three mutually exclusive
     outcomes of the same question ("what is out there?") are answered: a ranked candidate list, a
     scanning-in-progress hint, or the nothing-adopted-yet explainer.

     Rendered whether or not a controller is adopted (a re-scan from an adopted panel lists its
     neighbours too), which is why `adopted` is a prop rather than an assumption: it only decides
     whether the empty state explains Discover or says nothing at all.

     Split out of ControllerStatusPanel (INIT-09 S7). */
  import Radar from '@lucide/svelte/icons/radar';
  import type { DiscoveredController } from '../../../ws/protocol-types';
  import ActionButton from '../../../ui/ActionButton.svelte';

  let {
    candidates,
    scanning = false,
    adopted = false,
    canEdit = true,
    onAdopt,
  }: {
    /** Ranked discovery candidates (best-first); each offers Adopt-IP. Empty when none / no sweep. */
    candidates: DiscoveredController[];
    /** True while the server is sweeping candidate subnets for PixLite devices. */
    scanning?: boolean;
    /** A controller is already adopted — suppresses the "no controller adopted" explainer. */
    adopted?: boolean;
    canEdit?: boolean;
    onAdopt?: (host: string) => void;
  } = $props();
</script>

{#if candidates.length}
  <ul class="candidates">
    {#each candidates as c (c.host)}
      <li class="candidate">
        <div class="cand-id">
          <span class="cand-name">{c.nickname || c.prodName}</span>
          <span class="cand-meta">{c.prodName} · {c.host} · fw {c.fwVer}</span>
        </div>
        <!-- The button keeps the shared `stretch` metrics; where it sits in the candidate row
             (hard right, no growth) is this list's layout, so the wrapper owns it — same
             division of labour as the panel's `.actions`. -->
        <span class="cand-adopt">
          <ActionButton disabled={!canEdit} onclick={() => onAdopt?.(c.host)}>Adopt-IP</ActionButton>
        </span>
      </li>
    {/each}
  </ul>
{:else if scanning}
  <p class="hint scanning-row"><Radar size={13} aria-hidden="true" /> Scanning output subnet for PixLite controllers...</p>
{:else if !adopted}
  <p class="hint">No controller adopted. Discover sweeps the output subnet for PixLite devices.</p>
{/if}

<style>
  .hint {
    margin: 0;
    font-size: var(--text-xs);
    color: var(--text-muted);
    line-height: var(--leading-normal);
    text-wrap: pretty;
  }
  .scanning-row {
    display: inline-flex;
    align-items: center;
    gap: var(--space-2);
  }
  .scanning-row :global(svg) {
    animation: scan-spin 1s linear infinite;
  }
  /* Svelte scopes keyframe names per component, so this hint's spinner cannot share ActionButton's
     copy without promoting the animation to a `-global-` name. Three duplicated lines are the
     cheaper trade — a deliberate decision, not an oversight. */
  @keyframes scan-spin {
    to {
      transform: rotate(360deg);
    }
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
  /* Placement of the candidate's Adopt-IP, not the button itself: `flex: none` sizes the wrapper to
     the button's own width and `margin-left: auto` pins it to the row's right edge. */
  .cand-adopt {
    display: flex;
    flex: none;
    margin-left: auto;
  }
</style>
