<script lang="ts">
  /* Room-PIN entry gate (S3 remote access). A blocking overlay shown ONLY when the server
     refused the connection for a wrong/absent PIN (store.authRequired). It is intentionally NOT
     a dismissable Dialog — an un-authed client has nothing usable behind it, so the only way
     forward is to enter the PIN. Submit → store.submitPin → the client reconnects with the PIN;
     a correct one opens the link and clears the gate, a wrong one bumps authFailCount and we
     show the "incorrect" hint. */
  import type { TriggerLab } from '../../trigger-lab/store.svelte';
  import Lock from '@lucide/svelte/icons/lock';

  let { store }: { store: TriggerLab } = $props();

  let pin = $state('');
  // The refusal count captured at our last submit (-1 before any submit). We compare the live
  // count against it to tell "still waiting" from "refused again" without assigning state in an
  // effect: a submit records the count, a later refusal bumps the live count past it.
  let attemptedAtFail = $state(-1);

  const submitted = $derived(attemptedAtFail >= 0);
  /** Waiting on the server's verdict — submitted, and no new refusal since. */
  const pending = $derived(submitted && store.authFailCount === attemptedAtFail);
  /** A refusal arrived after our submit → the PIN was wrong. */
  const showError = $derived(submitted && store.authFailCount > attemptedAtFail);

  function submit(e: SubmitEvent): void {
    e.preventDefault();
    const trimmed = pin.trim();
    if (!trimmed || pending) return;
    attemptedAtFail = store.authFailCount;
    store.submitPin(trimmed);
  }
</script>

{#if store.authRequired}
  <div class="pin-gate" role="dialog" aria-modal="true" aria-label="Enter room PIN">
    <form class="card" onsubmit={submit}>
      <span class="icon" aria-hidden="true"><Lock size={22} /></span>
      <h1>Enter room PIN</h1>
      <p class="sub">This LEDrums room is protected. Ask the host for the PIN to join.</p>
      <input
        class="pin-input"
        type="text"
        inputmode="numeric"
        autocomplete="off"
        aria-label="Room PIN"
        bind:value={pin}
        placeholder="• • • •"
      />
      {#if showError}
        <p class="error" role="alert">Incorrect PIN — try again.</p>
      {/if}
      <button type="submit" class="join" disabled={!pin.trim() || pending}>
        {pending ? 'Joining…' : 'Join'}
      </button>
    </form>
  </div>
{/if}

<style>
  .pin-gate {
    position: fixed;
    inset: 0;
    z-index: var(--z-modal);
    display: grid;
    place-items: center;
    background: var(--overlay);
    backdrop-filter: blur(3px);
  }
  .card {
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: var(--space-3);
    width: min(360px, calc(100vw - var(--space-6)));
    padding: var(--space-6) var(--space-5);
    background: var(--surface);
    border: 1px solid var(--border);
    border-radius: var(--radius-3);
    box-shadow: var(--shadow-3);
    text-align: center;
  }
  .icon {
    display: grid;
    place-items: center;
    width: 44px;
    height: 44px;
    border-radius: var(--radius-2);
    background: var(--surface-2);
    color: var(--accent);
  }
  h1 {
    margin: 0;
    font-size: var(--text-md);
    font-weight: 700;
    color: var(--ink);
  }
  .sub {
    margin: 0;
    font-size: var(--text-sm);
    color: var(--text-faint);
    line-height: 1.4;
  }
  .pin-input {
    width: 100%;
    padding: var(--space-2) var(--space-3);
    font-size: var(--text-lg);
    font-variant-numeric: tabular-nums;
    letter-spacing: 0.2em;
    text-align: center;
    color: var(--ink);
    background: var(--surface-2);
    border: 1px solid var(--border);
    border-radius: var(--radius-2);
  }
  .pin-input:focus-visible {
    outline: none;
    border-color: var(--accent);
  }
  .error {
    margin: 0;
    font-size: var(--text-sm);
    color: var(--live);
  }
  .join {
    width: 100%;
    padding: var(--space-2) var(--space-3);
    font-size: var(--text-sm);
    font-weight: 600;
    color: var(--on-accent);
    background: var(--accent);
    border: 1px solid transparent;
    border-radius: var(--radius-2);
    cursor: pointer;
  }
  .join:disabled {
    opacity: 0.5;
    cursor: not-allowed;
  }
</style>
