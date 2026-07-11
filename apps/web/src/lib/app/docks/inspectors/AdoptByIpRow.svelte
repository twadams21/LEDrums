<script lang="ts">
  /* Manual adopt-by-IP — a labelled IP input + Adopt, reusing the .action button vocabulary. Lets an
     operator connect to a known controller even when Discover can't see it (still on a different
     subnet, across a router, or simply missed). Its placeholder seeds from the recommended IP so the
     "set the box, then adopt it" flow is one glance. Pure: local draft in, host out via onAdopt. */
  let {
    recommendedIp,
    canEdit = true,
    onAdopt,
  }: {
    /** The recommended controller IP — pre-fills the input's placeholder. */
    recommendedIp?: string;
    /** Editor gate — a viewer sees the field but can't submit. */
    canEdit?: boolean;
    /** Adopt-IP: adopt this host AND copy it into the output settings (one click). */
    onAdopt?: (host: string) => void;
  } = $props();

  let adoptHost = $state('');

  function submitAdopt(): void {
    const h = adoptHost.trim();
    if (h) onAdopt?.(h);
  }
</script>

<div class="adopt-ip">
  <span class="adopt-label">Adopt by IP</span>
  <div class="adopt-row">
    <input
      class="adopt-input"
      type="text"
      inputmode="decimal"
      bind:value={adoptHost}
      placeholder={recommendedIp ?? '192.168.0.50'}
      disabled={!canEdit}
      aria-label="Controller IP to adopt"
      onkeydown={(e) => {
        if (e.key === 'Enter') submitAdopt();
      }}
    />
    <button type="button" class="action" disabled={!canEdit || !adoptHost.trim()} onclick={submitAdopt}>
      Adopt
    </button>
  </div>
</div>

<style>
  .adopt-ip {
    display: flex;
    flex-direction: column;
    gap: var(--space-1);
  }
  .adopt-label {
    font-size: var(--text-2xs);
    font-family: var(--font-mono);
    text-transform: uppercase;
    letter-spacing: var(--tracking-label);
    color: var(--text-faint);
  }
  .adopt-row {
    display: flex;
    gap: var(--space-2);
  }
  .adopt-input {
    flex: 1;
    min-width: 0;
    min-height: 30px;
    padding: var(--space-1) var(--space-2);
    background: var(--surface-inset);
    border: 1px solid var(--border);
    border-radius: var(--radius-2);
    font-family: var(--font-mono);
    font-variant-numeric: tabular-nums;
    font-size: var(--text-sm);
    color: var(--ink);
    transition: border-color var(--dur-120) ease;
  }
  .adopt-input::placeholder {
    color: var(--text-disabled);
  }
  .adopt-input:focus {
    outline: none;
    border-color: var(--border-strong);
  }
  .adopt-input:disabled {
    opacity: 0.5;
    cursor: default;
  }

  /* The Adopt button reuses the app's soft text-button vocabulary (cf. the panel .action). Sized to
     its label here (auto width, wider inline padding) rather than stretching the row. */
  .adopt-row .action {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    flex: none;
    width: auto;
    min-height: 30px;
    padding: var(--space-1) var(--space-3);
    background: var(--surface-inset);
    border: 1px solid var(--border);
    border-radius: var(--radius-2);
    font-size: var(--text-xs);
    color: var(--ink);
    cursor: pointer;
    transition:
      border-color var(--dur-120) ease,
      color var(--dur-120) ease,
      scale var(--dur-120) ease;
  }
  .adopt-row .action:hover:not(:disabled) {
    border-color: var(--border-strong);
  }
  .adopt-row .action:active:not(:disabled) {
    scale: 0.96;
  }
  .adopt-row .action:disabled {
    opacity: 0.5;
    cursor: default;
  }
</style>
