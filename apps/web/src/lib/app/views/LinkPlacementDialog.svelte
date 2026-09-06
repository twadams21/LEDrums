<script lang="ts">
  import type { TriggerLab } from '../../trigger-lab/store.svelte';
  import type { SetlistSection, Song } from '../setlist';
  import Dialog from '../../ui/Dialog.svelte';
  import Link2 from '@lucide/svelte/icons/link-2';
  import X from '@lucide/svelte/icons/x';
  import IconButton from '../../ui/IconButton.svelte';

  let {
    store,
    open,
    sourceSong,
    sourceSection,
    sourceGraphKey,
    onClose,
  }: {
    store: TriggerLab;
    open: boolean;
    sourceSong: Song | null;
    sourceSection: SetlistSection | null;
    sourceGraphKey: string | null;
    onClose: () => void;
  } = $props();

  type Candidate = { song: Song; section: SetlistSection; graphKey: string };
  const candidates = $derived.by((): Candidate[] => {
    if (!sourceSong || !sourceSection || !sourceGraphKey) return [];
    return store.songs.flatMap((song) =>
      song.sections.flatMap((section) =>
        section.graphs
          .filter((graphKey) => !(song.id === sourceSong.id && section.id === sourceSection.id && graphKey === sourceGraphKey))
          .map((graphKey) => ({ song, section, graphKey })),
      ),
    );
  });

  function link(candidate: Candidate): void {
    if (!sourceSong || !sourceSection || !sourceGraphKey) return;
    store.linkGraphPlacement(
      sourceSong.id,
      sourceSection.id,
      sourceGraphKey,
      candidate.song.id,
      candidate.section.id,
      candidate.graphKey,
    );
    onClose();
  }
</script>

<Dialog {open} onClose={onClose} title="Link graph placement" class="link-placement-dialog">
  <header class="dialog-head">
    <div>
      <p class="eyebrow"><Link2 size={13} aria-hidden="true" /> Link / sync</p>
      <h2>{sourceGraphKey ? store.graphLabel(sourceGraphKey) : 'Graph'}</h2>
      {#if sourceSection}<p class="source">{sourceSong?.name} · {sourceSection.name}</p>{/if}
    </div>
    <IconButton icon={X} label="Close" onclick={onClose} />
  </header>
  <p class="hint">Choose the exact placement that should share this graph. Future edits sync across every linked placement.</p>
  <div class="candidates" role="list" aria-label="Graph placements">
    {#each candidates as candidate (candidate.song.id + ':' + candidate.section.id + ':' + candidate.graphKey)}
      <button class="candidate" type="button" onclick={() => link(candidate)}>
        <span class="candidate-main">
          <strong>{candidate.song.name}</strong>
          <span>{candidate.section.name}</span>
        </span>
        <span class="candidate-graph">{store.graphLabel(candidate.graphKey)}</span>
        <Link2 size={14} aria-hidden="true" />
      </button>
    {:else}
      <p class="empty">No other local placements.</p>
    {/each}
  </div>
</Dialog>

<style>
  :global(.link-placement-dialog) { width: min(460px, 92vw); }
  .dialog-head { display: flex; justify-content: space-between; gap: var(--space-3); padding: var(--space-3) var(--space-4); background: var(--surface-2); border-bottom: 1px solid var(--border-faint); }
  .dialog-head h2 { margin: var(--space-1) 0 0; color: var(--text-strong); font-size: var(--text-sm); }
  .eyebrow { display: flex; align-items: center; gap: var(--space-1); margin: 0; color: var(--accent); font: var(--text-2xs) var(--font-mono); text-transform: uppercase; letter-spacing: var(--tracking-label); }
  .source, .hint, .empty { margin: var(--space-2) 0 0; color: var(--text-faint); font-size: var(--text-xs); }
  .hint { padding: 0 var(--space-4); line-height: 1.45; }
  .candidates { display: flex; flex-direction: column; gap: var(--space-1); padding: var(--space-3); max-height: 360px; overflow: auto; }
  .candidate { display: flex; align-items: center; gap: var(--space-2); width: 100%; padding: var(--space-2); border: 1px solid var(--border-faint); border-radius: var(--radius-2); background: var(--surface-2); color: var(--text); text-align: left; cursor: pointer; }
  .candidate:hover, .candidate:focus-visible { border-color: var(--border-accent); color: var(--ink); }
  .candidate-main { display: flex; flex-direction: column; gap: 2px; min-width: 115px; }
  .candidate-main strong { color: var(--text-strong); font-size: var(--text-xs); }
  .candidate-main span, .candidate-graph { color: var(--text-faint); font: var(--text-2xs) var(--font-mono); }
  .candidate-graph { flex: 1; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .candidate :global(svg) { flex: none; color: var(--accent); }
</style>
