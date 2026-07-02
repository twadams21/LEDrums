<script lang="ts">
  /* Typography: Geist (sans) + Geist Mono, the fixed ~1.2 type scale, leading and
     tracking tokens. Both fonts are self-hosted (@fontsource-variable). */
  import CopyChip from '../CopyChip.svelte';

  const scale = [
    ['--text-3xl', 'View header — product ceiling', 28],
    ['--text-2xl', 'Section', 23],
    ['--text-xl', 'Subsection', 19],
    ['--text-lg', 'Panel title', 16],
    ['--text-md', 'Emphasis body', 14],
    ['--text-base', 'Body / app default', 13],
    ['--text-sm', 'Controls', 12],
    ['--text-xs', 'Labels', 11],
    ['--text-2xs', 'Dense meta', 10],
  ] as const;

  const supporting = [
    ['--font-sans', 'Geist Variable — UI'],
    ['--font-mono', 'Geist Mono Variable — readouts, values, paths'],
    ['--leading-snug', 'Headings / dense rows (1.35)'],
    ['--leading-normal', 'Body (1.5)'],
    ['--tracking-label', 'Small-caps labels (+0.04em)'],
    ['--tracking-tight', 'Display sizes (−0.011em)'],
  ] as const;
</script>

<section class="block" id="type">
  <div class="block-head">
    <h2>Type — Geist + Geist Mono</h2>
    <p>
      Fixed scale, ~1.2 ratio, 13px body. Anything numeric or machine-flavoured (BPM, bars, IPs,
      pixel counts, source paths) is mono with <code>tabular-nums</code>.
    </p>
  </div>

  <div class="cols2">
    <div class="type-list">
      {#each scale as [v, label, px] (v)}
        <div class="type-row">
          <span class="type-sample" style="font-size: var({v})">Composition</span>
          <span class="type-meta"><CopyChip text={v} /> {label} · {px}px</span>
        </div>
      {/each}
    </div>

    <div>
      <div class="mono-sample">
        <span class="ml">Geist Mono — readouts</span>
        <code class="tabular">128.0 BPM · bar 09.3 · 192.168.1.50 · #FF3B3B · 304px</code>
      </div>
      <div class="support-list">
        {#each supporting as [v, label] (v)}
          <div class="support-row">
            <CopyChip text={v} />
            <span class="support-label">{label}</span>
          </div>
        {/each}
      </div>
      <div class="label-demo">
        <span class="eyebrow-demo">Small-caps label pattern</span>
        <p class="micro">
          uppercase · <code>--text-2xs</code>/<code>--text-xs</code> ·
          <code>--tracking-label</code> · <code>--text-faint</code> — see
          <code>lib/ui/Eyebrow</code>.
        </p>
      </div>
    </div>
  </div>
</section>

<style>
  .cols2 {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(320px, 1fr));
    gap: var(--space-6);
  }
  .type-list {
    display: flex;
    flex-direction: column;
    gap: var(--space-3);
  }
  .type-row {
    display: flex;
    align-items: baseline;
    justify-content: space-between;
    gap: var(--space-4);
  }
  .type-sample {
    color: var(--ink);
    letter-spacing: var(--tracking-tight);
    line-height: 1;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }
  .type-meta {
    display: inline-flex;
    align-items: center;
    gap: var(--space-2);
    font-size: var(--text-2xs);
    color: var(--text-faint);
    white-space: nowrap;
    flex: none;
  }
  .mono-sample {
    display: flex;
    flex-direction: column;
    gap: var(--space-1);
    padding-bottom: var(--space-3);
    border-bottom: 1px solid var(--border-faint);
  }
  .ml {
    font-size: var(--text-xs);
    color: var(--text-muted);
  }
  .mono-sample code {
    font-family: var(--font-mono);
    font-size: var(--text-sm);
    color: var(--text);
  }
  .tabular {
    font-variant-numeric: tabular-nums;
  }
  .support-list {
    display: flex;
    flex-direction: column;
    gap: var(--space-2);
    margin-top: var(--space-3);
  }
  .support-row {
    display: flex;
    align-items: center;
    gap: var(--space-2);
  }
  .support-label {
    font-size: var(--text-xs);
    color: var(--text-muted);
  }
  .label-demo {
    margin-top: var(--space-4);
    padding-top: var(--space-3);
    border-top: 1px solid var(--border-faint);
  }
  .eyebrow-demo {
    font-size: var(--text-2xs);
    text-transform: uppercase;
    letter-spacing: var(--tracking-label);
    color: var(--text-faint);
  }
  .micro {
    margin-top: var(--space-1);
    font-size: var(--text-xs);
    color: var(--text-faint);
  }
</style>
