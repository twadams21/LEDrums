<script lang="ts">
  /* Test patterns (S49) — drive the controller's built-in test-data mode without an input source.

     Solid-colour swatches double as the "set colour" affordance: one click sends a setColor pattern
     (all ports, all pixels). White carries the W channel so an RGBW rig's white LEDs light too. The
     two ops cover cycle + fade. Starting any one takes the box over — ControllerBanners raises the
     banner for that — so the running control stays lit here, tying the two together.

     Split out of ControllerStatusPanel (INIT-09 S7). Pure presentational: plain values in,
     callbacks out. */
  import FlaskConical from '@lucide/svelte/icons/flask-conical';
  import RotateCcw from '@lucide/svelte/icons/rotate-ccw';
  import type { ControllerTestPattern } from '../../../ws/protocol-types';
  import Eyebrow from '../../../ui/Eyebrow.svelte';
  import ActionButton from '../../../ui/ActionButton.svelte';

  let {
    takeover = null,
    canEdit = true,
    onTestData,
    onBackToLive,
  }: {
    /** Active built-in test pattern, or null in normal LIVE mode. Lights the running control. */
    takeover?: ControllerTestPattern | null;
    canEdit?: boolean;
    onTestData?: (pattern: ControllerTestPattern) => void;
    onBackToLive?: () => void;
  } = $props();

  const SWATCHES: { label: string; rgb: string; color: [number, number, number, number] }[] = [
    { label: 'White', rgb: 'rgb(255 255 255)', color: [255, 255, 255, 255] },
    { label: 'Red', rgb: 'rgb(255 45 65)', color: [255, 0, 0, 0] },
    { label: 'Green', rgb: 'rgb(40 210 120)', color: [0, 255, 0, 0] },
    { label: 'Blue', rgb: 'rgb(60 130 255)', color: [0, 0, 255, 0] },
    { label: 'Amber', rgb: 'rgb(255 170 0)', color: [255, 140, 0, 0] },
    { label: 'Magenta', rgb: 'rgb(230 60 190)', color: [255, 0, 150, 0] },
  ];
  const takeoverActive = $derived(takeover !== null);
  /** The active solid swatch's index, or -1 when the takeover isn't a matching solid colour. */
  const activeSwatch = $derived(
    takeover?.op === 'setColor'
      ? SWATCHES.findIndex((s) => takeover.color?.every((v, i) => v === s.color[i]))
      : -1,
  );

  function sendColor(color: [number, number, number, number]): void {
    onTestData?.({ op: 'setColor', color, colorRes: '8Bit', pixPortNum: 0, pixNum: 0 });
  }
  function sendOp(op: 'rgbwCycle' | 'colorFade'): void {
    onTestData?.({ op, pixPortNum: 0, pixNum: 0 });
  }
</script>

<div class="testpatterns">
  <Eyebrow icon={FlaskConical}>Test patterns</Eyebrow>
  <div class="swatches" role="group" aria-label="Solid colour test">
    {#each SWATCHES as s, i (s.label)}
      <button
        type="button"
        class="swatch"
        class:on={activeSwatch === i}
        style="--swatch: {s.rgb}"
        disabled={!canEdit}
        title={`Solid ${s.label}`}
        aria-label={`Solid ${s.label} test`}
        aria-pressed={activeSwatch === i}
        onclick={() => sendColor(s.color)}
      ></button>
    {/each}
  </div>
  <div class="ops">
    <ActionButton pressed={takeover?.op === 'rgbwCycle'} disabled={!canEdit} onclick={() => sendOp('rgbwCycle')}>
      RGBW cycle
    </ActionButton>
    <ActionButton pressed={takeover?.op === 'colorFade'} disabled={!canEdit} onclick={() => sendOp('colorFade')}>
      Colour fade
    </ActionButton>
    <ActionButton disabled={!canEdit || !takeoverActive} onclick={() => onBackToLive?.()}>
      <RotateCcw size={13} aria-hidden="true" /> Live
    </ActionButton>
  </div>
</div>

<style>
  /* The drive controls. Kept visually quieter than the live-status readouts above (it's a diagnostic
     tool), but each control lights warn when it's the one taking the box over, tying back to the
     banner. */
  .testpatterns {
    display: flex;
    flex-direction: column;
    gap: var(--space-2);
    margin-top: var(--space-1);
    padding-top: var(--space-2);
    border-top: 1px solid var(--border-faint);
  }
  .swatches {
    display: flex;
    gap: var(--space-2);
  }
  .swatch {
    flex: 1;
    height: 26px;
    padding: 0;
    border: 1px solid var(--border);
    border-radius: var(--radius-2);
    background: var(--swatch);
    cursor: pointer;
    /* concentric: inner colour chip inside the row's radius, thin ring for contrast on any hue */
    box-shadow: inset 0 0 0 1px oklch(0 0 0 / 0.25);
    transition:
      transform var(--dur-120) var(--ease-control),
      box-shadow var(--dur-120) ease,
      outline-color var(--dur-120) ease;
    outline: 2px solid transparent;
    outline-offset: 2px;
  }
  .swatch:hover:not(:disabled) {
    transform: translateY(-1px);
  }
  .swatch:active:not(:disabled) {
    transform: translateY(0) scale(0.94);
  }
  .swatch.on {
    outline-color: var(--warn);
    box-shadow:
      inset 0 0 0 1px oklch(0 0 0 / 0.25),
      0 0 10px color-mix(in oklch, var(--warn) 45%, transparent);
  }
  .swatch:disabled {
    opacity: 0.5;
    cursor: default;
  }
  .ops {
    display: flex;
    gap: var(--space-2);
  }
</style>
