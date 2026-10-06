<script lang="ts">
  /* A palette — several colours in order — as a row of colour boxes (Tim, 2026-10-07: "if i have 4
     dots running, it would be good if … there was a 'per dot' param, with 4 colours to choose from,
     like in splice", and of the rainbow look: "i love the look and would love to have the ability to
     choose that"). Click a box to pick its colour; + adds one, − takes the last away; the rainbow
     button fills it round the colour wheel. Stored as comma-separated `#rrggbb`. */
  import { hsvToHex } from '@ledrums/core';
  import ColorField from '../../../../../ui/ColorField.svelte';
  import IconButton from '../../../../../ui/IconButton.svelte';
  import GestureScope from './GestureScope.svelte';
  import Plus from '@lucide/svelte/icons/plus';
  import Minus from '@lucide/svelte/icons/minus';
  import Rainbow from '@lucide/svelte/icons/rainbow';

  let {
    value,
    disabled = false,
    ariaLabel,
    onChange,
    onGestureStart,
    onGestureEnd,
  }: {
    /** The colours, comma-separated `#rrggbb`. */
    value: string;
    disabled?: boolean;
    ariaLabel: string;
    onChange: (next: string) => void;
    onGestureStart?: () => void;
    onGestureEnd?: () => void;
  } = $props();

  const MAX = 8;
  const colours = $derived(
    value
      .split(',')
      .map((c) => c.trim())
      .filter((c) => /^#[0-9a-f]{6}$/i.test(c)),
  );

  const set = (list: string[]) => onChange(list.join(','));
  function change(i: number, colour: string): void {
    const next = [...colours];
    next[i] = colour;
    set(next);
  }
  /** One more colour: the next step round the wheel from the last. */
  function add(): void {
    const n = colours.length + 1;
    set([...colours, hsvToHex(((n - 1) * 360) / Math.max(4, n), 1, 1)]);
  }
  const remove = () => set(colours.slice(0, -1));
  /** The same number of colours, spread evenly round the colour wheel. */
  const rainbow = () => set(colours.map((_, i) => hsvToHex((i * 360) / colours.length, 1, 1)));
</script>

<div class="colour-palette" role="group" aria-label={ariaLabel}>
  <ol class="wells">
    {#each colours as colour, i (i)}
      <li>
        <GestureScope onGestureStart={() => onGestureStart?.()} onGestureEnd={() => onGestureEnd?.()}>
          <ColorField
            value={colour}
            clearable={false}
            {disabled}
            ariaLabel={`${ariaLabel} colour ${i + 1}`}
            onChange={(next) => next && change(i, next)}
            class="well"
          />
        </GestureScope>
      </li>
    {/each}
  </ol>
  <span class="tools">
    <IconButton icon={Minus} label="Remove the last colour" size={13} disabled={disabled || colours.length <= 1} onclick={remove} />
    <IconButton icon={Plus} label="Add a colour" size={13} disabled={disabled || colours.length >= MAX} onclick={add} />
    <IconButton icon={Rainbow} label="Fill round the colour wheel" size={13} {disabled} onclick={rainbow} />
  </span>
</div>

<style>
  .colour-palette {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 4px 6px;
  }
  .wells {
    display: flex;
    flex-wrap: wrap;
    gap: 4px;
    margin: 0;
    padding: 0;
    list-style: none;
  }
  /* Just the box: the hex would make a row of eight too wide for the card. */
  .wells :global(.well .hex) {
    display: none;
  }
  .tools {
    display: inline-flex;
    gap: 2px;
    margin-left: auto;
  }
</style>
