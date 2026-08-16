<script lang="ts">
  /* A pane's title block, drawn from the same registry row as its sidebar entry — the
     section's icon in a wash of its hue, its label, and a mono sub-line. Every pane opens
     with one, so arriving from the sidebar lands on the same icon and colour. */
  import type { SettingsPane } from '../shell-nav';
  import { settingsSection } from './sections';

  let { id }: { id: SettingsPane } = $props();

  const sec = $derived(settingsSection(id));
</script>

<header class="phead" data-settings-section={id}>
  <span class="ic"><sec.icon size={16} aria-hidden="true" /></span>
  <span class="titles">
    <h3>{sec.label}</h3>
    <span class="sub">{sec.sub}</span>
  </span>
</header>

<style>
  .phead {
    display: flex;
    align-items: center;
    gap: var(--space-2);
    padding-bottom: var(--space-2);
    border-bottom: 1px solid var(--sec-edge);
    min-width: 0;
  }
  .ic {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    flex: none;
    width: 26px;
    height: 26px;
    border-radius: var(--radius-2);
    color: var(--sec-tint);
    background: var(--sec-wash);
  }
  .titles {
    min-width: 0;
  }
  h3 {
    margin: 0;
    font-size: var(--text-sm);
    font-weight: 600;
    color: var(--ink);
  }
  .sub {
    display: block;
    font-size: var(--text-2xs);
    font-family: var(--font-mono);
    color: var(--text-faint);
  }
</style>
