<script lang="ts">
  /* Folds every edit made while focus is inside `children` into one undo step. For controls
     that publish continuously without a pointer bracket of their own — the native colour
     picker fires `input` on every hue it passes through, and one pick must be one undo.
     The bracket opens on focus-in and closes on focus-out, and exactly once on destroy, so a
     control removed while focused can never leave undo folding everything after it. */
  import type { Snippet } from 'svelte';

  interface Props {
    onGestureStart: () => void;
    onGestureEnd: () => void;
    children: Snippet;
  }

  let { onGestureStart, onGestureEnd, children }: Props = $props();

  let open = false;

  function start(): void {
    if (open) return;
    open = true;
    onGestureStart();
  }
  function end(e?: FocusEvent): void {
    if (!open) return;
    // Focus moving between controls inside the scope is still the same gesture.
    const to = e?.relatedTarget;
    if (e && to instanceof Node && (e.currentTarget as HTMLElement).contains(to)) return;
    open = false;
    onGestureEnd();
  }

  $effect(() => () => end());
</script>

<span class="scope" onfocusin={start} onfocusout={end}>{@render children()}</span>

<style>
  .scope {
    display: contents;
  }
</style>
