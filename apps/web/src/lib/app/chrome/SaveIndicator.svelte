<script lang="ts">
  /* Save-status indicator beside the Shows button: a "Saving…" spinner that settles to a
     "Saved" check, so the performer trusts their work is persisted. Reads store.saveStatus;
     all the timing (min-visible 'saving' window + 'saved' hold) lives in the pure save-status
     controller, not here. All three icons stay mounted and cross-fade (scale + blur + opacity)
     so the swap reads smoothly, and the slot reserves constant width so nothing shifts as the
     state changes. Motion (the spin + the cross-fade transforms) is dropped under
     prefers-reduced-motion; the opacity fades stay.

     "Saved" is a claim about the LOCAL write only, and 'error' is the state where that claim
     would be false: it does not fade like the others, because unlike "Saved" it is asking for
     something. It borrows the app's established fault idiom — TriangleAlert in `--live`, the
     same pairing OutputStatusPanel / OscInputPanel / BootOverlay use — plus the icon+tooltip
     contract every other chrome control follows, so the cause is nameable without a dialog.
     The live region turns assertive for it: a silent failure is the bug being fixed. */
  import type { TriggerLab } from '../../trigger-lab/store.svelte';
  import LoaderCircle from '@lucide/svelte/icons/loader-circle';
  import Check from '@lucide/svelte/icons/check';
  import TriangleAlert from '@lucide/svelte/icons/triangle-alert';

  let { store }: { store: TriggerLab } = $props();

  const status = $derived(store.saveStatus);
  const failed = $derived(status === 'error');
  // Empty on idle so the polite live region announces "Saving…" then "Saved", then clears.
  const label = $derived(
    status === 'saving' ? 'Saving…' : status === 'saved' ? 'Saved' : failed ? 'Not saved' : '',
  );
  // The tooltip names the cause; without a reason it still says what the state means.
  const tooltip = $derived(failed ? (store.saveError ?? 'This device could not store your latest changes.') : null);
</script>

<div
  class="save-indicator"
  class:visible={status !== 'idle'}
  class:saved={status === 'saved'}
  class:failed
  role="status"
  aria-live={failed ? 'assertive' : 'polite'}
  title={tooltip}
>
  <span class="icon" aria-hidden="true">
    <span class="ico spin" class:on={status === 'saving'}><LoaderCircle size={13} /></span>
    <span class="ico" class:on={status === 'saved'}><Check size={13} /></span>
    <span class="ico" class:on={failed}><TriangleAlert size={13} /></span>
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
    transition: opacity 160ms var(--ease-control);
  }
  .save-indicator.visible {
    opacity: 1;
  }
  .save-indicator.saved {
    color: var(--ok);
  }
  /* The app's fault idiom (OutputStatusPanel / OscInputPanel / BootOverlay): TriangleAlert in
     --live. Weight goes up too — this is the one state that is asking to be read, and colour
     alone must never be the signal (the icon and the words carry it as well). */
  .save-indicator.failed {
    color: var(--live);
    cursor: help; /* the tooltip names the cause */
  }
  .save-indicator.failed .label {
    font-weight: 500;
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
      opacity 200ms var(--ease-control),
      transform 200ms var(--ease-control),
      filter 200ms var(--ease-control);
  }
  .ico.on {
    opacity: 1;
    transform: scale(1);
    filter: blur(0);
  }
  .spin.on :global(svg) {
    animation: save-spin 0.7s linear infinite;
  }

  /* Reserve constant width across "Saving…"/"Saved"/"Not saved"/idle so nothing shifts as the
     state changes — the longest label sets the floor, or the TopBar would reflow on failure. */
  .label {
    display: inline-block;
    min-width: 5.5em;
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
