<script lang="ts">
  /* A small typed identity badge — mono, uppercase, tinted border + text over a whisper of
     its own colour. The chip is where an item's colour identity lives: tinting a whole row
     turns a dense list into a paint chart, while a chip lets the eye group rows by kind at a
     glance and leaves the text at full contrast.

     `tint` is a CSS colour (usually a role token, e.g. `var(--role-mod)`), passed through as
     `--tint` — the same runtime-tint convention `NodeIconChip` uses. Untinted chips fall back
     to the ink ramp, which is the right treatment for a neutral label. */

  let { label, tint, title }: { label: string; tint?: string; title?: string } = $props();
</script>

<span class="tchip" style={tint ? `--tint:${tint}` : undefined} {title}>{label}</span>

<style>
  .tchip {
    --tint: var(--text-faint);
    display: inline-flex;
    align-items: center;
    flex: none;
    padding: 0 5px;
    border: 1px solid color-mix(in oklch, var(--tint) 32%, transparent);
    border-radius: var(--radius-1);
    background: color-mix(in oklch, var(--tint) 10%, transparent);
    color: color-mix(in oklch, var(--tint) 70%, var(--text));
    font-family: var(--font-mono);
    font-size: var(--text-2xs);
    font-weight: 600;
    line-height: 1.5;
    letter-spacing: var(--tracking-label);
    text-transform: uppercase;
    white-space: nowrap;
  }
</style>
