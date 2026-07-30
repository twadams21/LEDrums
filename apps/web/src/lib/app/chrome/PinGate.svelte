<script lang="ts">
  /* Room-PIN entry gate (S3 remote access). A blocking overlay shown ONLY when the server
     refused the connection at the admission gate (store.authRequired). It is intentionally NOT
     a dismissable Dialog — an un-authed client has nothing usable behind it, so the only way
     forward is to enter the PIN. Submit → store.submitPin → the client reconnects with the PIN;
     a correct one opens the link and clears the gate, a refusal bumps authFailCount and we show
     the hint for the refusal we actually got.

     TWO refusals, two sentences (INIT-05). A 4401 means the PIN was wrong. A 4429 means the
     peer spent its attempt allowance and the server refused WITHOUT comparing the PIN — during
     that cooldown even the correct PIN comes back refused, so "Incorrect PIN" would be a lie to
     someone holding the right one. The cooldown case counts down and holds Join closed until it
     lapses, because an enabled button that can only fail is worse than an honest wait. */
  import type { TriggerLab } from '../../trigger-lab/store.svelte';
  import Lock from '@lucide/svelte/icons/lock';
  import TimerReset from '@lucide/svelte/icons/timer-reset';

  let { store }: { store: TriggerLab } = $props();

  let pin = $state('');
  // The refusal count captured at our last submit (-1 before any submit). We compare the live
  // count against it to tell "still waiting" from "refused again" without assigning state in an
  // effect: a submit records the count, a later refusal bumps the live count past it. It counts
  // BOTH refusal kinds, so a throttled retry resolves instead of hanging on "Joining…".
  let attemptedAtFail = $state(-1);
  /** Seconds left on a cooldown, ticked locally from the server's number. 0 = not waiting. */
  let cooldownLeft = $state(0);

  const submitted = $derived(attemptedAtFail >= 0);
  /** Waiting on the server's verdict — submitted, and no new refusal since. */
  const pending = $derived(submitted && store.authFailCount === attemptedAtFail);
  /** A wrong-PIN refusal arrived after OUR submit. Gated on the submit because accusing a PIN
      the user has not typed yet — the tab was refused on its stored PIN, or on none — reads as
      a lie about something they did. */
  const showError = $derived(submitted && store.authFailCount > attemptedAtFail && store.authThrottledSeconds === null);
  /** A cooldown, shown as soon as we know about one, submit or not: unlike a wrong PIN it is a
      fact about the CONNECTION rather than about what the user typed, and it is the first thing
      someone landing on the gate needs to know — typing a perfect PIN would still be refused. */
  const throttled = $derived(store.authThrottledSeconds !== null);
  const waiting = $derived(throttled && cooldownLeft > 0);

  // Run the countdown off the server's number. Keyed on authFailCount too, so a SECOND refusal
  // quoting the same wait restarts the clock rather than sitting at whatever is left.
  $effect(() => {
    const seconds = store.authThrottledSeconds;
    void store.authFailCount;
    if (seconds === null || seconds <= 0) {
      cooldownLeft = 0;
      return;
    }
    cooldownLeft = seconds;
    const id = setInterval(() => {
      cooldownLeft = Math.max(0, cooldownLeft - 1);
      if (cooldownLeft === 0) clearInterval(id);
    }, 1000);
    return () => clearInterval(id);
  });

  function submit(e: SubmitEvent): void {
    e.preventDefault();
    const trimmed = pin.trim();
    if (!trimmed || pending || waiting) return;
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
      {#if throttled}
        <p class="cooldown" role="status">
          <TimerReset size={14} aria-hidden="true" />
          {#if cooldownLeft > 0}
            Too many attempts — try again in {cooldownLeft}s.
          {:else}
            Too many attempts — you can try again now.
          {/if}
        </p>
      {:else if showError}
        <p class="error" role="alert">Incorrect PIN — try again.</p>
      {/if}
      <button type="submit" class="join" class:pending disabled={!pin.trim() || pending || waiting}>
        {#if waiting}Waiting {cooldownLeft}s{:else if pending}Joining…{:else}Join{/if}
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
  /* --warn, not --live: a cooldown is a caution to wait out, not a failure to correct. The
     tabular figures stop the countdown jittering the line's width as digits change. */
  .cooldown {
    display: flex;
    align-items: center;
    justify-content: center;
    gap: var(--space-2);
    margin: 0;
    font-size: var(--text-sm);
    font-variant-numeric: tabular-nums;
    color: var(--warn);
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
  /* A disabled primary button must not still LOOK primary. Dimming the accent to 0.5 left the
     "Waiting 28s" state reading as a live CTA against this dark surface — a button inviting a
     click that cannot work. Drop it to the inert surface treatment instead, so "you can't press
     this yet" is legible at a glance rather than inferred from a cursor. */
  .join:disabled {
    color: var(--text-faint);
    background: var(--surface-2);
    border-color: var(--border);
    cursor: not-allowed;
  }
  /* …except while a submit is in flight: that IS the primary action, still running. */
  .join:disabled.pending {
    color: var(--on-accent);
    background: var(--accent);
    border-color: transparent;
    opacity: 0.6;
  }
  .join {
    transition: background-color 120ms ease, color 120ms ease;
  }
  @media (prefers-reduced-motion: reduce) {
    .join {
      transition: none;
    }
  }
</style>
