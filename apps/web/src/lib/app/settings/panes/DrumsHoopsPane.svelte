<script lang="ts">
  /* STUB (S2) — S4b fills this pane. Registered in SettingsModal now so the S4
     slices only ever touch their own pane file. */
  // Registry passes { store }; stubs ignore it until their S4 slice lands.
  let { store: _store }: { store?: unknown } = $props();
</script>

<div class="stub">
  <h3>Drums &amp; Hoops</h3>
  <p>
    Coming in this initiative: per-hoop pixel counts and direction, identify-on-rig
    flash, and drum transforms (today's Patch-graph drum/hoop inspectors).
  </p>
</div>

<style>
  .stub {
    display: flex;
    flex-direction: column;
    gap: var(--space-2);
  }
  h3 {
    margin: 0;
    font-size: var(--text-sm);
    font-weight: 600;
    color: var(--ink);
  }
  p {
    margin: 0;
    max-width: 52ch;
    font-size: var(--text-xs);
    line-height: 1.5;
    color: var(--text-muted);
    text-wrap: pretty;
  }
</style>
