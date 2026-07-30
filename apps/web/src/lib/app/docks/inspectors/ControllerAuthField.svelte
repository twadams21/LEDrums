<script lang="ts">
  /* Admin password (R29) — the one credential field on the controller panel.

     Authenticated controllers need it for every management call. We hold only the server-side
     hash, so the field never shows a stored value: it reads empty and clears after each set. The
     hint is derived from the device's own `authReqd` plus whether we are reaching it — no local
     "did we set one?" flag, because that flag would lie the moment the box is re-flashed.

     Split out of ControllerStatusPanel (INIT-09 S7). */
  import CommitInput from '../../../ui/CommitInput.svelte';

  let {
    authReqd = false,
    reachable = false,
    canEdit = true,
    onSetAuth,
  }: {
    /** The device says it wants a password (`identity.authReqd`). */
    authReqd?: boolean;
    /** We are currently reaching the device — with `authReqd`, that means our password works. */
    reachable?: boolean;
    canEdit?: boolean;
    /** Set the adopted controller's admin password — plaintext, hashed + persisted server-side. */
    onSetAuth?: (password: string) => void;
  } = $props();

  const hint = $derived(
    authReqd
      ? reachable
        ? 'Authenticated — the controller accepted this password.'
        : 'This controller requires an admin password to read its status.'
      : 'Only needed if the controller has an admin password set.',
  );
</script>

<div class="auth" class:needs={authReqd && !reachable}>
  <span class="auth-label">Admin password</span>
  <CommitInput
    type="password"
    value=""
    placeholder="•••••••• · leave blank if none"
    disabled={!canEdit}
    ariaLabel="Controller admin password"
    onCommit={(pw) => onSetAuth?.(pw)}
  />
  <p class="auth-hint">{hint}</p>
</div>

<style>
  /* A quiet config field under the readouts. Reuses the CommitInput primitive; the label + hint sit
     above/below it so the credential reads as deliberate device config, not a status readout.
     `.needs` warms the label when the device demands a password we don't yet have. */
  .auth {
    display: flex;
    flex-direction: column;
    gap: var(--space-1);
    margin-top: var(--space-1);
  }
  .auth-label {
    font-size: var(--text-2xs);
    font-family: var(--font-mono);
    text-transform: uppercase;
    letter-spacing: var(--tracking-label);
    color: var(--text-faint);
  }
  .auth.needs .auth-label {
    color: var(--warn);
  }
  .auth-hint {
    margin: 0;
    font-size: var(--text-2xs);
    color: var(--text-muted);
    line-height: var(--leading-snug);
    text-wrap: pretty;
  }
</style>
