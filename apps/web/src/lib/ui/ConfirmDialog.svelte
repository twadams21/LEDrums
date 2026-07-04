<script lang="ts">
  /* Small confirmation modal — a titled prompt with a Cancel + a confirm button (danger
     styling for destructive verbs). Built on the shared Dialog primitive so it portals,
     traps focus, and closes on Esc / outside-click. Caller drives `open`; `onConfirm`
     fires on the confirm button, `onClose` on any dismissal. */
  import Dialog from './Dialog.svelte';

  let {
    open = $bindable(false),
    title,
    message,
    confirmLabel = 'Confirm',
    cancelLabel = 'Cancel',
    danger = false,
    onConfirm,
    onClose,
  }: {
    open?: boolean;
    title: string;
    message?: string;
    confirmLabel?: string;
    cancelLabel?: string;
    danger?: boolean;
    onConfirm: () => void;
    onClose?: () => void;
  } = $props();

  function close(): void {
    open = false;
    onClose?.();
  }
  function confirm(): void {
    onConfirm();
    close();
  }
</script>

<Dialog {open} {title} onClose={close} class="confirm-dialog">
  <div class="cd-body">
    <h2 class="cd-title">{title}</h2>
    {#if message}<p class="cd-msg">{message}</p>{/if}
    <div class="cd-actions">
      <button type="button" class="cd-cancel" onclick={close}>{cancelLabel}</button>
      <button type="button" class:danger onclick={confirm}>{confirmLabel}</button>
    </div>
  </div>
</Dialog>

<style>
  .cd-body {
    display: flex;
    flex-direction: column;
    gap: var(--space-3);
    padding: var(--space-4);
    min-width: 280px;
    max-width: 380px;
  }
  .cd-title {
    margin: 0;
    font-size: var(--text-sm);
    font-weight: 600;
    color: var(--ink);
  }
  .cd-msg {
    margin: 0;
    font-size: var(--text-xs);
    color: var(--text-muted);
    line-height: var(--leading-normal);
    text-wrap: pretty;
  }
  .cd-actions {
    display: flex;
    justify-content: flex-end;
    gap: var(--space-2);
  }
  .cd-actions button {
    padding: var(--space-1) var(--space-3);
    font-size: var(--text-xs);
  }
  .cd-cancel {
    background: transparent;
    border: 1px solid var(--border);
    color: var(--text-muted);
    border-radius: var(--radius-2);
  }
  .cd-cancel:hover {
    border-color: var(--border-strong);
    color: var(--ink);
  }
</style>
