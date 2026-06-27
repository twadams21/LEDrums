<script lang="ts">
  /* Save-status indicator beside the Shows button: a "Saving…" spinner that settles to a
     "Saved" check, so the performer trusts their work is persisted. Reads store.saveStatus;
     all the timing (min-visible 'saving' window + 'saved' hold) lives in the pure save-status
     controller, not here. Both icons stay mounted and cross-fade (scale + blur + opacity) so
     the swap reads smoothly, and the slot reserves constant width so nothing shifts as the
     state changes. Motion (the spin + the cross-fade transforms) is dropped under
     prefers-reduced-motion; the opacity fades stay. */
  import type { TriggerLab } from '../../trigger-lab/store.svelte';
  import LoaderCircle from '@lucide/svelte/icons/loader-circle';
  import Check from '@lucide/svelte/icons/check';

  let { store }: { store: TriggerLab } = $props();

  const status = $derived(store.saveStatus);
  // Empty on idle so the polite live region announces "Saving…" then "Saved", then clears.
  const label = $derived(status === 'saving' ? 'Saving…' : status === 'saved' ? 'Saved' : '');
</script>

<div
  class="save-indicator"
  class:visible={status !== 'idle'}
  class:saved={status === 'saved'}
  role="status"
  aria-live="polite"
>
  <span class="icon" aria-hidden="true">
    <span class="ico spin" class:on={status === 'saving'}><LoaderCircle size={13} /></span>
    <span class="ico" class:on={status === 'saved'}><Check size={13} /></span>
  </span>
  <span class="label">{label}</span>
</div>

<style>
  .save-indicator {
    display: inline-flex;
    align-items: center;
    gap: var(--space-1);
    flex: none;
    color: var(--text-faint);
    opacity: 0;
    transition: opacity 160ms cubic-bezier(0.2, 0, 0, 1);
  }
  .save-indicator.visible {
    opacity: 1;
  }
  .save-indicator.saved {
    color: var(--ok);
  }

  /* Fixed box so the two stacked icons cross-fade in place without reflow. */
  .icon {
    position: relative;
    width: 13px;
    height: 13px;
    flex: none;
  }
  .ico {
    position: absolute;
    inset: 0;
    display: inline-flex;
    opacity: 0;
    transform: scale(0.25);
    filter: blur(4px);
    transition:
      opacity 200ms cubic-bezier(0.2, 0, 0, 1),
      transform 200ms cubic-bezier(0.2, 0, 0, 1),
      filter 200ms cubic-bezier(0.2, 0, 0, 1);
  }
  .ico.on {
    opacity: 1;
    transform: scale(1);
    filter: blur(0);
  }
  .spin.on :global(svg) {
    animation: save-spin 0.7s linear infinite;
  }

  /* Reserve constant width across "Saving…"/"Saved"/idle so nothing shifts as state changes. */
  .label {
    display: inline-block;
    min-width: 4em;
    font-size: var(--text-2xs);
    letter-spacing: var(--tracking-label);
    white-space: nowrap;
  }

  @keyframes save-spin {
    to {
      transform: rotate(360deg);
    }
  }

  @media (prefers-reduced-motion: reduce) {
    .save-indicator {
      transition: opacity 100ms linear;
    }
    .ico {
      transform: none;
      filter: none;
      transition: opacity 100ms linear;
    }
    .spin.on :global(svg) {
      animation: none;
    }
  }
</style>
