<script lang="ts">
  /* LEDrums mark — a geometric badge that reads at 16px: a hoop (ring) carrying three lit
     pixels at 120° (drum · hoop · pixel). Phosphor-lime accent on a dark tile, matching the
     Linear/Resend-dark language. Self-contained inline SVG (no external assets); the ring
     is a dimmed accent, the pixels the bright accent, so it sits in the theme via --accent.
     The favicon (`public/favicon.svg`) mirrors this geometry with hardcoded colours. */
  let { size = 20 }: { size?: number } = $props();
</script>

<svg
  class="logo"
  width={size}
  height={size}
  viewBox="0 0 32 32"
  fill="none"
  aria-hidden="true"
  xmlns="http://www.w3.org/2000/svg"
>
  <rect x="1" y="1" width="30" height="30" rx="8" class="tile" />
  <circle cx="16" cy="16" r="9" class="hoop" fill="none" stroke-width="1.8" />
  <circle cx="16" cy="7" r="2.5" class="pixel" />
  <circle cx="23.79" cy="20.5" r="2.5" class="pixel" />
  <circle cx="8.21" cy="20.5" r="2.5" class="pixel" />
</svg>

<style>
  .logo {
    display: block;
    flex: none;
  }
  .tile {
    fill: var(--surface-3, #16171a);
    stroke: var(--border, #2a2b30);
    stroke-width: 1;
  }
  .hoop {
    stroke: color-mix(in oklch, var(--accent) 55%, transparent);
  }
  .pixel {
    fill: var(--accent);
  }
</style>
