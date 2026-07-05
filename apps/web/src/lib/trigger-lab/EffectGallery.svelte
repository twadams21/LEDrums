<script lang="ts">
  /* Effect picker (the "swap effect" browser). Bits UI Dialog (portaled, layer 2 so it
     stacks above the clip-settings dialog). Redesign (Effects Library v2 · D6):
       - collection tabs (derived from effect tags) as the primary rail
       - tag chips (AND semantics), a "has parameter" filter, and search over
         name + description + tags
       - scope (drum / kit) demoted from tabs to a filter chip
       - richer cards: fake-drum thumbnail · name · description · tag pills · param-count
     Deprecated effects are never listed (the alias map keeps old shows working). */
  import EffectThumb from './EffectThumb.svelte';
  import Dialog from '../ui/Dialog.svelte';
  import SearchField from '../ui/SearchField.svelte';
  import Tabs from '../ui/Tabs.svelte';
  import SegmentedControl from '../ui/SegmentedControl.svelte';
  import Select from '../ui/Select.svelte';
  import Pill from '../ui/Pill.svelte';
  import Tooltip from '../ui/Tooltip.svelte';
  import IconButton from '../ui/IconButton.svelte';
  import Eyebrow from '../ui/Eyebrow.svelte';
  import LayoutGrid from '@lucide/svelte/icons/layout-grid';
  import X from '@lucide/svelte/icons/x';
  import { defaultParams, type EffectDef, type Scope } from './sim';
  import { COLLECTIONS, type PlayType } from '@ledrums/core';
  import type { TriggerLab } from './store.svelte';

  let { store }: { store: TriggerLab } = $props();

  let scope = $state<Scope>('drum');
  let collection = $state<string>('all'); // 'all' | PlayType
  let query = $state('');
  let activeTags = $state<string[]>([]);
  let paramFilter = $state<string>(''); // '' = any parameter

  const block = $derived(store.galleryBlock);
  const currentEffectId = $derived(block?.kind === 'play' ? block.effectId : null);

  // Snap the scope chip to the block being edited whenever the gallery opens, and reset filters.
  $effect(() => {
    if (block?.kind === 'play') {
      // A hoop-scoped node draws from the drum-scoped pool (a hoop is a sub-region of a drum).
      scope = block.scope === 'hoop' ? 'drum' : block.scope;
      collection = 'all';
      activeTags = [];
      paramFilter = '';
      query = '';
    }
  });

  const playTypeOf = (e: EffectDef): PlayType => e.playType ?? 'ambient';

  // The pool for the active scope, minus retired effects — everything the filters draw from.
  const pool = $derived(store.effects.filter((e) => !e.deprecated && e.scope === scope));

  // Collection tabs: only those with at least one effect in the current scope (+ an "All" tab).
  const collectionTabs = $derived([
    { value: 'all', label: 'All' },
    ...COLLECTIONS.filter((c) => pool.some((e) => playTypeOf(e) === c.type)).map((c) => ({
      value: c.type,
      label: c.label,
    })),
  ]);

  // Tag universe + param universe for the chip row / dropdown — scoped to what's available.
  const tagUniverse = $derived(
    [...new Set(pool.flatMap((e) => e.tags ?? []))].sort() as string[],
  );
  const paramOptions = $derived([
    { value: '', label: 'Any parameter' },
    ...[...new Set(pool.flatMap((e) => e.params.map((p) => p.key)))].sort().map((k) => ({
      value: k,
      label: k,
    })),
  ]);

  const shown = $derived.by(() => {
    const q = query.trim().toLowerCase();
    return pool.filter((e) => {
      if (collection !== 'all' && playTypeOf(e) !== collection) return false;
      if (activeTags.length && !activeTags.every((t) => (e.tags ?? []).includes(t as never))) return false;
      if (paramFilter && !e.params.some((p) => p.key === paramFilter)) return false;
      if (q) {
        const hay = `${e.name} ${e.description ?? ''} ${(e.tags ?? []).join(' ')}`.toLowerCase();
        if (!hay.includes(q)) return false;
      }
      return true;
    });
  });

  const SCOPE_OPTIONS = [
    { value: 'drum', label: 'Drum' },
    { value: 'kit', label: 'Kit' },
  ];

  function toggleTag(tag: string): void {
    activeTags = activeTags.includes(tag) ? activeTags.filter((t) => t !== tag) : [...activeTags, tag];
  }

  function previewParams(effectId: string) {
    const eff = store.effects.find((e) => e.id === effectId)!;
    return store.presetById(`${effectId}:default`)?.params ?? defaultParams(eff);
  }

  function pick(effectId: string): void {
    if (block) store.pickEffect(block, effectId);
    store.closeGallery();
  }
</script>

<Dialog open={!!block} onClose={() => store.closeGallery()} title="Change effect" layer={2} class="dlg-gallery">
  {#if block}
    <header class="ghead">
      <Eyebrow icon={LayoutGrid}>Change effect</Eyebrow>
      <SearchField bind:value={query} placeholder="Search name, description, tags…" ariaLabel="Search effects" class="ghead-search" />
      <span class="spacer"></span>
      <IconButton icon={X} label="Close" onclick={() => store.closeGallery()} />
    </header>

    <div class="gtabs">
      <Tabs value={collection} tabs={collectionTabs} onChange={(v) => (collection = v)} ariaLabel="Effect collection" />
    </div>

    <div class="gfilters">
      <SegmentedControl value={scope} options={SCOPE_OPTIONS} onChange={(v) => (scope = v as Scope)} ariaLabel="Effect scope" />
      <Select value={paramFilter} options={paramOptions} onChange={(v) => (paramFilter = v)} placeholder="Any parameter" ariaLabel="Filter by parameter" class="param-sel" />
      {#if tagUniverse.length}
        <div class="tagrow" role="group" aria-label="Filter by tag">
          {#each tagUniverse as tag (tag)}
            <Pill label={tag} onclick={() => toggleTag(tag)} selected={activeTags.includes(tag)} />
          {/each}
        </div>
      {/if}
    </div>

    {#if shown.length === 0}
      <p class="empty">No effects match these filters.</p>
    {:else}
      <div class="grid">
        {#each shown as eff, i (eff.id)}
          {@const tags = eff.tags ?? []}
          <button
            class="cell"
            class:sel={eff.id === currentEffectId}
            style="--i:{i}"
            type="button"
            onclick={() => pick(eff.id)}
          >
            <EffectThumb params={previewParams(eff.id)} generatorId={eff.generatorId} labModel={store.labModel} w={170} h={92} />
            <span class="name">{eff.name}</span>
            {#if eff.description}<span class="desc">{eff.description}</span>{/if}
            <span class="cfoot">
              <span class="ctags">
                {#each tags.slice(0, 3) as tag (tag)}<Pill label={tag} />{/each}
                {#if tags.length > 3}
                  <Tooltip text={tags.slice(3).join(', ')}><Pill label={`+${tags.length - 3}`} /></Tooltip>
                {/if}
              </span>
              <Tooltip text={eff.params.map((p) => p.label).join(', ') || 'No parameters'}>
                <Pill tone="accent" label={`${eff.params.length} ${eff.params.length === 1 ? 'param' : 'params'}`} />
              </Tooltip>
            </span>
          </button>
        {/each}
      </div>
    {/if}
  {/if}
</Dialog>

<style>
  :global(.dlg-gallery) {
    width: min(820px, 94vw);
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
    width: 260px;
    max-width: 44vw;
  }
  .spacer {
    flex: 1;
  }
  .gtabs {
    padding: var(--space-2) var(--space-4) 0;
    background: var(--surface-2);
  }
  .gfilters {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: var(--space-2) var(--space-3);
    padding: var(--space-3) var(--space-4);
    background: var(--surface-2);
    border-bottom: 1px solid var(--border-faint);
  }
  .gfilters :global(.param-sel) {
    min-width: 9rem;
  }
  .tagrow {
    display: flex;
    flex-wrap: wrap;
    gap: var(--space-1);
    min-width: 0;
  }
  .empty {
    margin: 0;
    padding: var(--space-4);
    font-size: var(--text-sm);
    color: var(--text-muted);
  }
  .grid {
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(184px, 1fr));
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
    transition: border-color var(--dur-120) ease, transform var(--dur-120) ease, box-shadow var(--dur-120) ease;
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
    margin-top: var(--space-1);
    font-size: var(--text-sm);
    font-weight: 600;
    color: var(--ink);
  }
  .desc {
    font-size: var(--text-xs);
    line-height: 1.4;
    color: var(--text-muted);
    display: -webkit-box;
    -webkit-line-clamp: 2;
    line-clamp: 2;
    -webkit-box-orient: vertical;
    overflow: hidden;
  }
  .cfoot {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: var(--space-2);
    width: 100%;
    margin-top: var(--space-1);
  }
  .ctags {
    display: flex;
    flex-wrap: wrap;
    gap: var(--space-1);
    min-width: 0;
  }
  @media (prefers-reduced-motion: no-preference) {
    .cell {
      animation: cell-in 220ms var(--ease-control) both;
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
