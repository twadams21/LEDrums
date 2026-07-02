<script lang="ts">
  /* Colour foundations: canvas elevations, borders, ink ramp (AA ratios from
     scripts/contrast-check.mjs), the locked phosphor-lime accent family, state
     colours, and the signal-flow role colours. Every swatch copies its var. */
  import TokenSwatch from '../TokenSwatch.svelte';
  import CopyChip from '../CopyChip.svelte';

  const surfaces = [
    ['--bg-perform', 'Perform stage backdrop (deepest)'],
    ['--bg', 'App canvas (authoring)'],
    ['--surface', 'Panel base'],
    ['--surface-2', 'Raised control / panel header'],
    ['--surface-3', 'Popover / menu / hover lift'],
    ['--surface-inset', 'Sunken wells (inputs, tracks)'],
  ] as const;

  const borders = [
    ['--border-faint', 'Hairlines, block outlines'],
    ['--border', 'Control borders'],
    ['--border-strong', 'Hover emphasis, wires'],
  ] as const;

  const inkRamp = [
    ['--ink', 'Headings / high emphasis', '16.2:1'],
    ['--text', 'Body', '13.4:1'],
    ['--text-muted', 'Secondary — still AA for body', '8.6:1'],
    ['--text-faint', 'Meta / labels (AA ≥ large)', '5.9:1'],
    ['--text-disabled', 'Disabled', '3.8:1'],
  ] as const;

  const accentFamily = [
    ['--accent', 'Interactive: selection, focus, primary', false],
    ['--accent-bright', 'Hover / focus ring base', false],
    ['--accent-dim', 'Quiet accents, borders', false],
    ['--accent-soft', 'Tinted fills / selected bg', true],
    ['--accent-ring', 'Focus ring', true],
    ['--on-accent', 'Text/icon on an accent fill', false],
  ] as const;

  const states = [
    ['--live', 'LIVE / armed — reads across a room', false],
    ['--live-bright', 'LIVE text on dark', false],
    ['--live-soft', 'LIVE tinted fill', true],
    ['--ok', 'Connected / success', false],
    ['--warn', 'Dry-run / warning', false],
    ['--info', 'Informational', false],
  ] as const;

  const roles = [
    { v: '--role-input', label: 'Input — MIDI / OSC in', glyph: 'input' },
    { v: '--role-content', label: 'Content — generator / media', glyph: 'content' },
    { v: '--role-effect', label: 'Effect — modifier', glyph: 'effect' },
    { v: '--role-layer', label: 'Layer — composite / blend', glyph: 'layer' },
    { v: '--role-output', label: 'Output — to the wire', glyph: 'output' },
    { v: '--role-mod', label: 'Modulation — control → param', glyph: 'mod' },
  ] as const;
</script>

{#snippet glyph(name: string)}
  <svg viewBox="0 0 16 16" width="14" height="14" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
    {#if name === 'input'}
      <path d="M2 8h8" /><path d="M7 5l3 3-3 3" /><path d="M13 3v10" />
    {:else if name === 'content'}
      <circle cx="8" cy="8" r="4.5" /><circle cx="8" cy="8" r="1.2" fill="currentColor" />
    {:else if name === 'effect'}
      <path d="M8 2.5l1.4 3.1L12.5 7 9.4 8.4 8 11.5 6.6 8.4 3.5 7l3.1-1.4z" />
    {:else if name === 'layer'}
      <path d="M8 2.5l5 2.6-5 2.6-5-2.6z" /><path d="M3 8.5l5 2.6 5-2.6" />
    {:else if name === 'output'}
      <path d="M4 11a5 5 0 0 1 8 0" /><path d="M6 11a2.6 2.6 0 0 1 4 0" /><circle cx="8" cy="12" r="0.8" fill="currentColor" />
    {:else if name === 'mod'}
      <path d="M2 8c1.5-4 3-4 4.5 0s3 4 4.5 0 3-4 3 0" />
    {/if}
  </svg>
{/snippet}

<section class="block" id="color">
  <div class="block-head">
    <h2>Colour</h2>
    <p>
      Graphite instrument body — the LED output is the only free-saturated colour on screen.
      OKLCH throughout; ink is AA-verified against <code>--surface</code>
      (<code>apps/web/scripts/contrast-check.mjs</code>). Click any swatch's var to copy it.
    </p>
  </div>

  <div class="subgrid">
    <div class="sub">
      <h3>Canvas — six elevations</h3>
      <div class="list">
        {#each surfaces as [v, label] (v)}<TokenSwatch name={v} {label} />{/each}
      </div>
    </div>

    <div class="sub">
      <h3>Borders</h3>
      <div class="list">
        {#each borders as [v, label] (v)}<TokenSwatch name={v} {label} />{/each}
      </div>
      <h3 class="later">Ink — AA-verified</h3>
      <div class="list">
        {#each inkRamp as [v, label, ratio] (v)}
          <div class="inkrow">
            <span class="ink-sample" style="color: var({v})">{label}</span>
            <span class="ink-meta"><CopyChip text={v} /><span class="ratio">{ratio}</span></span>
          </div>
        {/each}
      </div>
    </div>

    <div class="sub">
      <h3>Accent — phosphor lime (locked)</h3>
      <div class="list">
        {#each accentFamily as [v, label, checker] (v)}
          <TokenSwatch name={v} {label} onCheckerboard={checker} />
        {/each}
        <div class="glowrow">
          <span class="glow-demo" style="box-shadow: var(--accent-glow)"></span>
          <CopyChip text="--accent-glow" label="--accent-glow" />
          <span class="glow-note">selection / focus glow</span>
        </div>
      </div>
      <p class="micro">
        Alternate candidates preview via <code>[data-accent]</code> in
        <code>tokens.css</code> — the product ships lime.
      </p>
    </div>

    <div class="sub">
      <h3>States</h3>
      <div class="list">
        {#each states as [v, label, checker] (v)}
          <TokenSwatch name={v} {label} onCheckerboard={checker} />
        {/each}
        <div class="glowrow">
          <span class="glow-demo live" style="box-shadow: var(--live-glow)"></span>
          <CopyChip text="--live-glow" label="--live-glow" />
          <span class="glow-note">LIVE glow</span>
        </div>
      </div>
    </div>

    <div class="sub sub-wide">
      <h3>Signal-flow roles — functional colour, icon + label always</h3>
      <div class="role-grid">
        {#each roles as r (r.v)}
          <div class="rolerow">
            <span class="role" style="--rc: var({r.v})">
              <span class="role-ic">{@render glyph(r.glyph)}</span>
              {r.label.split(' — ')[0]}
            </span>
            <TokenSwatch name={r.v} label={r.label.split(' — ')[1]} />
          </div>
        {/each}
      </div>
      <div class="flow" aria-hidden="true">
        <span class="fn" style="--rc: var(--role-input)">Input</span><i></i>
        <span class="fn" style="--rc: var(--role-content)">Content</span><i></i>
        <span class="fn" style="--rc: var(--role-effect)">Effect</span><i></i>
        <span class="fn" style="--rc: var(--role-layer)">Layer</span><i></i>
        <span class="fn" style="--rc: var(--role-output)">Output</span>
      </div>
      <p class="micro">
        Role colour is never decoration: it always rides an icon + label pair (node chips,
        palette buttons, flow diagrams). <code>--reactive-tint</code>/<code>--reactive-amount</code>
        are the opt-in live-show tint hooks (default: off).
      </p>
    </div>
  </div>
</section>

<style>
  .subgrid {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(300px, 1fr));
    gap: var(--space-5) var(--space-6);
  }
  .sub {
    min-width: 0;
  }
  .sub-wide {
    grid-column: 1 / -1;
  }
  h3 {
    font-size: var(--text-sm);
    color: var(--text);
    margin-bottom: var(--space-3);
  }
  .later {
    margin-top: var(--space-4);
  }
  .list {
    display: flex;
    flex-direction: column;
    gap: var(--space-2);
  }
  .inkrow {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: var(--space-3);
    padding-bottom: var(--space-2);
    border-bottom: 1px solid var(--border-faint);
  }
  .ink-sample {
    font-size: var(--text-md);
    min-width: 0;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }
  .ink-meta {
    display: inline-flex;
    align-items: center;
    gap: var(--space-2);
    flex: none;
  }
  .ratio {
    font-family: var(--font-mono);
    font-size: var(--text-2xs);
    color: var(--ok);
  }
  .glowrow {
    display: flex;
    align-items: center;
    gap: var(--space-3);
    padding: var(--space-2) 0;
  }
  .glow-demo {
    flex: none;
    width: 34px;
    height: 24px;
    border-radius: var(--radius-2);
    background: var(--surface-2);
  }
  .glow-demo.live {
    background: var(--live-soft);
  }
  .glow-note {
    font-size: var(--text-2xs);
    color: var(--text-faint);
  }
  .micro {
    margin-top: var(--space-3);
    font-size: var(--text-xs);
    color: var(--text-faint);
  }
  .role-grid {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(280px, 1fr));
    gap: var(--space-3) var(--space-5);
  }
  .rolerow {
    display: flex;
    flex-direction: column;
    gap: var(--space-2);
  }
  .role {
    display: inline-flex;
    align-items: center;
    gap: var(--space-2);
    width: fit-content;
    font-size: var(--text-xs);
    font-weight: 500;
    color: var(--rc);
    padding: var(--space-1) var(--space-3) var(--space-1) var(--space-2);
    background: color-mix(in oklch, var(--rc) 14%, transparent);
    border: 1px solid color-mix(in oklch, var(--rc) 40%, transparent);
    border-radius: var(--radius-pill);
  }
  .role-ic {
    display: inline-flex;
  }
  .flow {
    display: flex;
    align-items: center;
    gap: var(--space-1);
    margin-top: var(--space-4);
    flex-wrap: wrap;
  }
  .fn {
    font-size: var(--text-2xs);
    font-family: var(--font-mono);
    text-transform: uppercase;
    letter-spacing: var(--tracking-label);
    color: var(--rc);
  }
  .flow i {
    flex: 0 0 18px;
    height: 1px;
    background: linear-gradient(90deg, var(--border-strong), var(--border-faint));
  }
</style>
