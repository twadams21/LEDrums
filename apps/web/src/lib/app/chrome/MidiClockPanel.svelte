<script lang="ts">
  /* MIDI clock — the transport's timing source (Settings › Input, under MIDI).

     Manual is the default and the safe state: an unsolicited clock can never take over a
     show. MIDI Clock is opt-in, and then ONE input owns it — the desktop app's native
     "LEDrums" port (read by the server) or one WebMIDI port of this browser — so two clocks
     are never combined and nothing is forwarded twice. The status line is the honest truth of
     that choice: waiting / running / stopped / lost, with the tempo marked as locked only once
     enough pulses have been measured. Copy is short because it is read in a dark room; the
     Ableton instruction is the one thing an operator actually needs to type.

     Composed from the design system (Field, Select, StatusPill) — no new primitives. The
     `adopt` button reuses the settings `.entry` button idiom (SystemPane). */
  import type { TriggerLab } from '../../trigger-lab/store.svelte';
  import Field from '../../ui/Field.svelte';
  import Select from '../../ui/Select.svelte';
  import StatusPill from '../../ui/StatusPill.svelte';
  import type { StatusTone } from '../../ui/StatusDot.svelte';
  import { clockInputOptions, clockInputValue } from '../../trigger-lab/store/midi-clock';

  let { store }: { store: TriggerLab } = $props();

  const SOURCE_OPTS = [
    { value: 'manual', label: 'Manual' },
    { value: 'midiClock', label: 'MIDI Clock' },
  ];

  const external = $derived(store.timingSource === 'midiClock');
  const disabled = $derived(!store.canEdit || !store.project);
  const inputValue = $derived(clockInputValue(store.clockInput, store.clockDeviceId));
  const inputOptions = $derived(clockInputOptions(store.midiDevices, store.clockDeviceId));
  const status = $derived(store.clockStatus);

  /** Which device name the Ableton hint should point at. */
  const chosenName = $derived(
    store.clockInput === 'native'
      ? 'LEDrums'
      : (store.midiDevices.find((d) => d.id === store.clockDeviceId)?.name ?? 'the selected port'),
  );

  const TONE: Record<typeof status.status, StatusTone> = {
    off: 'muted',
    waiting: 'muted',
    running: 'ok',
    stopped: 'warn',
    lost: 'live',
  };
  const LABEL: Record<typeof status.status, string> = {
    off: 'Manual',
    waiting: 'Waiting for clock',
    running: 'Running',
    stopped: 'Stopped',
    lost: 'Clock lost',
  };
  const bpmText = $derived(`${status.bpm.toFixed(1)} bpm`);
  const bpmHint = $derived(
    status.status === 'off' ? 'authored' : status.locked ? 'from clock' : 'seed — not locked yet',
  );
</script>

<section class="clock" aria-label="MIDI clock">
  <Field label="Timing source" info="Manual uses the authored tempo. MIDI Clock follows an external beat clock (Ableton Sync) for tempo, start, continue and stop.">
    <Select
      value={store.timingSource}
      options={SOURCE_OPTS}
      onChange={(v) => store.setTimingSource(v === 'midiClock' ? 'midiClock' : 'manual')}
      {disabled}
      ariaLabel="Timing source"
    />
  </Field>

  {#if external}
    <Field label="Clock input" info="One input owns the clock. Native is the desktop app's own LEDrums MIDI port; the others are this browser's WebMIDI inputs.">
      <Select
        value={inputValue}
        options={inputOptions}
        onChange={(v) => store.setClockInput(v)}
        {disabled}
        ariaLabel="Clock input"
        segment={false}
      />
    </Field>

    <div class="status" role="status" aria-live="polite">
      <StatusPill tone={TONE[status.status]} pulse={status.status === 'running'} label={LABEL[status.status]} />
      <span class="bpm"><strong class="num">{bpmText}</strong><em class="hint">{bpmHint}</em></span>
    </div>

    {#if status.status === 'lost'}
      <p class="note">
        No pulse for a second. The transport is frozen and not playing until the clock returns —
        or switch to Manual to run on the authored tempo.
      </p>
    {/if}

    {#if store.clockInput === 'browser' && !store.midiAvailable}
      <p class="note">
        WebMIDI isn't available in this window{store.midiUnavailableReason === 'no-api' ? ' (the desktop app runs in WKWebView)' : ''}.
        Choose the native LEDrums port instead.
      </p>
    {/if}

    <p class="note faint">
      In Ableton → Settings → Link, Tempo &amp; MIDI, turn on <strong>Sync</strong> for the MIDI
      Output <code>{chosenName}</code>. Clock drives the transport; effects authored in seconds
      run as authored.
    </p>

    {#if status.locked && store.canEdit}
      <div class="adopt">
        <button type="button" class="entry" onclick={() => store.adoptClockBpm()}>
          Use {status.bpm.toFixed(1)} bpm as the manual tempo
        </button>
        <span class="note faint">Switching to Manual keeps the authored {store.bpm} bpm; freeze the clock's tempo first if you want it.</span>
      </div>
    {/if}
  {/if}
</section>

<style>
  .clock {
    display: flex;
    flex-direction: column;
    gap: var(--space-2);
    min-width: 0;
  }

  .status {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: var(--space-2);
    min-height: 34px;
    padding: var(--space-1) var(--space-2);
    border: 1px solid var(--border-faint);
    border-radius: var(--radius-2);
    background: var(--surface-inset);
  }
  .bpm {
    display: inline-flex;
    align-items: baseline;
    gap: 6px;
    min-width: 0;
  }
  /* A live tempo readout: tabular so 119.9 → 120.0 does not shift the hint beside it. */
  .num {
    font-family: var(--font-mono);
    font-variant-numeric: tabular-nums;
    font-size: var(--text-sm);
    font-weight: 600;
    color: var(--text);
  }
  .hint {
    font-style: normal;
    font-size: var(--text-2xs);
    color: var(--text-faint);
    white-space: nowrap;
  }

  .note {
    margin: 0;
    font-size: var(--text-2xs);
    line-height: 1.45;
    text-wrap: pretty;
    color: var(--text-muted);
  }
  .note.faint {
    color: var(--text-faint);
  }
  code {
    font-family: var(--font-mono);
    color: var(--text);
  }

  .adopt {
    display: flex;
    flex-direction: column;
    gap: var(--space-1);
    align-items: flex-start;
  }
  /* Settings text button (SystemPane's `.entry`): same height, tokens, hover and press. */
  .entry {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    gap: 6px;
    height: 29px;
    padding: 0 var(--space-3);
    border: 1px solid var(--border);
    border-radius: var(--radius-2);
    background: var(--surface-inset);
    color: var(--text-muted);
    font-size: var(--text-2xs);
    font-weight: 600;
    font-variant-numeric: tabular-nums;
    white-space: nowrap;
    cursor: pointer;
    transition-property: border-color, color, scale;
    transition-duration: var(--dur-150);
  }
  .entry:hover {
    border-color: var(--accent);
    color: var(--ink);
  }
  .entry:active {
    scale: 0.96;
  }
</style>
