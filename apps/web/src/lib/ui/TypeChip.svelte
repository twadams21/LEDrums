<script lang="ts">
  /* A small typed identity badge — mono, uppercase.

     ONE tint recipe, app-wide (2026-08-14, Trent: chips had "weird colours like the text not
     matching the background"): the fill is a NEUTRAL surface, and the tint appears only in
     the text and the border. Text and background can therefore never disagree — the text
     colour is mixed toward ink over that same neutral, so contrast holds for every hue, and
     an untinted chip is the same shape in the ink ramp rather than a different species.

     `tint` is a CSS colour (usually a role token, e.g. `var(--role-mod)`), passed through as
     `--tint` — the same runtime-tint convention `NodeIconChip` uses. */

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
    border: 1px solid color-mix(in oklch, var(--tint) 28%, var(--border-faint));
    border-radius: var(--radius-1);
    background: var(--surface-inset);
    color: color-mix(in oklch, var(--tint) 55%, var(--text));
    font-family: var(--font-mono);
    font-size: var(--text-2xs);
    font-weight: 600;
    line-height: 1.5;
    letter-spacing: var(--tracking-label);
    text-transform: uppercase;
    white-space: nowrap;
  }
</style>
