<script lang="ts">
  /* Graphs rail — the LEFT pane of the Trigger view (tabbed-chrome S3), re-housing
     the old bottom GraphsDock's cards as a vertical list. The active section's
     graphs as cards: each wears its hotkey badge (keys 1–9 and 0 fire graphs 1–10 —
     handled globally in App.svelte), a mini-map of the real graph tinted by node kind,
     a linked badge when the graph is placed in more than one section, the graph name
     and its trigger source. Clicking a card opens it on the canvas. Firing ticks a quiet
     accent marker in the card's left edge, keyed off store.graphFireAt (the one fire signal:
     keyboard, local hit and SERVER engine fires all land there, so a hit traces to its card
     in both modes); a graph whose loop/hold voices are still sounding also wears a steady
     "playing" dot, so the kit's current light always traces back to a card. Those answer
     different questions and can be lit at once.
     Right-click carries the card's verbs; "+ Add graph" opens the library
     picker. Section switching lives outside the rail (the shell's sections bar and the global
     ←/→ hotkeys), so this pane is just the active section's graphs. */
  import type { TriggerLab } from '../../trigger-lab/store.svelte';
  import type { NodeKind } from '../../trigger-lab/sim';
  import type { ShellStore } from '../shell-store.svelte';
  import { graphPlacementCount } from '../setlist';
  import { describeTriggerSource } from '../trigger-source-label';
  import { graphThumb } from './graph-thumb';
  import { hotkeyLabel } from './graph-card-hotkey';
  import { tint } from './trigger-node-meta';
  import AddGraphDialog from './AddGraphDialog.svelte';
  import ContextMenu, { type ContextMenuAction } from '../../ui/ContextMenu.svelte';
  import CommitInput from '../../ui/CommitInput.svelte';
  import ConfirmDialog from '../../ui/ConfirmDialog.svelte';
  import PanelHeader from '../../ui/PanelHeader.svelte';
  import Tooltip from '../../ui/Tooltip.svelte';
  import Workflow from '@lucide/svelte/icons/workflow';
  import Plus from '@lucide/svelte/icons/plus';
  import Pencil from '@lucide/svelte/icons/pencil';
  import CopyPlus from '@lucide/svelte/icons/copy-plus';
  import Link2 from '@lucide/svelte/icons/link-2';
  import ListMinus from '@lucide/svelte/icons/list-minus';
  import Trash2 from '@lucide/svelte/icons/trash-2';

  let { store, shell }: { store: TriggerLab; shell: ShellStore } = $props();

  const section = $derived(store.activeSection);
  const graphs = $derived(section?.graphs ?? []);

  /** The graph whose card is showing its inline rename field, or null. */
  let renaming = $state<string | null>(null);
  /** The graph awaiting delete confirmation (delete purges it from every song). */
  let deleting = $state<string | null>(null);
  let adding = $state(false);

  function openGraph(key: string): void {
    if (!section) return;
    store.selectGraphInSection(section.id, key);
    shell.clearSelection(); // switching graphs clears the node inspector
  }
  function sourceSub(key: string): string {
    return describeTriggerSource(store.triggerSource(key), store.drums).sub;
  }
  /** How many sections across ALL songs place this graph — > 1 is the linked state. */
  function placements(key: string): number {
    return graphPlacementCount(store.songs, key);
  }
  function dotTint(kind: NodeKind | undefined): string {
    return (kind && tint[kind]) || 'var(--accent-dim)';
  }

  // Defer past the context menu's own close + focus-return, so the input we mount keeps focus
  // instead of the menu yanking it back to the (now-replaced) card (the EditableRow idiom).
  function startRename(key: string): void {
    requestAnimationFrame(() => (renaming = key));
  }
  function duplicateInto(key: string): void {
    if (!section) return;
    const copy = store.duplicateGraph(key);
    if (!copy) return;
    store.addGraphToSection(section.id, copy);
    openGraph(copy);
  }
  function cardActions(key: string): ContextMenuAction[] {
    return [
      { label: 'Rename', icon: Pencil, onSelect: () => startRename(key) },
      { label: 'Duplicate into section', icon: CopyPlus, onSelect: () => duplicateInto(key) },
      {
        label: 'Remove from section',
        icon: ListMinus,
        onSelect: () => section && store.removeGraphFromSection(section.id, key),
      },
      { label: 'Delete everywhere…', icon: Trash2, danger: true, onSelect: () => (deleting = key) },
    ];
  }

  /** How long a card shows its fire marker (ms) — matches `--dur-150`, which the `fire-decay`
      animation below uses; that CSS owns the decay, this only decides whether to mount at all. */
  const FIRE_MARKER_MS = 150;
  /** Is this graph's last fire recent enough to still be shown? Evaluated when the card's fire
      epoch changes, so a fire that happened while the rail was unmounted (view switch) does not
      replay on arrival. */
  function firedRecently(at: number | undefined): boolean {
    return at !== undefined && performance.now() - at < FIRE_MARKER_MS;
  }
</script>

<aside class="grail" aria-label="Graphs">
  <PanelHeader icon={Workflow} title="Graphs">
    <span class="hint" aria-hidden="true"><kbd>1</kbd>–<kbd>9</kbd> fire</span>
  </PanelHeader>
  <div class="cards">
    {#if !section}
      <p class="none">No section is active — pick one in the Sections view.</p>
    {:else}
      {#each graphs as key, i (key)}
        {@const g = store.resolvedView.graphs[key]}
        {@const hk = hotkeyLabel(i)}
        {@const thumb = g ? graphThumb(g) : null}
        {@const links = placements(key)}
        {@const firedAt = store.graphFireAt[key]}
        {@const playing = store.playingGraphs.has(key)}
        {#if renaming === key}
          <div class="gcard gedit">
            <CommitInput
              value={store.graphLabel(key)}
              ariaLabel="Rename graph"
              onCommit={(name) => {
                renaming = null;
                store.renameGraph(key, name);
              }}
              onCancel={() => (renaming = null)}
            />
          </div>
        {:else}
          <ContextMenu actions={cardActions(key)} disabled={!store.canEdit}>
            <button
              type="button"
              class="gcard"
              class:sel={store.selectedPadKey === key}
              onclick={() => openGraph(key)}
              ondblclick={() => store.canEdit && startRename(key)}
              title="Open {store.graphLabel(key)}"
            >
              {#if thumb}
                <svg
                  class="gthumb"
                  viewBox="0 0 172 64"
                  preserveAspectRatio="xMidYMid meet"
                  aria-hidden="true"
                >
                  {#each thumb.paths as d, pi (pi)}<path {d} />{/each}
                  {#each thumb.dots as p, di (di)}<circle cx={p.x} cy={p.y} r="3.4" fill={dotTint(p.kind)} />{/each}
                </svg>
              {/if}
              <span class="gscrim" aria-hidden="true"></span>
              <span class="gbadges">
                {#if playing}
                  <Tooltip text="Playing — this graph is holding voices on the kit" side="left">
                    <span class="gplay" role="img" aria-label="Playing"></span>
                  </Tooltip>
                {/if}
                {#if links > 1}
                  <Tooltip text="Linked · placed in {links} sections" side="left">
                    <span class="glink"><Link2 size={11} aria-hidden="true" />{links}</span>
                  </Tooltip>
                {/if}
                {#if hk}<span class="khot">{hk}</span>{/if}
              </span>
              <span class="gmeta">
                <span class="gn">{store.graphLabel(key)}</span>
                <span class="gt">{sourceSub(key)}</span>
              </span>
              <!-- Fire marker. Re-keying on the fire epoch restarts it, so a drum roll reads as
                   repeated hits rather than one stuck bar. It sits well inside the card, so the
                   card's own `overflow: hidden` never clips it. -->
              {#if firedRecently(firedAt)}
                {#key firedAt}<span class="gfire" aria-hidden="true"></span>{/key}
              {/if}
            </button>
          </ContextMenu>
        {/if}
      {/each}
      {#if store.canEdit}
        <button type="button" class="newcard" onclick={() => (adding = true)}>
          <Plus size={15} aria-hidden="true" />
          Add graph
        </button>
      {/if}
    {/if}
  </div>
</aside>

<AddGraphDialog
  {store}
  {section}
  open={adding}
  onClose={() => (adding = false)}
  onAdded={(key) => openGraph(key)}
/>

<ConfirmDialog
  open={deleting !== null}
  title="Delete {deleting ? store.graphLabel(deleting) : ''}?"
  message="This deletes the graph everywhere — it is removed from every section of every song, not just this one."
  confirmLabel="Delete everywhere"
  danger
  onConfirm={() => deleting && store.deleteGraph(deleting)}
  onClose={() => (deleting = null)}
/>

<style>
  .grail {
    display: grid;
    grid-template-rows: auto minmax(0, 1fr);
    min-height: 0;
    height: 100%;
    background: var(--surface);
    border: 1px solid var(--border-faint);
    border-radius: var(--radius-card);
    overflow: hidden;
  }
  .hint {
    display: inline-flex;
    align-items: center;
    gap: 4px;
    font-size: var(--text-2xs);
    color: var(--text-faint);
    text-transform: none;
    letter-spacing: normal;
    white-space: nowrap;
  }
  kbd {
    display: inline-grid;
    place-items: center;
    min-width: 16px;
    height: 16px;
    padding: 0 4px;
    border: 1px solid var(--border);
    border-radius: var(--radius-1);
    background: var(--surface-2);
    box-shadow: 0 1px 0 var(--border);
    font-family: var(--font-mono);
    font-size: 9px;
    color: var(--text-muted);
  }
  .cards {
    display: flex;
    flex-direction: column;
    gap: var(--space-2);
    min-height: 0;
    padding: var(--space-2);
    overflow-y: auto;
  }
  .gcard {
    position: relative;
    flex: none;
    height: 84px;
    padding: 0;
    background: var(--surface-2);
    border: 1px solid var(--border-faint);
    border-radius: var(--radius-3);
    text-align: left;
    cursor: pointer;
    overflow: hidden;
    /* instant hover on graph chrome (locked prefs) */
  }
  .gcard:hover {
    border-color: var(--border-strong);
  }
  .gcard.sel {
    border-color: var(--accent);
    box-shadow: 0 0 0 1px var(--accent);
  }
  /* rename swaps the card body for the field, keeping the card's footprint */
  .gedit {
    display: grid;
    align-items: center;
    padding: 0 var(--space-2);
    cursor: default;
  }
  /* one badge cluster, top-right: linked count then hotkey — so neither lands on a thumb dot */
  .gbadges {
    position: absolute;
    top: 8px;
    right: 8px;
    z-index: 1;
    display: flex;
    align-items: center;
    gap: 5px;
  }
  .khot {
    display: grid;
    place-items: center;
    min-width: 20px;
    height: 20px;
    padding: 0 5px;
    border: 1.5px solid var(--border-strong);
    border-radius: var(--radius-2);
    background: var(--surface-3);
    box-shadow: 0 2px 0 var(--border);
    font-family: var(--font-mono);
    font-size: var(--text-xs);
    font-weight: 700;
    font-variant-numeric: tabular-nums;
    color: var(--text);
  }
  .gcard.sel .khot {
    border-color: var(--accent-dim);
    color: var(--accent);
  }
  /* NOW PLAYING — a lit pixel, not an animation. The fire marker owns the transient; this owns
     the sustained state, so it must be readable at a glance while never pulling the eye off the
     canvas. A static halo does the work a pulse would. */
  .gplay {
    display: block;
    width: 7px;
    height: 7px;
    border-radius: 50%;
    background: var(--accent);
    box-shadow: 0 0 6px var(--accent-dim);
  }
  .glink {
    display: inline-flex;
    align-items: center;
    gap: 3px;
    height: 18px;
    padding: 0 6px 0 5px;
    border: 1px solid var(--border-faint);
    border-radius: var(--radius-pill, 999px);
    background: var(--surface-2);
    font-family: var(--font-mono);
    font-size: var(--text-2xs);
    font-variant-numeric: tabular-nums;
    color: var(--text-muted);
  }
  .gcard:hover .glink {
    border-color: var(--border);
    color: var(--text);
  }
  .gthumb {
    position: absolute;
    inset: 0;
    width: 100%;
    height: 100%;
    opacity: 0.72;
    pointer-events: none;
  }
  .gthumb path {
    fill: none;
    stroke: var(--border);
    stroke-width: 1.4;
  }
  /* dot fill is the node kind's tint, set per-circle — a CSS `fill` here would beat the
     presentation attribute and flatten every dot back to one colour. */
  /* keeps the name legible over the now-coloured mini-map */
  .gscrim {
    position: absolute;
    inset: 40% 0 0;
    background: linear-gradient(to bottom, transparent, var(--surface-2));
    pointer-events: none;
  }
  .gmeta {
    position: absolute;
    left: 10px;
    right: 10px;
    bottom: 8px;
    display: flex;
    flex-direction: column;
    gap: 1px;
    min-width: 0;
  }
  .gn {
    font-size: var(--text-sm);
    font-weight: 600;
    color: var(--ink);
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .gt {
    font-size: var(--text-2xs);
    font-family: var(--font-mono);
    color: var(--text-muted);
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  /* FIRE — one quiet marker, no wash, no halo, no ring (Trent, live preview: the burst read as
     too intense). A bar floated INSIDE the card's left edge, never on it: a selected card
     already wears an accent border, and a marker sitting on that border would read as part of
     the selection ring. Decays over `--dur-150`. */
  .gfire {
    position: absolute;
    left: 5px;
    top: 12px;
    bottom: 12px;
    z-index: 2;
    width: 3px;
    border-radius: 3px;
    background: var(--accent);
    pointer-events: none;
    animation: fire-decay var(--dur-150) linear forwards;
  }
  @keyframes fire-decay {
    from {
      opacity: 1;
    }
    to {
      opacity: 0;
    }
  }
  .newcard {
    flex: none;
    display: flex;
    align-items: center;
    justify-content: center;
    gap: var(--space-1);
    height: 40px;
    background: transparent;
    border: 1.5px dashed var(--border);
    border-radius: var(--radius-3);
    font-size: var(--text-sm);
    color: var(--text-muted);
    cursor: pointer;
  }
  .newcard:hover {
    border-color: var(--accent-dim);
    color: var(--accent);
  }
  .newcard:active {
    scale: 0.98;
  }
  .none {
    margin: 0;
    padding: var(--space-2);
    font-size: var(--text-xs);
    color: var(--text-faint);
  }
  @media (prefers-reduced-motion: reduce) {
    /* Nothing here moves any more — the marker only fades. But tokens.css zeroes every --dur-*
       under this query, and a zero-length decay would DELETE the indicator rather than calm it,
       so hold the marker for the same beat and cut it without the fade. */
    .gfire {
      animation: fire-decay 150ms step-end forwards;
    }
    .newcard:active {
      scale: 1;
    }
  }
</style>
