<script lang="ts">
  import type { DrumConfig } from '@ledrums/core';
  import { store } from '../store/app-store.svelte';

  const drums = $derived(store.project?.kit.drums ?? []);
  const globalHoops = $derived(store.project?.kit.global.hoopCount ?? 0);

  let openId = $state<string | null>(null);

  function toggle(id: string): void {
    openId = openId === id ? null : id;
  }

  function setVec(drum: DrumConfig, field: 'origin' | 'rotation', axis: 'x' | 'y' | 'z', value: number): void {
    if (!Number.isFinite(value)) return;
    const base = { ...drum[field], [axis]: value };
    store.setKitTransform(drum.id, { [field]: base });
  }

  function setSpin(drum: DrumConfig, value: number): void {
    if (Number.isFinite(value)) store.setKitTransform(drum.id, { localSpinDeg: value });
  }
  function setStartAngle(drum: DrumConfig, value: number): void {
    if (Number.isFinite(value)) store.setKitTransform(drum.id, { startAngleDeg: value });
  }

  function num(e: Event): number {
    return Number((e.currentTarget as HTMLInputElement).value);
  }
</script>

<section class="kit">
  {#if drums.length === 0}
    <div class="empty">No kit loaded.</div>
  {:else}
    {#each drums as drum (drum.id)}
      <div class="drum" class:open={openId === drum.id}>
        <button class="head" onclick={() => toggle(drum.id)}>
          <span class="swatch" style:background={drum.color}></span>
          <span class="label">{drum.label || drum.id}</span>
          <span class="ro">{drum.diameterIn}″ · {drum.hoopCount ?? globalHoops} hoops</span>
          <span class="chev">{openId === drum.id ? '▾' : '▸'}</span>
        </button>

        {#if openId === drum.id}
          <div class="body">
            <div class="vgroup">
              <span class="gl">origin (mm)</span>
              <div class="axes">
                {#each ['x', 'y', 'z'] as const as ax (ax)}
                  <label>
                    <span>{ax}</span>
                    <input
                      type="number"
                      step="1"
                      value={drum.origin[ax]}
                      onchange={(e) => setVec(drum, 'origin', ax, num(e))}
                    />
                  </label>
                {/each}
              </div>
            </div>

            <div class="vgroup">
              <span class="gl">rotation (deg)</span>
              <div class="axes">
                {#each ['x', 'y', 'z'] as const as ax (ax)}
                  <label>
                    <span>{ax}</span>
                    <input
                      type="number"
                      step="1"
                      value={drum.rotation[ax]}
                      onchange={(e) => setVec(drum, 'rotation', ax, num(e))}
                    />
                  </label>
                {/each}
              </div>
            </div>

            <div class="vgroup">
              <div class="axes">
                <label>
                  <span>spin°</span>
                  <input
                    type="number"
                    step="1"
                    value={drum.localSpinDeg}
                    onchange={(e) => setSpin(drum, num(e))}
                  />
                </label>
                <label>
                  <span>start°</span>
                  <input
                    type="number"
                    step="1"
                    value={drum.startAngleDeg}
                    onchange={(e) => setStartAngle(drum, num(e))}
                  />
                </label>
              </div>
            </div>
          </div>
        {/if}
      </div>
    {/each}
    <p class="note">
      Transforms rebuild geometry live. Structural changes (hoop count, density) are
      file + restart.
    </p>
  {/if}
</section>

<style>
  .kit {
    display: flex;
    flex-direction: column;
    gap: 6px;
  }
  .drum {
    border: 1px solid var(--border);
    border-radius: 6px;
    background: var(--panel-raised);
    overflow: hidden;
  }
  .drum.open {
    border-color: var(--border-bright);
  }
  .head {
    width: 100%;
    display: flex;
    align-items: center;
    gap: 8px;
    background: transparent;
    border: none;
    border-radius: 0;
    padding: 7px 8px;
    text-align: left;
  }
  .swatch {
    width: 12px;
    height: 12px;
    border-radius: 3px;
    border: 1px solid rgba(255, 255, 255, 0.2);
  }
  .label {
    font-weight: 600;
    flex: 1;
  }
  .ro {
    color: var(--text-faint);
    font-size: 10px;
  }
  .chev {
    color: var(--text-dim);
  }
  .body {
    display: flex;
    flex-direction: column;
    gap: 8px;
    padding: 8px;
    border-top: 1px solid var(--border);
  }
  .gl {
    color: var(--text-dim);
    font-size: 10px;
    text-transform: uppercase;
    letter-spacing: 0.4px;
  }
  .axes {
    display: flex;
    gap: 6px;
    margin-top: 4px;
  }
  .axes label {
    display: flex;
    flex-direction: column;
    gap: 2px;
    flex: 1;
  }
  .axes label span {
    color: var(--text-faint);
    font-size: 10px;
  }
  .axes input {
    width: 100%;
    font-variant-numeric: tabular-nums;
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
  }
</style>
