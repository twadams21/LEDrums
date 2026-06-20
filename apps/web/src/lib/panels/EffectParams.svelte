<script lang="ts">
  import { store } from '../store/app-store.svelte';
  import { controlsForSpec, throttle, type ControlDescriptor } from './params';

  const layer = $derived(store.selectedLayer);
  const clip = $derived(layer?.clips.find((c) => c.id === layer?.activeClipId) ?? null);
  const effect = $derived(clip ? store.effectById(clip.effectId) : undefined);
  const controls = $derived<ControlDescriptor[]>(effect ? controlsForSpec(effect.paramSpec) : []);

  // One throttled sender per (layer,clip,key) so slider drags stay ~30/s.
  const throttled = new Map<string, ReturnType<typeof throttle<[number | string | boolean]>>>();

  function sendParam(key: string, value: number | string | boolean, live: boolean): void {
    if (!layer || !clip) return;
    if (!live) {
      // Discrete edits (select/checkbox/color commit) send immediately.
      store.setParam(layer.id, clip.id, key, value);
      return;
    }
    const mapKey = `${layer.id}:${clip.id}:${key}`;
    let fn = throttled.get(mapKey);
    if (!fn) {
      fn = throttle((v: number | string | boolean) => {
        store.setParam(layer.id, clip!.id, key, v);
      }, 33);
      throttled.set(mapKey, fn);
    }
    fn(value);
  }

  function currentValue(key: string, fallback: number | string | boolean): number | string | boolean {
    const v = clip?.params[key];
    return v === undefined ? fallback : v;
  }

  function onSlider(c: ControlDescriptor, e: Event): void {
    sendParam(c.key, Number((e.currentTarget as HTMLInputElement).value), true);
  }
  function onSwatch(c: ControlDescriptor, e: Event): void {
    sendParam(c.key, (e.currentTarget as HTMLInputElement).value, false);
  }
  function onSelect(c: ControlDescriptor, e: Event): void {
    sendParam(c.key, (e.currentTarget as HTMLSelectElement).value, false);
  }
  function onCheckbox(c: ControlDescriptor, e: Event): void {
    sendParam(c.key, (e.currentTarget as HTMLInputElement).checked, false);
  }
</script>

<section class="params">
  {#if !clip}
    <div class="empty">No active clip. Pick or trigger a clip to edit its parameters.</div>
  {:else}
    <header>
      <span class="fx">{effect?.name ?? clip.effectId}</span>
      <span class="cat">{effect?.category ?? ''}</span>
    </header>
    {#if controls.length === 0}
      <div class="empty">This effect exposes no parameters.</div>
    {:else}
      <div class="list">
        {#each controls as c (c.key)}
          <label class="param">
            <span class="label">
              {c.label}
              {#if c.kind === 'slider'}
                <em class="val">{Number(currentValue(c.key, c.default)).toFixed(2)}{c.unit ?? ''}</em>
              {/if}
            </span>
            {#if c.kind === 'slider'}
              <input
                type="range"
                min={c.min ?? 0}
                max={c.max ?? 1}
                step={c.step ?? 0.01}
                value={Number(currentValue(c.key, c.default))}
                oninput={(e) => onSlider(c, e)}
              />
            {:else if c.kind === 'swatch'}
              <input
                type="color"
                value={String(currentValue(c.key, c.default))}
                oninput={(e) => onSwatch(c, e)}
              />
            {:else if c.kind === 'select'}
              <select value={String(currentValue(c.key, c.default))} onchange={(e) => onSelect(c, e)}>
                {#each c.options ?? [] as opt (opt)}
                  <option value={opt}>{opt}</option>
                {/each}
              </select>
            {:else}
              <input
                type="checkbox"
                checked={Boolean(currentValue(c.key, c.default))}
                onchange={(e) => onCheckbox(c, e)}
              />
            {/if}
          </label>
        {/each}
      </div>
    {/if}
  {/if}
</section>

<style>
  .params {
    display: flex;
    flex-direction: column;
    gap: 8px;
  }
  header {
    display: flex;
    align-items: baseline;
    gap: 8px;
    border-bottom: 1px solid var(--border);
    padding-bottom: 6px;
  }
  .fx {
    font-weight: 700;
  }
  .cat {
    font-size: 10px;
    color: var(--text-faint);
    text-transform: uppercase;
    letter-spacing: 0.5px;
  }
  .list {
    display: flex;
    flex-direction: column;
    gap: 9px;
  }
  .param {
    display: flex;
    flex-direction: column;
    gap: 4px;
  }
  .label {
    display: flex;
    justify-content: space-between;
    align-items: baseline;
    color: var(--text-dim);
    font-size: 11px;
  }
  .val {
    font-style: normal;
    font-variant-numeric: tabular-nums;
    color: var(--text);
    font-size: 11px;
  }
  .empty {
    color: var(--text-faint);
    font-size: 12px;
  }
</style>
