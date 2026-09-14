<script lang="ts">
  import { voice } from '@ledrums/core';
  import { trackInputAddress, type TrackInputsStatus } from '@ledrums/protocol';
  import Field from '../../ui/Field.svelte';
  import Select from '../../ui/Select.svelte';
  import StatusPill from '../../ui/StatusPill.svelte';
  import LevelMeter from '../../ui/LevelMeter.svelte';
  import CopyableValue from '../../ui/CopyableValue.svelte';
  import Disclosure from '../../ui/Disclosure.svelte';
  import { AUDIO_BAND_LABELS } from '../../audio/band-labels';

  let { status = null, selected, canEdit = false, onSelect = () => {} }: {
    status?: TrackInputsStatus | null;
    selected?: string;
    canEdit?: boolean;
    onSelect?: (id: string | undefined) => void;
  } = $props();
  const inputs = $derived(status?.inputs ?? []);
  const audioOptions = $derived([
    { value: '@browser', label: 'Browser / loopback capture' },
    ...inputs.filter((input) => input.kind === 'audio').map((input) => ({ value: input.id, label: `${input.name}${input.connected ? '' : ' · disconnected'}` })),
    ...(selected && !inputs.some((input) => input.id === selected && input.kind === 'audio') ? [{ value: selected, label: `Unavailable track · ${selected}` }] : []),
  ]);
  const bridgeLabel = $derived(!status ? 'Engine disconnected' : status.status === 'listening' ? 'Listening locally' : status.status === 'error' ? 'Unavailable' : 'Off');
</script>

<section class="tracks" aria-label="Track inputs">
  <header>
    <h3>Track inputs</h3>
    <StatusPill tone={status?.status === 'listening' ? 'ok' : status?.status === 'error' ? 'live' : 'muted'} label={bridgeLabel} />
  </header>
  {#if status?.status === 'listening'}
    <CopyableValue value={`127.0.0.1:${status.port}`} label="Bridge" copyLabel="Copy track bridge address" />
  {/if}
  {#if status?.error}<p class="hint" role="alert">{status.error}</p>{/if}
  <p class="hint">Track devices appear here automatically. The bridge accepts inputs from this computer only; it does not grant editing access.</p>
  <Field label="Audio source" info="One input feeds Audio nodes. Per-track bands and macros can also be mapped independently with OSC nodes.">
    <Select value={selected ?? '@browser'} options={audioOptions} segment={false} disabled={!canEdit || (!status && !selected)}
      onChange={(id) => { if (canEdit && (id === '@browser' || status)) onSelect(id === '@browser' ? undefined : id); }} ariaLabel="Audio source for graph nodes" />
  </Field>
  {#if inputs.length === 0}
    <p class="empty">No track devices connected. Max for Live device sources are included in <code>integrations/ableton</code>; packaging and Live compatibility still need verification.</p>
  {:else}
    <ul>
      {#each inputs as input (input.id)}
        <li>
          <div class="identity">
            <span class="name" title={input.name}>{input.name}</span>
            <span class="kind">{input.kind === 'audio' ? 'Audio' : 'MIDI'}</span>
            <StatusPill tone={input.connected ? 'ok' : 'muted'} label={input.connected ? 'Connected' : 'Disconnected'} />
          </div>
          {#if input.kind === 'audio'}
            <div class="meters" aria-label={`${input.name} audio features`}>
              {#each voice.AUDIO_BANDS as band (band)}
                <LevelMeter label={AUDIO_BAND_LABELS[band]} value={input.audio[band]} muted={!input.connected} />
              {/each}
            </div>
          {:else}
            <p class="hint">{input.lastNote === null ? 'Waiting for notes' : `Last note ${input.lastNote} · channel ${input.lastChannel ?? 1}`} · follows existing MIDI routing</p>
          {/if}
          <Disclosure label="Track-specific mappings" open={false}>
            {#if input.kind === 'audio'}
              {#each voice.AUDIO_BANDS as band (band)}
                <CopyableValue value={trackInputAddress(input.id, `audio/${band}`)} label={AUDIO_BAND_LABELS[band]} />
              {/each}
            {:else}
              <CopyableValue value={trackInputAddress(input.id, `midi/${input.lastChannel ?? 1}/note/${input.lastNote ?? 60}`)} label="Trigger" />
              <p class="hint">Press-only address. Replace the final number for another note; use <code>gate</code> instead of <code>note</code> for held-note modulation.</p>
            {/if}
            <CopyableValue value={trackInputAddress(input.id, 'macro/1')} label="Macro 1" />
            <p class="hint">Use these addresses in OSC source nodes. Macros 1–8 can drive effect parameters from automation. Do not also route the same notes through a virtual MIDI port.</p>
          </Disclosure>
          {#if input.dropped > 0}<p class="hint" role="status">{input.dropped} missing packets — check the sender load.</p>{/if}
        </li>
      {/each}
    </ul>
  {/if}
</section>

<style>
  .tracks { display: flex; flex-direction: column; gap: var(--space-3); min-width: 0; }
  header, .identity { display: flex; align-items: center; flex-wrap: wrap; gap: var(--space-2); min-width: 0; }
  h3 { font-size: var(--text-sm); margin: 0; font-weight: 600; color: var(--ink); }
  .hint, .empty { margin: 0; font-size: var(--text-xs); line-height: 1.5; color: var(--text-muted); text-wrap: pretty; }
  code { font-family: var(--font-mono); overflow-wrap: anywhere; }
  ul { list-style: none; padding: 0; margin: 0; }
  li { display: flex; flex-direction: column; gap: var(--space-2); padding-block: var(--space-3); border-top: 1px solid var(--border-faint); }
  .name { flex: 1; min-width: 100px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; color: var(--text); font-size: var(--text-sm); }
  .kind { color: var(--text-muted); font-size: var(--text-xs); }
  .meters { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: var(--space-2); }
  .hint { font-variant-numeric: tabular-nums; }
</style>
