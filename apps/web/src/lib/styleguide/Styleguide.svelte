<script lang="ts">
  /* LEDrums design system — the living styleguide AND the single-file artifact.
     One source: the `/?style` dev route mounts this component, and `pnpm design-system`
     renders it (with the real lib/ui + lib/app components) into docs/design-system.html.
     Pure presentational — no store, no WS. Sections live in ./sections; the
     click-to-copy source pointers resolve through the build-time manifest
     (scripts/vite-plugin-source-manifest.mjs). */
  import SectionColor from './sections/SectionColor.svelte';
  import SectionType from './sections/SectionType.svelte';
  import SectionSpaceShape from './sections/SectionSpaceShape.svelte';
  import SectionMotion from './sections/SectionMotion.svelte';
  import SectionPrimitives from './sections/SectionPrimitives.svelte';
  import SectionComposites from './sections/SectionComposites.svelte';
  import SectionGraph from './sections/SectionGraph.svelte';
  import SectionInteraction from './sections/SectionInteraction.svelte';
  import CopyChip from './CopyChip.svelte';
  import { srcPath } from './source-pointer';

  const toc = [
    ['#color', 'Colour'],
    ['#type', 'Type'],
    ['#space', 'Space · shape'],
    ['#motion', 'Motion'],
    ['#primitives', 'Primitives'],
    ['#composites', 'Composites'],
    ['#graph', 'Graph'],
    ['#interaction', 'Interaction'],
  ] as const;
</script>

<div class="sg">
  <header class="sg-top">
    <div class="brand">
      <span class="mark" aria-hidden="true"></span>
      <div>
        <h1>LEDrums — design system</h1>
        <p>Graphite instrument body · the rig is the colour · Geist + Geist&nbsp;Mono</p>
      </div>
    </div>
    <div class="top-meta">
      <CopyChip text={srcPath('styles/tokens')} label="tokens.css" title="Copy the tokens source path" />
      <span class="tag">generated · pnpm design-system</span>
    </div>
  </header>

  <nav class="toc" aria-label="Sections">
    {#each toc as [href, label] (href)}
      <a {href}>{label}</a>
    {/each}
  </nav>

  <p class="howto">
    Compose UI from what's below — every demo is the shipped component, and the
    <span class="chip-eg">⧉</span> chips copy the token var or the component's
    repo-relative source path. Building something new? Add it to <code>lib/ui</code>,
    demo it here, and regenerate this file in the same change.
  </p>

  <SectionColor />
  <SectionType />
  <SectionSpaceShape />
  <SectionMotion />
  <SectionPrimitives />
  <SectionComposites />
  <SectionGraph />
  <SectionInteraction />

  <footer class="sg-foot">
    <span>LEDrums · design context in <code>PRODUCT.md</code> · tokens in <code>apps/web/src/styles/tokens.css</code></span>
    <span>regenerate: <code>pnpm design-system</code> · live route: <code>/?style</code></span>
  </footer>
</div>

<style>
  /* styleguide owns the whole page; let the document scroll naturally */
  :global(html),
  :global(body) {
    overflow: auto;
    height: auto;
    scroll-behavior: smooth;
  }
  @media (prefers-reduced-motion: reduce) {
    :global(html),
    :global(body) {
      scroll-behavior: auto;
    }
  }
  .sg {
    min-height: 100vh;
    padding: var(--space-6) clamp(var(--space-5), 5vw, var(--space-8)) var(--space-8);
    background:
      radial-gradient(120% 80% at 100% 0%, oklch(0.2 0.03 300 / 0.18), transparent 60%),
      var(--bg);
    display: flex;
    flex-direction: column;
    gap: var(--space-6);
  }

  .sg-top {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: var(--space-4);
    flex-wrap: wrap;
    padding-bottom: var(--space-4);
    border-bottom: 1px solid var(--border-faint);
  }
  .brand {
    display: flex;
    align-items: center;
    gap: var(--space-3);
  }
  .mark {
    width: 30px;
    height: 30px;
    border-radius: var(--radius-2);
    background:
      conic-gradient(from 210deg, var(--role-input), var(--role-content), var(--role-effect), var(--role-layer), var(--role-output), var(--role-input));
    box-shadow: var(--shadow-1);
  }
  .sg-top h1 {
    font-size: var(--text-xl);
    color: var(--ink);
  }
  .sg-top p {
    margin: 2px 0 0;
    font-size: var(--text-sm);
    color: var(--text-muted);
  }
  .top-meta {
    display: inline-flex;
    align-items: center;
    gap: var(--space-2);
  }
  .tag {
    font-family: var(--font-mono);
    font-size: var(--text-2xs);
    text-transform: uppercase;
    letter-spacing: var(--tracking-label);
    color: var(--text-faint);
    padding: var(--space-1) var(--space-2);
    border: 1px solid var(--border-faint);
    border-radius: var(--radius-pill);
    white-space: nowrap;
  }

  .toc {
    position: sticky;
    top: 0;
    z-index: var(--z-sticky);
    display: flex;
    flex-wrap: wrap;
    gap: var(--space-1);
    padding: var(--space-2) 0;
    margin: calc(-1 * var(--space-3)) 0;
    background: color-mix(in oklch, var(--bg) 88%, transparent);
    backdrop-filter: blur(6px);
  }
  .toc a {
    font-size: var(--text-xs);
    color: var(--text-muted);
    text-decoration: none;
    padding: var(--space-1) var(--space-3);
    border: 1px solid transparent;
    border-radius: var(--radius-pill);
    transition:
      color var(--dur-120) var(--ease-control),
      border-color var(--dur-120) var(--ease-control);
  }
  .toc a:hover {
    color: var(--ink);
    border-color: var(--border);
  }
  .toc a:focus-visible {
    outline: 2px solid var(--accent-ring);
    outline-offset: 1px;
  }

  .howto {
    font-size: var(--text-sm);
    color: var(--text-muted);
    max-width: 72ch;
    line-height: var(--leading-normal);
  }
  .howto code {
    font-family: var(--font-mono);
    font-size: var(--text-xs);
    color: var(--text-faint);
  }
  .chip-eg {
    color: var(--text-faint);
  }

  /* ---- shared section shell (used by every ./sections component) ------------- */
  .sg :global(.block) {
    background: var(--surface);
    border: 1px solid var(--border-faint);
    border-radius: var(--radius-4);
    padding: var(--space-5);
    scroll-margin-top: 48px;
  }
  .sg :global(.block-head h2) {
    font-size: var(--text-md);
    color: var(--ink);
  }
  .sg :global(.block-head p) {
    margin: var(--space-1) 0 var(--space-4);
    font-size: var(--text-sm);
    color: var(--text-muted);
    max-width: 88ch;
  }
  .sg :global(.block-head code),
  .sg :global(code) {
    font-family: var(--font-mono);
    font-size: var(--text-2xs);
    color: var(--text-faint);
  }

  .sg-foot {
    display: flex;
    align-items: baseline;
    justify-content: space-between;
    gap: var(--space-4);
    flex-wrap: wrap;
    padding-top: var(--space-4);
    border-top: 1px solid var(--border-faint);
    font-size: var(--text-xs);
    color: var(--text-faint);
  }
</style>
