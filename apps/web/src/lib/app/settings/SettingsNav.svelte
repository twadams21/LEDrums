<script lang="ts">
  /* The Settings sidebar — grouped, colour-coded section list. Each row carries its
     section's icon in that section's hue (the role colour of the thing it edits, from
     `section-tints.css` via `data-settings-section`); the active row fills with a wash of
     the same hue, so the sidebar and the open pane's header read as one identity. Groups
     are contiguous runs of the route order — locked by `sections.test.ts` — so each
     Eyebrow heads its run exactly once. */
  import type { SettingsPane } from '../shell-nav';
  import Eyebrow from '../../ui/Eyebrow.svelte';
  import { SETTINGS_GROUPS, SETTINGS_SECTIONS } from './sections';

  let { active, onSelect }: { active: SettingsPane; onSelect: (id: SettingsPane) => void } = $props();

  const groups = SETTINGS_GROUPS.map((g) => ({ ...g, items: SETTINGS_SECTIONS.filter((s) => s.group === g.id) }));
</script>

<nav class="snav" aria-label="Settings sections">
  {#each groups as g (g.id)}
    <div class="group" role="group" aria-label={g.label}>
      <Eyebrow class="gtitle">{g.label}</Eyebrow>
      {#each g.items as s (s.id)}
        <button
          type="button"
          class="sitem"
          class:on={active === s.id}
          data-settings-section={s.id}
          aria-current={active === s.id ? 'page' : undefined}
          onclick={() => onSelect(s.id)}
        >
          <s.icon size={14} aria-hidden="true" />
          {s.label}
        </button>
      {/each}
    </div>
  {/each}
</nav>

<style>
  .snav {
    display: flex;
    flex-direction: column;
    gap: var(--space-3);
    padding: var(--space-2);
    border-right: 1px solid var(--border-faint);
    background: var(--surface-2);
    overflow-y: auto;
    overscroll-behavior: contain;
  }
  .group {
    display: flex;
    flex-direction: column;
    gap: 2px;
    min-width: 0;
  }
  .group :global(.gtitle) {
    padding: 0 var(--space-3) var(--space-1);
  }
  .sitem {
    display: inline-flex;
    align-items: center;
    gap: 8px;
    padding: 7px var(--space-3);
    background: transparent;
    border: 1px solid transparent;
    border-radius: var(--radius-2);
    font-size: var(--text-sm);
    color: var(--text-muted);
    text-align: left;
    cursor: pointer;
    transition-property: background-color, border-color, color;
    transition-duration: var(--dur-120);
  }
  .sitem :global(svg) {
    flex: none;
    color: var(--sec-tint);
    opacity: 0.72;
    transition-property: opacity;
    transition-duration: var(--dur-120);
  }
  .sitem:hover {
    color: var(--text);
    background: var(--surface-3);
  }
  .sitem:hover :global(svg),
  .sitem.on :global(svg) {
    opacity: 1;
  }
  /* Hueless sections (System) resolve --sec-wash to a plain surface lift. */
  .sitem.on {
    background: var(--sec-wash);
    border-color: var(--sec-edge);
    color: var(--ink);
  }
</style>
