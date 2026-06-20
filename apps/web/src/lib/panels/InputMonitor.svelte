<script lang="ts">
  import { store } from '../store/app-store.svelte';

  // Drive a clock so flash brightness decays smoothly between input events.
  let now = $state(Date.now());
  $effect(() => {
    const id = setInterval(() => {
      now = Date.now();
    }, 60);
    return () => clearInterval(id);
  });

  const DECAY_MS = 450;
  const drums = $derived(store.model?.drums ?? []);

  // Most-recent hit per drum label, used to light that drum's cell.
  const byLabel = $derived.by(() => {
    const map = new Map<string, { value: number; at: number; kind: 'midi' | 'osc' }>();
    for (const h of store.hits) {
      if (!map.has(h.label)) map.set(h.label, { value: h.value, at: h.at, kind: h.kind });
    }
    return map;
  });

  function brightness(label: string): number {
    const hit = byLabel.get(label);
    if (!hit) return 0;
    const age = now - hit.at;
    if (age > DECAY_MS) return 0;
    const decay = 1 - age / DECAY_MS;
    // value 0..127 (midi) or 0..1 (osc) → normalize.
    const norm = hit.value > 1 ? hit.value / 127 : hit.value;
    return Math.max(0, Math.min(1, norm)) * decay;
  }

  function kindOf(label: string): 'midi' | 'osc' | null {
    return byLabel.get(label)?.kind ?? null;
  }

  // A short rolling tail of the last events (not an unbounded log).
  const tail = $derived(store.hits.slice(0, 8));
</script>

<section class="monitor">
  {#if drums.length === 0}
    <div class="empty">No kit — connect to monitor input.</div>
  {:else}
    <div class="cells">
      {#each drums as drum (drum.id)}
        {@const b = brightness(drum.label || drum.id)}
        {@const k = kindOf(drum.label || drum.id)}
        <div class="cell" style:--b={b} style:--c={drum.color}>
          <span class="dlabel">{drum.label || drum.id}</span>
          {#if k}
            <span class="kind kind-{k}">{k}</span>
          {/if}
        </div>
      {/each}
    </div>

    <div class="tail">
      {#if tail.length === 0}
        <span class="quiet">waiting for input…</span>
      {:else}
        {#each tail as h (h.id)}
          <span class="ev ev-{h.kind}">
            {h.label}
            <em>{h.value > 1 ? h.value.toFixed(0) : h.value.toFixed(2)}</em>
          </span>
        {/each}
      {/if}
    </div>
  {/if}
</section>

<style>
  .monitor {
    display: flex;
    flex-direction: column;
    gap: 8px;
  }
  .cells {
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(70px, 1fr));
    gap: 6px;
  }
  .cell {
    position: relative;
    aspect-ratio: 1.4 / 1;
    border-radius: 6px;
    border: 1px solid var(--border);
    background: color-mix(in srgb, var(--c) calc(var(--b) * 100%), #0d1118);
    box-shadow: 0 0 calc(var(--b) * 14px) color-mix(in srgb, var(--c) 70%, transparent);
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    gap: 3px;
    transition: background 0.06s linear, box-shadow 0.06s linear;
  }
  .dlabel {
    font-size: 11px;
    font-weight: 600;
    text-shadow: 0 1px 2px rgba(0, 0, 0, 0.7);
  }
  .kind {
    font-size: 8px;
    text-transform: uppercase;
    letter-spacing: 0.5px;
    padding: 0 4px;
    border-radius: 3px;
    background: rgba(0, 0, 0, 0.45);
  }
  .kind-midi {
    color: #7fd1ff;
  }
  .kind-osc {
    color: #ffb05a;
  }
  .tail {
    display: flex;
    flex-wrap: wrap;
    gap: 4px;
    min-height: 18px;
  }
  .ev {
    font-size: 10px;
    font-family: var(--mono);
    padding: 1px 5px;
    border-radius: 3px;
    background: var(--panel-raised);
    border: 1px solid var(--border);
  }
  .ev em {
    font-style: normal;
    color: var(--text-faint);
  }
  .ev-midi {
    border-color: #2a4a66;
  }
  .ev-osc {
    border-color: #66492a;
  }
  .quiet {
    color: var(--text-faint);
    font-size: 11px;
  }
  .empty {
    color: var(--text-faint);
    font-size: 12px;
  }
</style>
