<script lang="ts">
  import type { Project } from '@ledrums/core';
  import { store } from '../store/app-store.svelte';

  type OutState = Project['output']['state'];
  type Protocol = Project['output']['protocol'];
  type RgbOrder = Project['output']['rgbOrder'];

  const RGB_ORDERS: RgbOrder[] = ['RGB', 'RBG', 'GRB', 'GBR', 'BRG', 'BGR'];

  // Live status is the source of truth; the project mirrors the configured values.
  const status = $derived(store.outputStatus);
  const cfg = $derived(store.project?.output ?? null);
  const liveState = $derived<OutState>(status?.state ?? cfg?.state ?? 'disabled');

  // Editable host (text input) seeded from the project; committed on change.
  let hostDraft = $state('');
  let hostInit = $state(false);
  $effect(() => {
    if (!hostInit && cfg) {
      hostDraft = cfg.host;
      hostInit = true;
    }
  });

  function setState(state: OutState): void {
    store.setOutput({ state });
  }
  function commitHost(): void {
    if (hostDraft.trim()) store.setOutput({ host: hostDraft.trim() });
  }
  function setProtocol(e: Event): void {
    store.setOutput({ protocol: (e.currentTarget as HTMLSelectElement).value as Protocol });
  }
  function setRgbOrder(e: Event): void {
    store.setOutput({ rgbOrder: (e.currentTarget as HTMLSelectElement).value as RgbOrder });
  }
  function setBroadcast(e: Event): void {
    store.setOutput({ broadcast: (e.currentTarget as HTMLInputElement).checked });
  }
  function setFps(e: Event): void {
    const fps = Number((e.currentTarget as HTMLInputElement).value);
    if (Number.isFinite(fps) && fps > 0) store.setOutput({ fps });
  }
</script>

<section class="output">
  <div class="banner state-{liveState}">
    {#if liveState === 'armed'}
      <span class="live-dot"></span><strong>LIVE</strong><span class="sub">armed · transmitting</span>
    {:else if liveState === 'dry-run'}
      <strong>DRY-RUN</strong><span class="sub">forming packets, not sending</span>
    {:else}
      <strong>DISABLED</strong><span class="sub">output off</span>
    {/if}
  </div>

  <div class="states">
    <button class:active={liveState === 'disabled'} onclick={() => setState('disabled')}>Disabled</button>
    <button class:active={liveState === 'dry-run'} onclick={() => setState('dry-run')}>Dry-run</button>
    <button class="arm" class:armed={liveState === 'armed'} onclick={() => setState('armed')}>Armed</button>
  </div>

  {#if cfg}
    <label class="field">
      <span>Target IP (host)</span>
      <input
        type="text"
        bind:value={hostDraft}
        onchange={commitHost}
        placeholder="192.168.1.50"
        spellcheck="false"
      />
    </label>

    <div class="grid2">
      <label class="field">
        <span>Protocol</span>
        <select value={cfg.protocol} onchange={setProtocol}>
          <option value="artnet">Art-Net</option>
          <option value="sacn">sACN (E1.31)</option>
        </select>
      </label>
      <label class="field">
        <span>RGB order</span>
        <select value={cfg.rgbOrder} onchange={setRgbOrder}>
          {#each RGB_ORDERS as o (o)}
            <option value={o}>{o}</option>
          {/each}
        </select>
      </label>
      <label class="field">
        <span>FPS</span>
        <input type="number" min="1" max="120" value={cfg.fps} onchange={setFps} />
      </label>
      <label class="field check">
        <input type="checkbox" checked={cfg.broadcast} onchange={setBroadcast} />
        <span>Broadcast</span>
      </label>
    </div>
  {/if}

  <dl class="status">
    <div><dt>state</dt><dd class="state-{liveState}">{liveState}</dd></div>
    <div><dt>protocol</dt><dd>{status?.protocol ?? cfg?.protocol ?? '—'}</dd></div>
    <div><dt>host</dt><dd>{status?.host ?? cfg?.host ?? '—'}</dd></div>
    <div><dt>packets</dt><dd>{status?.packetsSent ?? 0}</dd></div>
    {#if status?.universeCount !== undefined}
      <div><dt>universes</dt><dd>{status.universeCount}</dd></div>
    {/if}
    {#if status?.lastError}
      <div class="err"><dt>error</dt><dd>{status.lastError}</dd></div>
    {/if}
  </dl>
</section>

<style>
  .output {
    display: flex;
    flex-direction: column;
    gap: 9px;
  }
  .banner {
    display: flex;
    align-items: center;
    gap: 8px;
    padding: 7px 10px;
    border-radius: 6px;
    border: 1px solid var(--border);
    background: var(--panel-raised);
  }
  .banner .sub {
    color: var(--text-dim);
    font-size: 11px;
  }
  .banner.state-armed {
    background: #3a0c0c;
    border-color: var(--live);
    box-shadow: 0 0 14px var(--live-glow);
    animation: pulse 1.2s ease-in-out infinite;
  }
  .banner.state-armed strong {
    color: #fff;
    letter-spacing: 1px;
  }
  .banner.state-dry-run {
    border-color: var(--warn);
  }
  .banner.state-dry-run strong {
    color: var(--warn);
  }
  @keyframes pulse {
    0%,
    100% {
      box-shadow: 0 0 8px var(--live-glow);
    }
    50% {
      box-shadow: 0 0 20px var(--live-glow);
    }
  }
  .live-dot {
    width: 10px;
    height: 10px;
    border-radius: 50%;
    background: var(--live);
    box-shadow: 0 0 8px var(--live);
  }
  .states {
    display: grid;
    grid-template-columns: 1fr 1fr 1fr;
    gap: 6px;
  }
  .states .arm.armed {
    background: var(--live);
    border-color: var(--live);
    color: #fff;
    font-weight: 700;
  }
  .field {
    display: flex;
    flex-direction: column;
    gap: 3px;
  }
  .field > span {
    color: var(--text-dim);
    font-size: 10px;
  }
  .field.check {
    flex-direction: row;
    align-items: center;
    gap: 6px;
    align-self: end;
    padding-bottom: 5px;
  }
  .grid2 {
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: 8px;
  }
  .status {
    margin: 0;
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: 3px 12px;
    font-size: 11px;
    border-top: 1px solid var(--border);
    padding-top: 8px;
  }
  .status div {
    display: flex;
    gap: 6px;
  }
  .status dt {
    color: var(--text-faint);
    min-width: 58px;
  }
  .status dd {
    margin: 0;
    font-variant-numeric: tabular-nums;
    color: var(--text);
    overflow: hidden;
    text-overflow: ellipsis;
  }
  .status .state-armed {
    color: var(--live);
    font-weight: 700;
  }
  .status .state-dry-run {
    color: var(--warn);
  }
  .status .err {
    grid-column: 1 / -1;
  }
  .status .err dd {
    color: var(--live);
  }
</style>
