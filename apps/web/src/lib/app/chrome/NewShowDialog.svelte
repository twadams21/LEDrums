<script lang="ts">
  /* New show — what it starts with (Tim, 2026-09-27: "a blank project, or a template from known
     trigger inputs"). Opened from the Show browser's New, never on startup: a gig launch reopens
     the last show without waiting on a question.

     From my trigger zones (first, the one Tim asked for): one empty graph per zone declared in
     Settings › Drum trigger zones, and every later new section and song gets its own set — so the
     zones are always there to fill, never rebuilt. Blank: one song, one empty section. Both
     leave out the demo pads a bare new show used to carry. */
  import type { TriggerLab } from '../../trigger-lab/store.svelte';
  import type { ShowTemplate } from '../../trigger-lab/store/templates';
  import Dialog from '../../ui/Dialog.svelte';
  import IconButton from '../../ui/IconButton.svelte';
  import Eyebrow from '../../ui/Eyebrow.svelte';
  import FilePlus from '@lucide/svelte/icons/file-plus';
  import LayoutGrid from '@lucide/svelte/icons/layout-grid';
  import FileIcon from '@lucide/svelte/icons/file';
  import X from '@lucide/svelte/icons/x';

  let {
    store,
    open,
    onClose,
    onCreated,
  }: {
    store: TriggerLab;
    open: boolean;
    onClose: () => void;
    /** After the show is created and active — the caller closes whatever opened this. */
    onCreated: () => void;
  } = $props();

  /** How many zone names the card lists before "+N more". */
  const SHOWN = 6;
  const zones = $derived(store.drumZones);

  function choose(template: ShowTemplate): void {
    store.newShow(undefined, template);
    onCreated();
  }
</script>

<Dialog {open} {onClose} title="New show" layer={2} class="dlg-newshow">
  <header class="nhead">
    <Eyebrow icon={FilePlus}>New show</Eyebrow>
    <span class="spacer"></span>
    <IconButton icon={X} label="Close" onclick={onClose} />
  </header>

  <div class="choices">
    <button type="button" class="choice" disabled={zones.length === 0} onclick={() => choose('zones')}>
      <span class="ctitle"><LayoutGrid size={16} aria-hidden="true" />From my trigger zones</span>
      {#if zones.length > 0}
        <span class="cdesc">
          A graph for each of your {zones.length} zones, ready to fill — and every new section and song gets its own set.
        </span>
        <span class="chips" aria-hidden="true">
          {#each zones.slice(0, SHOWN) as zone (`${zone.drumId}:${zone.slot}`)}<span class="chip">{zone.title}</span>{/each}
          {#if zones.length > SHOWN}<span class="chip more">+{zones.length - SHOWN} more</span>{/if}
        </span>
      {:else}
        <span class="cdesc">No trigger zones yet — set them up in Settings › Drum trigger zones.</span>
      {/if}
    </button>

    <button type="button" class="choice" onclick={() => choose('blank')}>
      <span class="ctitle"><FileIcon size={16} aria-hidden="true" />Blank</span>
      <span class="cdesc">One song with one empty section. You add graphs yourself.</span>
    </button>
  </div>
</Dialog>

<style>
  :global(.dlg-newshow) {
    width: min(460px, 92vw);
  }
  .nhead {
    display: flex;
    align-items: center;
    gap: var(--space-3);
    padding: var(--space-3) var(--space-4);
    background: var(--surface-2);
    border-bottom: 1px solid var(--border-faint);
  }
  .spacer {
    flex: 1;
  }
  .choices {
    display: flex;
    flex-direction: column;
    gap: var(--space-2);
    padding: var(--space-4);
  }
  /* Each choice is one big button: the whole card is the hit target. */
  .choice {
    display: flex;
    flex-direction: column;
    align-items: flex-start;
    gap: var(--space-2);
    padding: var(--space-3) var(--space-4);
    text-align: left;
    background: var(--surface-2);
    border: 1px solid var(--border-faint);
    border-radius: var(--radius-2);
    transition-property: border-color, background-color, scale;
    transition-duration: var(--dur-120);
    transition-timing-function: ease;
  }
  .choice:hover:not(:disabled) {
    border-color: var(--accent-dim);
    background: var(--surface-raised);
  }
  .choice:active:not(:disabled) {
    scale: 0.99;
  }
  .choice:focus-visible {
    outline: none;
    box-shadow: 0 0 0 2px var(--accent-soft);
  }
  .choice:disabled {
    cursor: not-allowed;
    opacity: 0.6;
  }
  .ctitle {
    display: inline-flex;
    align-items: center;
    gap: var(--space-2);
    font-size: var(--text-sm);
    font-weight: 600;
    color: var(--ink);
  }
  .ctitle :global(svg) {
    color: var(--accent);
  }
  .cdesc {
    font-size: var(--text-xs);
    line-height: var(--leading-normal);
    color: var(--text-muted);
    text-wrap: pretty;
  }
  .chips {
    display: flex;
    flex-wrap: wrap;
    gap: var(--space-1);
  }
  .chip {
    padding: 1px var(--space-2);
    font-size: var(--text-2xs);
    font-family: var(--font-mono);
    color: var(--text-muted);
    border: 1px solid var(--border-faint);
    border-radius: var(--radius-2);
    white-space: nowrap;
  }
  .chip.more {
    color: var(--text-faint);
    border-style: dashed;
  }
</style>
