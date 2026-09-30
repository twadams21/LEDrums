<script lang="ts">
  /* MIDI-map mode (effect chains S07b): the real MapModeOverlay, `mappable` attachment and
     map-mode controller, over the in-memory MapModeApi fixture — scoped to each demo, so the
     scrim / capture layer stay inside the card. Not registered in Styleguide.svelte by this
     piece — the orchestrator registers it at merge. */
  import { effectChain } from '@ledrums/core';
  import type { MappableSpec } from '../../trigger-lab/map-api';
  import MapModeOverlay from '../../app/map-mode/MapModeOverlay.svelte';
  import { MapModeController, type MapModeShell } from '../../app/map-mode/map-mode.svelte';
  import { MemoryMapModeApi } from '../../app/map-mode/memory-map-api.svelte';
  import { mappable } from '../../app/map-mode/mappable.svelte';
  import { decideMapModeKey } from '../../app/map-mode/map-keys';
  import { isEditableShortcutTarget } from '../../app/primary-shortcut';
  import Switch from '../../ui/Switch.svelte';
  import Slider from '../../ui/Slider.svelte';
  import DemoCard from '../DemoCard.svelte';
  import KeyboardMusic from '@lucide/svelte/icons/keyboard-music';

  type EffectCell = effectChain.EffectCell;
  const cell = (row: string, slot: number): EffectCell => ({ row, column: { kind: 'zone', slot } });

  const specs = {
    kickCenter: { target: { kind: 'fireCell', cell: cell('kick', 0) }, kind: 'button', label: 'Kick · Center' },
    kickRim: { target: { kind: 'fireCell', cell: cell('kick', 1) }, kind: 'button', label: 'Kick · Rim' },
    snare: { target: { kind: 'fireCell', cell: cell('snare', 0) }, kind: 'button', label: 'Snare · Head' },
    bypass: { target: { kind: 'bypass', effectId: 'wash' }, kind: 'toggle', label: 'Wash · Bypass' },
    opacity: { target: { kind: 'opacity', effectId: 'wash' }, kind: 'continuous', label: 'Wash · Opacity' },
    chorus: { target: { kind: 'recallSection', sectionId: 'chorus' }, kind: 'button', label: 'Section · Chorus' },
    nextSong: { target: { kind: 'globalControl', action: 'nextSong' }, kind: 'button', label: 'Next song' },
  } satisfies Record<string, MappableSpec>;

  const ZONE_CLAIM = { source: { midiNote: 38 }, reason: 'Note 38 already triggers Snare · Head (zone)' } as const;

  /** A stand-in for the shell's map-mode flag (the app uses ShellStore). */
  function demoShell(on: boolean): MapModeShell {
    let mapMode = $state(on);
    return {
      get mapMode() {
        return mapMode;
      },
      setMapMode(next: boolean) {
        mapMode = next;
      },
    };
  }

  // ---- interactive demo ----
  const api = new MemoryMapModeApi({
    mappings: [
      { id: 'm1', source: { midiNote: 36 }, target: specs.kickCenter.target },
      { id: 'm2', source: { midiCc: 21 }, target: specs.opacity.target, rangeMin: 0.2, rangeMax: 1 },
      { id: 'm3', source: { key: 'KeyQ' }, target: specs.chorus.target },
    ],
    globals: { nextSong: { oscAddress: '/song/next' } },
    claims: [ZONE_CLAIM],
  });
  const shell = demoShell(true);
  const controller = new MapModeController(() => api);
  let scope = $state<HTMLElement | null>(null);
  let bypass = $state(false);
  let opacity = $state(0.8);

  // The styleguide has no app keyboard dispatcher; this is the same decision, applied to the demo.
  function onKey(event: KeyboardEvent): void {
    if (!shell.mapMode || isEditableShortcutTarget(event.target)) return;
    const d = decideMapModeKey(event, 'other');
    if (d.kind === 'pass' || !controller.armed) return;
    event.preventDefault();
    if (d.kind === 'exit' || d.kind === 'toggle') shell.setMapMode(false);
    else if (d.kind === 'clear') controller.clearArmed();
    else if (d.kind === 'learn') controller.learnKey(d.code);
  }

  // ---- static states: one control each ----
  function stateDemo(options: { mapped?: boolean; arm?: boolean; refuse?: boolean }) {
    const spec = specs.snare;
    const demoApi = new MemoryMapModeApi({
      mappings: options.mapped ? [{ id: 's1', source: { midiNote: 40 }, target: spec.target }] : [],
      claims: [ZONE_CLAIM],
    });
    const demoController = new MapModeController(() => demoApi);
    if (options.arm) demoController.arm(spec);
    if (options.refuse) demoApi.receiveLearnInput(ZONE_CLAIM.source);
    return { api: demoApi, controller: demoController, shell: demoShell(true), spec };
  }
  const states = [
    { name: 'Idle', note: 'Mappable, unbound: orange outline, no badge.', ...stateDemo({}) },
    { name: 'Mapped', note: 'Tinted fill and a badge with the binding.', ...stateDemo({ mapped: true }) },
    { name: 'Armed', note: 'Pulses while waiting for input.', ...stateDemo({ mapped: true, arm: true }) },
    { name: 'Conflict', note: 'A refused binding: red, and it stays armed.', ...stateDemo({ arm: true, refuse: true }) },
  ];
  const stateScopes = $state<(HTMLElement | null)[]>(states.map(() => null));
</script>

<svelte:window onkeydown={onKey} />

<section class="block" id="map-mode">
  <div class="block-head">
    <h2>MIDI-map mode</h2>
    <p>
      Ableton-style mapping: toggle the mode and every mappable control turns orange. Click one,
      then press a MIDI note, move a CC, send OSC or press a key. Rendered from the shipped
      overlay over an in-memory mapping api.
    </p>
  </div>

  <div class="comp-grid">
    <DemoCard
      title="Map mode over a control surface"
      src={['lib/app/map-mode/MapModeOverlay', 'lib/app/map-mode/mappable.svelte', 'lib/app/map-mode/map-mode.svelte', 'lib/app/map-mode/map-keys']}
      note="Everything unmappable is dimmed and inert: a press arms the control under it instead of acting, so nothing fires by accident. The armed control pulses; the hint bar names it and edits a continuous mapping's range. Try it: click a control, press a key (Q, 1, Space…); Backspace clears, Esc leaves. Kick · Rim with Note 38 is refused (it is a zone's note). In the app the bar floats above the bottom bar and the TopBar MIDI toggle (⌘M) enters the mode."
      wide
    >
      <div class="surface" bind:this={scope}>
        <div class="toolbar" data-map-mode-chrome>
          <button type="button" class="toggle" class:on={shell.mapMode} aria-pressed={shell.mapMode} onclick={() => shell.setMapMode(!shell.mapMode)}>
            <KeyboardMusic size={15} aria-hidden="true" /><span>MIDI</span>
          </button>
          <span class="sim">
            Simulate input:
            <button type="button" class="sim-btn" onclick={() => api.receiveLearnInput({ midiNote: 38 })}>Note 38</button>
            <button type="button" class="sim-btn" onclick={() => api.receiveLearnInput({ midiNote: 41 })}>Note 41</button>
            <button type="button" class="sim-btn" onclick={() => api.receiveLearnInput({ midiCc: 7 })}>CC 7</button>
            <button type="button" class="sim-btn" onclick={() => api.receiveLearnInput({ oscAddress: '/wash/opacity' })}>OSC</button>
          </span>
        </div>

        <div class="rows">
          <div class="row">
            <span class="row-label">Kick</span>
            <button type="button" class="cell" {@attach mappable(specs.kickCenter)}>Center</button>
            <button type="button" class="cell" {@attach mappable(specs.kickRim)}>Rim</button>
            <span class="row-label">Snare</span>
            <button type="button" class="cell" {@attach mappable(specs.snare)}>Head</button>
          </div>
          <div class="row">
            <span class="row-label">Wash</span>
            <span class="ctl" {@attach mappable(specs.bypass)}><Switch bind:checked={bypass} ariaLabel="Wash bypass" /></span>
            <span class="ctl fader" {@attach mappable(specs.opacity)}><Slider bind:value={opacity} min={0} max={1} step={0.01} /></span>
          </div>
          <div class="row">
            <span class="row-label">Setlist</span>
            <button type="button" class="chip" {@attach mappable(specs.chorus)}>Chorus</button>
            <button type="button" class="chip" {@attach mappable(specs.nextSong)}>Next song ›</button>
            <span class="unmappable">Show name (not mappable)</span>
          </div>
        </div>

        <MapModeOverlay {api} {shell} {scope} {controller} />
      </div>
    </DemoCard>

    <DemoCard
      title="Control states"
      src={['lib/app/map-mode/MapModeOverlay', 'lib/app/map-mode/memory-map-api.svelte']}
      note="Idle · mapped · armed · conflict, each on one grid cell. Badges read the core source label: Note 40, CC 21, /osc/x, Key Q."
      wide
    >
      <div class="states">
        {#each states as s, i (s.name)}
          <figure class="state">
            <div class="state-stage" bind:this={stateScopes[i]}>
              <button type="button" class="cell" {@attach mappable(s.spec)}>Head</button>
              <MapModeOverlay api={s.api} shell={s.shell} scope={stateScopes[i]} controller={s.controller} bar={false} />
            </div>
            <figcaption>
              <strong>{s.name}</strong> {s.note}
              {#if s.controller.refusal}<span class="reason">{s.controller.refusal}</span>{/if}
            </figcaption>
          </figure>
        {/each}
      </div>
    </DemoCard>
  </div>
</section>

<style>
  .surface {
    position: relative;
    display: grid;
    gap: var(--space-3);
    min-height: 300px;
    padding: var(--space-3) var(--space-3) 76px;
    background: var(--bg);
    border: 1px solid var(--border-faint);
    border-radius: var(--radius-3);
    overflow: hidden;
  }
  .toolbar {
    display: flex;
    align-items: center;
    gap: var(--space-3);
    flex-wrap: wrap;
  }
  .toggle {
    display: inline-flex;
    align-items: center;
    gap: var(--space-1_5);
    height: var(--control-icon-size);
    padding: 0 var(--space-2);
    border: 1px solid var(--border);
    border-radius: var(--radius-2);
    background: var(--surface-2);
    color: var(--text-faint);
    font-size: var(--text-2xs);
    font-weight: 700;
    letter-spacing: var(--tracking-label);
    cursor: pointer;
  }
  .toggle.on {
    background: var(--map);
    border-color: var(--map-bright);
    color: var(--on-map);
  }
  .sim {
    display: inline-flex;
    align-items: center;
    gap: var(--space-1);
    color: var(--text-faint);
    font-size: var(--text-2xs);
  }
  .sim-btn {
    height: 26px;
    padding: 0 var(--space-2);
    border: 1px solid var(--border);
    border-radius: var(--radius-2);
    background: var(--surface-2);
    color: var(--text-muted);
    font-family: var(--font-mono);
    font-size: var(--text-2xs);
    cursor: pointer;
  }
  .rows {
    display: grid;
    gap: var(--space-4);
    padding-top: var(--space-2);
  }
  .row {
    display: flex;
    align-items: center;
    gap: var(--space-3);
  }
  .row-label {
    width: 56px;
    color: var(--text-faint);
    font-size: var(--text-2xs);
    letter-spacing: var(--tracking-label);
    text-transform: uppercase;
  }
  .cell,
  .chip {
    height: 40px;
    min-width: 88px;
    padding: 0 var(--space-3);
    border: 1px solid var(--border);
    border-radius: var(--radius-2);
    background: var(--surface-2);
    color: var(--text);
    font-size: var(--text-xs);
    cursor: pointer;
  }
  .chip {
    height: 30px;
    min-width: 0;
    border-radius: var(--radius-pill);
  }
  .ctl {
    display: inline-flex;
    align-items: center;
    padding: var(--space-1);
    border-radius: var(--radius-2);
  }
  .fader {
    width: 200px;
  }
  .unmappable {
    color: var(--text-faint);
    font-size: var(--text-xs);
  }
  .states {
    display: grid;
    grid-template-columns: repeat(4, minmax(0, 1fr));
    gap: var(--space-4);
  }
  .state {
    margin: 0;
    display: grid;
    gap: var(--space-2);
  }
  .state-stage {
    position: relative;
    display: grid;
    place-items: center;
    height: 96px;
    background: var(--bg);
    border: 1px solid var(--border-faint);
    border-radius: var(--radius-3);
    overflow: hidden;
  }
  figcaption {
    color: var(--text-muted);
    font-size: var(--text-2xs);
    text-wrap: pretty;
  }
  figcaption strong {
    color: var(--ink);
  }
  .reason {
    display: block;
    margin-top: var(--space-1);
    color: var(--live-bright);
    font-size: var(--text-2xs);
  }
</style>
