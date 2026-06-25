<script lang="ts">
  /* Effect picker popup (the "swap effect" button). Bits UI Dialog (portaled,
     layer 2 so it stacks above the clip settings dialog). A richer browser:
     search, scope tabs, bigger animated thumbnails, and a "new effect"
     affordance that hands off to the creator dialog. Throwaway. */
  import EffectThumb from './EffectThumb.svelte';
  import Dialog from '../ui/Dialog.svelte';
  import SearchField from '../ui/SearchField.svelte';
  import Tabs from '../ui/Tabs.svelte';
  import IconButton from '../ui/IconButton.svelte';
  import Eyebrow from '../ui/Eyebrow.svelte';
  import LayoutGrid from '@lucide/svelte/icons/layout-grid';
  import Plus from '@lucide/svelte/icons/plus';
  import X from '@lucide/svelte/icons/x';
  import { defaultParams, type Scope } from './sim';
  import type { TriggerLab } from './store.svelte';

  let { store }: { store: TriggerLab } = $props();

  let tab = $state<Scope>('drum');
  let query = $state('');

  const block = $derived(store.galleryBlock);
  const currentEffectId = $derived(block?.kind === 'play' ? block.effectId : null);

  // Snap the scope tab to the block being edited whenever the gallery opens.
  $effect(() => {
    if (block?.kind === 'play') tab = block.scope;
  });

  const shown = $derived.by(() => {
    const q = query.trim().toLowerCase();
    const list = store.effectsForScope(tab);
    if (!q) return list;
    return list.filter((e) => e.name.toLowerCase().includes(q) || e.pattern.toLowerCase().includes(q));
  });

  const SCOPE_TABS = [
    { value: 'drum', label: 'Drum' },
    { value: 'kit', label: 'Whole kit' },
  ];

  function previewParams(effectId: string) {
    const eff = store.effects.find((e) => e.id === effectId)!;
    return store.presetById(`${effectId}:default`)?.params ?? defaultParams(eff);
  }

  function pick(effectId: string): void {
    if (block) store.pickEffect(block, effectId);
    store.closeGallery();
  }

  function newEffect(): void {
    store.closeGallery();
    store.openCreator();
  }
</script>

<Dialog open={!!block} onClose={() => store.closeGallery()} title="Change effect" layer={2} class="dlg-gallery">
  {#if block}
    <header class="ghead">
      <Eyebrow icon={LayoutGrid}>Change effect</Eyebrow>
      <SearchField bind:value={query} placeholder="Search effects…" ariaLabel="Search effects" class="ghead-search" />
      <span class="spacer"></span>
      <IconButton icon={Plus} label="New effect" variant="soft" onclick={newEffect} />
      <IconButton icon={X} label="Close" onclick={() => store.closeGallery()} />
    </header>

    <div class="gtabs">
      <Tabs value={tab} tabs={SCOPE_TABS} onChange={(v) => (tab = v as Scope)} ariaLabel="Effect scope" />
    </div>

    {#if shown.length === 0}
      <p class="empty">No effects match.</p>
    {:else}
      <div class="grid">
        {#each shown as eff, i (eff.id)}
          <button
            class="cell"
            class:sel={eff.id === currentEffectId}
            style="--i:{i}"
            type="button"
            onclick={() => pick(eff.id)}
          >
            <EffectThumb pattern={eff.pattern} params={previewParams(eff.id)} w={170} h={92} />
            <span class="name">{eff.name}</span>
            <span class="meta">{eff.pattern} · {eff.busId}</span>
          </button>
        {/each}
      </div>
    {/if}
  {/if}
</Dialog>

<style>
  :global(.dlg-gallery) {
    width: min(760px, 94vw);
  }
  .ghead {
    display: flex;
    align-items: center;
    gap: var(--space-3);
    padding: var(--space-3) var(--space-4);
    background: var(--surface-2);
    border-bottom: 1px solid var(--border-faint);
  }
  .ghead :global(.ghead-search) {
    width: 220px;
    max-width: 40vw;
  }
  .spacer {
    flex: 1;
  }
  .gtabs {
    padding: var(--space-2) var(--space-4) 0;
    background: var(--surface-2);
    border-bottom: 1px solid var(--border-faint);
  }
  .empty {
    margin: 0;
    padding: var(--space-4);
    font-size: var(--text-sm);
    color: var(--text-muted);
  }
  .grid {
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(170px, 1fr));
    gap: var(--space-3);
    padding: var(--space-4);
    overflow: auto;
    min-height: 0;
  }
  .cell {
    display: flex;
    flex-direction: column;
    align-items: flex-start;
    gap: var(--space-1);
    padding: var(--space-2);
    background: var(--surface-2);
    border: 1px solid var(--border);
    border-radius: var(--radius-2);
    text-align: left;
    transition: border-color 120ms ease, transform 120ms ease, box-shadow 120ms ease;
  }
  .cell:hover {
    border-color: var(--border-strong);
    transform: translateY(-1px);
  }
  .cell:active {
    transform: translateY(0) scale(0.98);
  }
  .cell.sel {
    border-color: var(--accent);
    box-shadow: inset 0 0 0 1px color-mix(in oklch, var(--accent) 45%, transparent);
  }
  /* subtle edge outline on the preview canvas (concentric inner radius) */
  .cell :global(canvas) {
    width: 100%;
    border-radius: var(--radius-1);
    box-shadow: inset 0 0 0 1px rgba(255, 255, 255, 0.1);
  }
  .name {
    font-size: var(--text-sm);
    font-weight: 600;
    color: var(--ink);
  }
  .meta {
    font-size: var(--text-2xs);
    font-family: var(--font-mono);
    color: var(--text-faint);
  }
  @media (prefers-reduced-motion: no-preference) {
    .cell {
      animation: cell-in 220ms cubic-bezier(0.2, 0, 0, 1) both;
      animation-delay: calc(min(var(--i), 16) * 22ms);
    }
    @keyframes cell-in {
      from {
        opacity: 0;
        transform: translateY(6px);
      }
      to {
        opacity: 1;
        transform: translateY(0);
      }
    }
  }
</style>
