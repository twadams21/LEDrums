<script lang="ts">
  /* Click-to-copy chip — the design system's one copy affordance. Copies `text`
     (a CSS var name, a repo-relative source path, …) and confirms inline. A
     missing pointer (`text` undefined = stale manifest key) renders as a visible
     ⚠ so drift is caught by eye, never silently. */
  let {
    text,
    label,
    title,
  }: {
    text: string | undefined;
    /** Display override (defaults to `text`). */
    label?: string;
    title?: string;
  } = $props();

  let copied = $state(false);
  let timer: ReturnType<typeof setTimeout> | undefined;

  async function copy(): Promise<void> {
    if (!text) return;
    try {
      await navigator.clipboard.writeText(text);
    } catch {
      // file:// fallback: some engines gate the async clipboard API
      const ta = document.createElement('textarea');
      ta.value = text;
      ta.style.position = 'fixed';
      ta.style.opacity = '0';
      document.body.appendChild(ta);
      ta.select();
      document.execCommand('copy');
      ta.remove();
    }
    copied = true;
    clearTimeout(timer);
    timer = setTimeout(() => (copied = false), 1400);
  }
</script>

{#if text}
  <button class="chip" class:copied onclick={copy} title={title ?? `Copy ${text}`}>
    <span class="txt">{label ?? text}</span>
    <span class="mark" aria-hidden="true">{copied ? '✓' : '⧉'}</span>
    <span class="sr" role="status">{copied ? 'Copied' : ''}</span>
  </button>
{:else}
  <span class="chip miss" title="Stale pointer — file not found in the source manifest">⚠ {label ?? 'missing source'}</span>
{/if}

<style>
  .chip {
    display: inline-flex;
    align-items: center;
    gap: var(--space-1);
    max-width: 100%;
    padding: 2px var(--space-2);
    font-family: var(--font-mono);
    font-size: var(--text-2xs);
    color: var(--text-faint);
    background: var(--surface-inset);
    border: 1px solid var(--border-faint);
    border-radius: var(--radius-1);
    cursor: pointer;
    transition:
      color var(--dur-120) var(--ease-control),
      border-color var(--dur-120) var(--ease-control);
  }
  .chip:hover {
    color: var(--text);
    border-color: var(--border-strong);
  }
  .chip.copied {
    color: var(--accent);
    border-color: var(--accent-dim);
  }
  .txt {
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .mark {
    flex: none;
    opacity: 0.75;
  }
  .miss {
    color: var(--warn);
    border-color: color-mix(in oklch, var(--warn) 40%, transparent);
    cursor: default;
  }
  .sr {
    position: absolute;
    width: 1px;
    height: 1px;
    overflow: hidden;
    clip-path: inset(50%);
  }
</style>
