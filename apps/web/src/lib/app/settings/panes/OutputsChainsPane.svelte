<script lang="ts">
  /* STUB (S2) — S4c fills this pane. Registered in SettingsModal now so the S4
     slices only ever touch their own pane file. */
  // Registry passes { store }; stubs ignore it until their S4 slice lands.
  let { store: _store }: { store?: unknown } = $props();
</script>

<div class="stub">
  <h3>Outputs &amp; Chains</h3>
  <p>
    Coming in this initiative: each physical output's ordered hoop chain (with an
    unassigned-hoops pool), start universe, and RGB order (today's Patch-graph
    wiring + output inspector).
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
