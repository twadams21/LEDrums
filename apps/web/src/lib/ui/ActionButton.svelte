<script lang="ts">
  /* The app's soft text-button vocabulary — a 30px inset button with a scale-on-press treatment,
     written out by hand in ControllerStatusPanel (eleven times), AdoptByIpRow, PatchHoopInspector
     and ShareInfo. This component owns the control; `.actions`-style flex rows stay with the
     caller, because that is layout, not the button.

     Distinct from `lib/ui/IconButton` (icon-only, square) and from app.css's base `<button>`
     vocabulary (primary / ghost / danger) — this is the quiet inset action inside a panel.

     THE TWO FITS ARE A REAL DELTA, not a preference. ControllerStatusPanel's buttons share a row
     and stretch to fill it (`flex: 1`, a 6px icon gap, tighter inline padding); AdoptByIpRow's
     Adopt sits beside an input and is sized to its label (`flex: none`, auto width, wider inline
     padding, no gap). Everything else is byte-identical between the two and lives here once. */
  import type { Snippet } from 'svelte';

  let {
    onclick,
    disabled = false,
    fit = 'stretch',
    wide = false,
    pressed,
    scanning = false,
    tone = 'plain',
    children,
  }: {
    onclick?: () => void;
    disabled?: boolean;
    /** `stretch` (default) shares a row with its siblings; `label` is sized to its own text. */
    fit?: 'stretch' | 'label';
    /** Full-width block button — overrides `fit`'s sizing for a row of one. */
    wide?: boolean;
    /** Lit "this is the one currently running" state (warn family). Also sets `aria-pressed`,
        so leave it undefined on buttons that are not toggles rather than passing `false`. */
    pressed?: boolean;
    /** Spin the caller's icon — the in-flight affordance for Discover. */
    scanning?: boolean;
    /** `discover` tints the control with the accent, marking it as the primary way forward. */
    tone?: 'plain' | 'discover';
    children: Snippet;
  } = $props();
</script>

<button
  type="button"
  class="action {fit}"
  class:wide
  class:discover={tone === 'discover'}
  class:scanning
  class:on={pressed}
  aria-pressed={pressed}
  {disabled}
  {onclick}
>
  {@render children()}
</button>

<style>
  .action {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    min-height: 30px;
    background: var(--surface-inset);
    border: 1px solid var(--border);
    border-radius: var(--radius-2);
    font-size: var(--text-xs);
    color: var(--ink);
    cursor: pointer;
    transition:
      border-color var(--dur-120) ease,
      color var(--dur-120) ease,
      scale var(--dur-120) ease;
  }
  /* Sharing a row: grow to fill it, with a gap for the leading icon. */
  .action.stretch {
    gap: 6px;
    flex: 1;
    padding: var(--space-1) var(--space-2);
  }
  /* Sized to its label: no growth, and wider inline padding so the text isn't cramped. */
  .action.label {
    flex: none;
    width: auto;
    padding: var(--space-1) var(--space-3);
  }
  /* The icon arrives through the caller's snippet, so a scoped selector would never match it. */
  .action :global(svg) {
    flex: none;
    opacity: 0.8;
  }
  .action:hover:not(:disabled) {
    border-color: var(--border-strong);
  }
  .action:active:not(:disabled) {
    scale: 0.96;
  }
  .action:disabled {
    opacity: 0.5;
    cursor: default;
  }
  .action.wide {
    width: 100%;
    flex: none;
  }
  .action.discover {
    color: var(--accent);
    border-color: color-mix(in oklch, var(--accent) 40%, var(--border));
  }
  .action.discover:hover:not(:disabled) {
    border-color: color-mix(in oklch, var(--accent) 60%, transparent);
  }
  .action.scanning :global(svg) {
    animation: scan-spin 1s linear infinite;
  }
  /* An action currently driving the takeover (cycle / fade) reads as "on" in the warn family, so the
     running pattern is obvious among its siblings. */
  .action.on {
    color: var(--warn);
    border-color: color-mix(in oklch, var(--warn) 55%, transparent);
    background: color-mix(in oklch, var(--warn) 14%, var(--surface-inset));
  }
  /* Svelte renames keyframes per component, so this cannot be shared with the caller's copy without
     a `-global-` animation name. ControllerStatusPanel keeps its own for the `.scanning-row` hint;
     three duplicated lines are cheaper than a globally-named animation. */
  @keyframes scan-spin {
    to {
      transform: rotate(360deg);
    }
  }
</style>
