<script lang="ts">
  /* The colour window behind every colour box (Tim, 2026-10-07: "When you click on any given colour
     box you should be able to click on it again to close the window"). The browser's own picker
     can't be closed by the page — on macOS it is a floating system panel — so the box opens this
     instead: a click opens it, a click on the box again closes it, as do Esc and a click outside.

     Inside: the saturation × brightness square, the hue strip, and the hex. Every part takes the
     keyboard (arrows step, Shift steps further). One open → close is one gesture
     (`onGestureStart` / `onGestureEnd`), so a whole pick is one undo step however much it is
     dragged.

     The trigger is a transparent button laid over whatever the caller draws (the well), so each
     colour box keeps its own look. */
  import { Popover } from 'bits-ui';
  import { hexToHsv, hsvToHex, type Hsv } from '@ledrums/core';

  type Props = {
    /** The colour shown and edited. */
    hsv: Hsv;
    disabled?: boolean;
    ariaLabel?: string;
    onChange?: (hsv: Hsv) => void;
    onGestureStart?: () => void;
    onGestureEnd?: () => void;
  };

  let { hsv, disabled = false, ariaLabel = 'Colour', onChange, onGestureStart, onGestureEnd }: Props = $props();

  let open = $state(false);
  // The hue survives a pick at zero saturation or brightness, where the colour itself has none.
  let hue = $state(0);
  $effect.pre(() => {
    if (hsv.s > 0 && hsv.v > 0) hue = hsv.h;
  });
  const hex = $derived(hsvToHex(hue, hsv.s, hsv.v));
  const clamp = (n: number) => Math.min(1, Math.max(0, n));

  function setOpen(next: boolean): void {
    if (next === open) return;
    open = next;
    if (next) onGestureStart?.();
    else onGestureEnd?.();
  }
  $effect(() => () => {
    // Closed by unmounting mid-pick: still close the gesture.
    if (open) onGestureEnd?.();
  });

  function emit(next: Hsv): void {
    hue = next.h;
    onChange?.({ h: ((next.h % 360) + 360) % 360, s: clamp(next.s), v: clamp(next.v) });
  }

  /** Drag inside an element: `at` gets the pointer as 0..1 across and down. */
  function drag(event: PointerEvent, at: (x: number, y: number) => void): void {
    const el = event.currentTarget as HTMLElement;
    el.setPointerCapture?.(event.pointerId);
    const read = (e: PointerEvent) => {
      const r = el.getBoundingClientRect();
      at(clamp((e.clientX - r.left) / Math.max(1, r.width)), clamp((e.clientY - r.top) / Math.max(1, r.height)));
    };
    read(event);
    const move = (e: PointerEvent) => read(e);
    const up = () => {
      el.removeEventListener('pointermove', move);
      el.removeEventListener('pointerup', up);
      el.removeEventListener('pointercancel', up);
    };
    el.addEventListener('pointermove', move);
    el.addEventListener('pointerup', up);
    el.addEventListener('pointercancel', up);
  }

  function onSquareKey(e: KeyboardEvent): void {
    const step = e.shiftKey ? 0.1 : 0.02;
    const d = { ArrowLeft: [-step, 0], ArrowRight: [step, 0], ArrowUp: [0, step], ArrowDown: [0, -step] }[e.key];
    if (!d) return;
    e.preventDefault();
    emit({ h: hue, s: hsv.s + d[0]!, v: hsv.v + d[1]! });
  }
  function onHueKey(e: KeyboardEvent): void {
    const step = e.shiftKey ? 15 : 2;
    const d = e.key === 'ArrowLeft' || e.key === 'ArrowDown' ? -step : e.key === 'ArrowRight' || e.key === 'ArrowUp' ? step : 0;
    if (!d) return;
    e.preventDefault();
    emit({ h: Math.min(359, Math.max(0, hue + d)), s: hsv.s, v: hsv.v });
  }

  let typed = $state<string | null>(null);
  function commitHex(): void {
    const raw = (typed ?? '').trim().replace(/^#?/, '#');
    typed = null;
    if (/^#[0-9a-f]{6}$/i.test(raw)) emit(hexToHsv(raw.toLowerCase()));
  }
</script>

<Popover.Root {open} onOpenChange={setOpen}>
  <Popover.Trigger class="colorpicker-trigger" aria-label={ariaLabel} aria-haspopup="dialog" {disabled}></Popover.Trigger>
  <Popover.Portal>
    <Popover.Content class="colorpicker" data-keyboard-owner="popover" side="bottom" align="start" sideOffset={6} aria-label={`${ariaLabel} — pick`}>
      <!-- Saturation across, brightness up. -->
      <div
        class="cp-square"
        style="--hue-colour: hsl({hue} 100% 50%)"
        role="slider"
        tabindex="0"
        aria-label="Saturation and brightness"
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={Math.round(hsv.s * 100)}
        aria-valuetext={`Saturation ${Math.round(hsv.s * 100)}%, brightness ${Math.round(hsv.v * 100)}%`}
        onpointerdown={(e) => drag(e, (x, y) => emit({ h: hue, s: x, v: 1 - y }))}
        onkeydown={onSquareKey}
      >
        <span class="cp-thumb" style="left: {hsv.s * 100}%; top: {(1 - hsv.v) * 100}%; background: {hex}"></span>
      </div>
      <div
        class="cp-hue"
        role="slider"
        tabindex="0"
        aria-label="Hue"
        aria-valuemin={0}
        aria-valuemax={359}
        aria-valuenow={Math.round(hue)}
        onpointerdown={(e) => drag(e, (x) => emit({ h: Math.min(359, x * 360), s: hsv.s, v: hsv.v }))}
        onkeydown={onHueKey}
      >
        <span class="cp-thumb" style="left: {(hue / 360) * 100}%; top: 50%; background: hsl({hue} 100% 50%)"></span>
      </div>
      <div class="cp-row">
        <span class="cp-chip" style="background: {hex}" aria-hidden="true"></span>
        <input
          class="cp-hex"
          aria-label="Hex"
          spellcheck="false"
          value={typed ?? hex}
          oninput={(e) => (typed = e.currentTarget.value)}
          onkeydown={(e) => {
            if (e.key === 'Enter') commitHex();
          }}
          onblur={commitHex}
        />
      </div>
    </Popover.Content>
  </Popover.Portal>
</Popover.Root>

<style>
  /* Laid over the caller's well, the size of it: the well is what you see and click. `button.` and
     `:hover` out-rank the app's global button hover fill, which would paint over the colour. */
  :global(button.colorpicker-trigger),
  :global(button.colorpicker-trigger:hover) {
    position: absolute;
    inset: 0;
    width: 100%;
    height: 100%;
    margin: 0;
    padding: 0;
    background: transparent;
    border: 0;
    border-radius: inherit;
    cursor: pointer;
  }
  :global(button.colorpicker-trigger:disabled) {
    cursor: default;
  }
  :global(button.colorpicker-trigger:focus-visible) {
    outline: 2px solid var(--accent);
    outline-offset: 1px;
  }
  :global(.colorpicker) {
    z-index: var(--z-tooltip);
    display: flex;
    flex-direction: column;
    gap: var(--space-2);
    width: 208px;
    padding: var(--space-2);
    background: var(--surface-3);
    border: 1px solid var(--border);
    border-radius: var(--radius-2);
    box-shadow: var(--shadow-3);
  }
  :global(.cp-square) {
    position: relative;
    height: 128px;
    border-radius: var(--radius-1);
    background:
      linear-gradient(to top, #000, transparent),
      linear-gradient(to right, #fff, transparent),
      var(--hue-colour);
    cursor: crosshair;
    touch-action: none;
  }
  :global(.cp-hue) {
    position: relative;
    height: 12px;
    border-radius: 6px;
    background: linear-gradient(to right, #f00, #ff0 17%, #0f0 33%, #0ff 50%, #00f 67%, #f0f 83%, #f00);
    cursor: ew-resize;
    touch-action: none;
  }
  :global(.cp-square:focus-visible),
  :global(.cp-hue:focus-visible) {
    outline: 2px solid var(--accent);
    outline-offset: 2px;
  }
  :global(.cp-thumb) {
    position: absolute;
    width: 12px;
    height: 12px;
    border: 2px solid #fff;
    border-radius: 50%;
    box-shadow: 0 0 0 1px rgb(0 0 0 / 0.5), var(--shadow-1);
    transform: translate(-50%, -50%);
    pointer-events: none;
  }
  :global(.cp-row) {
    display: flex;
    align-items: center;
    gap: var(--space-2);
  }
  :global(.cp-chip) {
    flex: none;
    width: 22px;
    height: 22px;
    border-radius: var(--radius-1);
    box-shadow: inset 0 0 0 1px var(--border);
  }
  :global(.cp-hex) {
    flex: 1;
    min-width: 0;
    height: 26px;
    padding: 0 var(--space-2);
    font-family: var(--font-mono);
    font-size: var(--text-xs);
    color: var(--ink);
    background: var(--surface-inset);
    border: 1px solid var(--border);
    border-radius: var(--radius-1);
  }
  :global(.cp-hex:focus-visible) {
    outline: none;
    border-color: var(--accent);
  }
</style>
