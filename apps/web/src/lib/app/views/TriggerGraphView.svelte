<script lang="ts">
  /* Trigger Graph view — the Play Surface (triggers grouped by drum; pick one to
     edit its graph, fire it to preview) beside the freeform NodeCanvas. Selecting
     a node on the canvas loads it into the right-dock Inspector. */
  import type { TriggerLab } from '../../trigger-lab/store.svelte';
  import type { ShellStore } from '../shell-store.svelte';
  import type { Pad } from '../../trigger-lab/fixtures';
  import NodeCanvas from '../../trigger-lab/NodeCanvas.svelte';
  import Eyebrow from '../../ui/Eyebrow.svelte';
  import IconButton from '../../ui/IconButton.svelte';
  import Play from '@lucide/svelte/icons/play';

  let { store, shell }: { store: TriggerLab; shell: ShellStore } = $props();

  const padKey = (p: Pad) => `${p.drumId}:${p.zone}`;
  const selectedNodeId = $derived(shell.selection?.kind === 'node' ? shell.selection.nodeId : undefined);

  function pick(p: Pad): void {
    store.selectedPadKey = padKey(p);
    shell.clearSelection(); // switching graphs clears the node inspector
  }
</script>

<div class="trigger-view">
  <aside class="surface">
    <header class="shead"><Eyebrow>Play Surface</Eyebrow></header>
    <div class="scroll">
      {#each store.drums as drum (drum.id)}
        {@const pads = store.pads.filter((p) => p.drumId === drum.id)}
        <div class="group">
          <div class="ghead">{drum.label}</div>
          {#each pads as p (padKey(p))}
            <div class="trig" class:active={store.selectedPadKey === padKey(p)}>
              <button class="trig-main" onclick={() => pick(p)}>
                <span class="zone">{p.zoneLabel}</span>
                <span class="root">{p.tree.kind}</span>
              </button>
              <IconButton icon={Play} label="Fire {drum.label} {p.zoneLabel}" size={13} onclick={() => store.hit(p)} />
            </div>
          {/each}
        </div>
      {/each}
    </div>
  </aside>

  <section class="canvas">
    <NodeCanvas
      {store}
      onSelect={(node) => shell.select({ kind: 'node', nodeId: node.id })}
      selectedId={selectedNodeId}
    />
  </section>
</div>

<style>
  .trigger-view {
    display: grid;
    grid-template-columns: 232px minmax(0, 1fr);
    gap: var(--space-3);
    min-height: 0;
    height: 100%;
  }
  .surface {
    display: grid;
    grid-template-rows: auto minmax(0, 1fr);
    min-height: 0;
    background: var(--surface);
    border: 1px solid var(--border-faint);
    border-radius: var(--radius-card);
  }
  .shead {
    padding: var(--space-2) var(--space-3);
    border-bottom: 1px solid var(--border-faint);
  }
  .scroll {
    overflow: auto;
    min-height: 0;
    padding: var(--space-2);
    display: flex;
    flex-direction: column;
    gap: var(--space-2);
  }
  .group {
    border: 1px solid var(--border-faint);
    border-radius: var(--radius-2);
    padding: var(--space-2);
    background: var(--surface-inset);
  }
  .ghead {
    font-size: var(--text-2xs);
    text-transform: uppercase;
    letter-spacing: var(--tracking-label);
    color: var(--text-muted);
    padding: 0 var(--space-1) var(--space-1);
  }
  .trig {
    display: flex;
    align-items: center;
    gap: var(--space-1);
    border: 1px solid transparent;
    border-radius: var(--radius-1);
  }
  .trig.active {
    border-color: color-mix(in oklch, var(--accent) 50%, var(--border));
    background: var(--accent-soft);
  }
  .trig-main {
    display: flex;
    flex: 1;
    align-items: baseline;
    gap: var(--space-2);
    justify-content: flex-start;
    padding: var(--space-2);
    background: transparent;
    border: none;
    text-align: left;
    min-width: 0;
  }
  .trig-main:hover .zone {
    color: var(--ink);
  }
  .zone {
    font-size: var(--text-sm);
    color: var(--text);
    text-transform: capitalize;
  }
  .trig.active .zone {
    color: var(--ink);
  }
  .root {
    font-size: var(--text-2xs);
    font-family: var(--font-mono);
    color: var(--accent);
    text-transform: uppercase;
  }
  .canvas {
    min-height: 0;
    min-width: 0;
    border: 1px solid var(--border-faint);
    border-radius: var(--radius-card);
    overflow: hidden;
  }
</style>
