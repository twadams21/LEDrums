<script lang="ts">
  import type { Clip, Curve, Modulation } from '@ledrums/core';
  import { store } from '../store/app-store.svelte';

  const CURVES: Curve[] = ['linear', 'exp', 'log', 'invert'];

  const layer = $derived(store.selectedLayer);
  const clip = $derived(layer?.clips.find((c) => c.id === layer?.activeClipId) ?? null);
  const mods = $derived(clip?.modulations ?? []);

  function sourceLabel(m: Modulation): string {
    const s = m.source;
    switch (s.type) {
      case 'velocity':
        return s.drum ? `velocity[${s.drum}]` : 'velocity';
      case 'volume':
        return 'volume';
      case 'beat':
        return `beat ×${s.mult}`;
      case 'lfo':
        return `lfo ${s.shape} @${s.rate}Hz`;
      case 'osc':
        return `osc ${s.address}`;
      default:
        return 'source';
    }
  }

  /**
   * There is no dedicated setModulation WS message, and clip ids are stable, so
   * an edit rebuilds the clip with updated modulations via removeClip + addClip
   * (the sanctioned mutation path). The clip keeps its id, params, and effect.
   */
  function rebuildClip(nextMods: Modulation[]): void {
    if (!layer || !clip) return;
    const updated: Clip = { ...clip, modulations: nextMods };
    const wasActive = layer.activeClipId === clip.id;
    store.removeClip(layer.id, clip.id);
    store.addClip(layer.id, updated);
    if (wasActive) store.setLayer(layer.id, { activeClipId: updated.id });
  }

  function setRange(index: number, field: 'min' | 'max', value: number): void {
    if (!Number.isFinite(value)) return;
    const next = mods.map((m, i) => (i === index ? { ...m, [field]: value } : m));
    rebuildClip(next);
  }

  function setCurve(index: number, curve: Curve): void {
    const next = mods.map((m, i) => (i === index ? { ...m, curve } : m));
    rebuildClip(next);
  }

  function remove(index: number): void {
    rebuildClip(mods.filter((_, i) => i !== index));
  }
</script>

<section class="mod">
  {#if !clip}
    <div class="empty">No active clip selected.</div>
  {:else if mods.length === 0}
    <div class="empty">
      No modulations on this clip. Modulations bind a control source (velocity, LFO,
      OSC…) to a parameter; they ship with the project.
    </div>
  {:else}
    <table>
      <thead>
        <tr>
          <th>source</th>
          <th>param</th>
          <th>min</th>
          <th>max</th>
          <th>curve</th>
          <th></th>
        </tr>
      </thead>
      <tbody>
        {#each mods as m, i (i)}
          <tr>
            <td class="src">{sourceLabel(m)}</td>
            <td class="param">{m.param}</td>
            <td>
              <input
                type="number"
                step="0.01"
                value={m.min}
                onchange={(e) => setRange(i, 'min', Number((e.currentTarget as HTMLInputElement).value))}
                aria-label="min"
              />
            </td>
            <td>
              <input
                type="number"
                step="0.01"
                value={m.max}
                onchange={(e) => setRange(i, 'max', Number((e.currentTarget as HTMLInputElement).value))}
                aria-label="max"
              />
            </td>
            <td>
              <select value={m.curve} onchange={(e) => setCurve(i, (e.currentTarget as HTMLSelectElement).value as Curve)}>
                {#each CURVES as c (c)}
                  <option value={c}>{c}</option>
                {/each}
              </select>
            </td>
            <td>
              <button class="x" onclick={() => remove(i)} aria-label="Remove modulation">✕</button>
            </td>
          </tr>
        {/each}
      </tbody>
    </table>
    <p class="note">
      Editing min/max/curve rebuilds the clip (remove + add, stable id) — there is no
      dedicated modulation message in the wire protocol.
    </p>
  {/if}
</section>

<style>
  .mod {
    display: flex;
    flex-direction: column;
    gap: 8px;
  }
  table {
    width: 100%;
    border-collapse: collapse;
    font-size: 11px;
  }
  th {
    text-align: left;
    color: var(--text-faint);
    font-weight: 500;
    font-size: 10px;
    padding: 2px 4px;
    text-transform: uppercase;
    letter-spacing: 0.4px;
  }
  td {
    padding: 3px 4px;
    border-top: 1px solid var(--border);
    vertical-align: middle;
  }
  td.src {
    color: var(--accent);
    font-family: var(--mono);
    font-size: 10px;
  }
  td.param {
    color: var(--text);
  }
  td input {
    width: 54px;
  }
  td select {
    width: 72px;
  }
  .x {
    padding: 2px 6px;
    color: var(--text-faint);
    border-color: transparent;
    background: transparent;
  }
  .x:hover {
    color: var(--live);
  }
  .note {
    margin: 0;
    color: var(--text-faint);
    font-size: 10px;
    line-height: 1.4;
  }
  .empty {
    color: var(--text-faint);
    font-size: 12px;
    line-height: 1.4;
  }
</style>
