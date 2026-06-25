<script lang="ts">
  /* Patch Graph view — the input/device routing: controllers · MIDI · OSC feed
     the Kit (drums + zones), which renders to the Output device. This replaces the
     old Input Map table and the Settings page. Selecting a node loads its settings
     into the right-dock Inspector. A freeform draggable node canvas (like the
     trigger graph) is a later milestone; for now it's a fixed signal-flow layout. */
  import type { TriggerLab } from '../../trigger-lab/store.svelte';
  import type { ShellStore } from '../shell-store.svelte';
  import type { PatchNodeId } from '../shell-nav';
  import type { Component } from 'svelte';
  import Eyebrow from '../../ui/Eyebrow.svelte';
  import ArrowRight from '@lucide/svelte/icons/arrow-right';
  import Gamepad2 from '@lucide/svelte/icons/gamepad-2';
  import Piano from '@lucide/svelte/icons/piano';
  import Radio from '@lucide/svelte/icons/radio';
  import Box from '@lucide/svelte/icons/box';
  import Cable from '@lucide/svelte/icons/cable';

  let { store, shell }: { store: TriggerLab; shell: ShellStore } = $props();

  type PatchNode = { id: PatchNodeId; title: string; sub: string; icon: Component; role: string };
  const INPUTS: PatchNode[] = [
    { id: 'controller', title: 'Controller', sub: 'Sensory Percussion', icon: Gamepad2, role: 'var(--role-input)' },
    { id: 'midi', title: 'MIDI In', sub: 'device · note map', icon: Piano, role: 'var(--role-input)' },
    { id: 'osc', title: 'OSC In', sub: 'address map', icon: Radio, role: 'var(--role-input)' },
  ];
  const KIT = $derived<PatchNode>({ id: 'kit', title: 'Kit', sub: `${store.drums.length} drums · zones`, icon: Box, role: 'var(--role-layer)' });
  const OUTPUT: PatchNode = { id: 'output', title: 'Output', sub: 'Art-Net / sACN · IP · FPS', icon: Cable, role: 'var(--role-output)' };

  const isSel = (id: PatchNodeId) => shell.isSelected({ kind: 'patch', nodeId: id });
</script>

{#snippet pnode(n: PatchNode)}
  {@const I = n.icon}
  <button class="pnode" class:sel={isSel(n.id)} style="--role:{n.role}" onclick={() => shell.select({ kind: 'patch', nodeId: n.id })}>
    <span class="picon"><I size={18} aria-hidden="true" /></span>
    <span class="ptitle">{n.title}</span>
    <span class="psub">{n.sub}</span>
  </button>
{/snippet}

<div class="patch-view">
  <header class="phead">
    <Eyebrow icon={Cable}>Patch Graph · input &amp; device routing</Eyebrow>
    <span class="hint">select a node → settings load in the Inspector</span>
  </header>

  <div class="canvas">
    <div class="col inputs">
      <span class="collabel">Inputs</span>
      {#each INPUTS as n (n.id)}{@render pnode(n)}{/each}
    </div>

    <div class="arrow"><ArrowRight size={20} aria-hidden="true" /></div>

    <div class="col">
      <span class="collabel">Kit</span>
      {@render pnode(KIT)}
    </div>

    <div class="arrow"><ArrowRight size={20} aria-hidden="true" /></div>

    <div class="col">
      <span class="collabel">Output</span>
      {@render pnode(OUTPUT)}
    </div>
  </div>
</div>

<style>
  .patch-view {
    display: grid;
    grid-template-rows: auto minmax(0, 1fr);
    gap: var(--space-3);
    min-height: 0;
    height: 100%;
  }
  .phead {
    display: flex;
    align-items: baseline;
    justify-content: space-between;
    gap: var(--space-3);
    padding: var(--space-2) var(--space-3);
    background: var(--surface);
    border: 1px solid var(--border-faint);
    border-radius: var(--radius-card);
  }
  .hint {
    font-size: var(--text-2xs);
    color: var(--text-faint);
  }
  .canvas {
    display: flex;
    align-items: center;
    justify-content: center;
    gap: var(--space-3);
    flex-wrap: wrap;
    min-height: 0;
    padding: var(--space-4);
    background: var(--bg-perform);
    background-image: radial-gradient(circle, var(--border-faint) 1px, transparent 1.4px);
    background-size: 22px 22px;
    border: 1px solid var(--border-faint);
    border-radius: var(--radius-card);
    overflow: auto;
  }
  .col {
    display: flex;
    flex-direction: column;
    gap: var(--space-2);
    align-self: stretch;
    justify-content: center;
  }
  .collabel {
    font-size: var(--text-2xs);
    font-family: var(--font-mono);
    text-transform: uppercase;
    letter-spacing: var(--tracking-label);
    color: var(--text-faint);
    padding-left: 2px;
  }
  .pnode {
    display: grid;
    grid-template-columns: auto 1fr;
    grid-template-areas: 'icon title' 'icon sub';
    align-items: center;
    column-gap: var(--space-2);
    min-width: 184px;
    padding: var(--space-3);
    text-align: left;
    background: var(--surface-2);
    border: 1px solid var(--border);
    border-radius: var(--radius-3);
    transition: border-color 140ms ease, transform 140ms ease;
  }
  .pnode:hover {
    border-color: var(--border-strong);
    transform: translateY(-1px);
  }
  .pnode.sel {
    border-color: color-mix(in oklch, var(--accent) 60%, transparent);
    box-shadow: 0 0 0 1px color-mix(in oklch, var(--accent) 40%, transparent);
  }
  /* signal-path role colour rides the icon (icon + label), not a side border */
  .picon {
    grid-area: icon;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    width: 32px;
    height: 32px;
    border-radius: var(--radius-2);
    color: var(--role);
    background: color-mix(in oklch, var(--role) 16%, transparent);
  }
  .ptitle {
    grid-area: title;
    font-size: var(--text-sm);
    font-weight: 700;
    color: var(--ink);
  }
  .psub {
    grid-area: sub;
    font-size: var(--text-2xs);
    color: var(--text-faint);
    font-family: var(--font-mono);
  }
  .arrow {
    display: inline-flex;
    align-items: center;
    color: var(--text-faint);
    flex: none;
  }
  @media (prefers-reduced-motion: reduce) {
    .pnode {
      transition: none;
    }
  }
</style>
