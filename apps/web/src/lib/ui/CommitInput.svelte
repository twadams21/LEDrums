<script lang="ts">
  /* The canonical inline-edit primitive. ONE field that COMMITS ON CHANGE (Enter / blur),
     never per keystroke, and reverts on Escape — used both for transient inline renames
     (section / song / graph / show names) and for persistent Inspector fields (numbers,
     OSC addresses, host/iface). It owns a local `draft`: seeded from `value`, re-synced from
     `value` whenever the field is NOT focused (so a committed store value — or a different
     selection — flows back in), and uncontrolled while you type.

     Modes:
       - type="text"   — inline-rename feel. Autofocuses + selects on mount (override with
                         `autofocus={false}`). A blank or unchanged draft reverts via `onCancel`,
                         unless `allowEmpty` is set (then an emptied field commits '' to clear).
       - type="number" — clamped numeric field. min/max clamp on commit, optional unit `suffix`,
                         native step. Does NOT autofocus by default. An emptied field commits ''
                         so the caller can clear vs ignore; non-finite input is rejected (reverts).

     Exactly ONE of `onCommit(value)` / `onCancel()` fires per edit session. `onCommit` always
     receives a string (a clamped numeric string, or '' when a number/allowEmpty field is cleared).

     Usage (rename):
       <CommitInput value={section.name} ariaLabel="Section name"
         onCommit={(name) => { store.renameSection(id, name); editing = null; }}
         onCancel={() => (editing = null)} />
     Usage (number):
       <CommitInput type="number" min={0} max={127} value={note ?? ''} suffix="px"
         ariaLabel="MIDI note" onCommit={(v) => onNum(v, apply)} /> */
  import { untrack } from 'svelte';
  import { resolveCommit, type CommitInputType } from './commit-input';

  type Props = {
    value: string | number;
    onCommit: (value: string) => void;
    onCancel?: () => void;
    type?: CommitInputType;
    min?: number;
    max?: number;
    step?: number;
    suffix?: string;
    placeholder?: string;
    mono?: boolean;
    disabled?: boolean;
    /** Defaults to true for text (rename feel), false for number (persistent field). */
    autofocus?: boolean;
    /** Text mode: commit '' on clear instead of reverting. Ignored for numbers. */
    allowEmpty?: boolean;
    ariaLabel?: string;
    class?: string;
  };

  let {
    value,
    onCommit,
    onCancel,
    type = 'text',
    min,
    max,
    step,
    suffix,
    placeholder,
    mono = false,
    disabled = false,
    autofocus,
    allowEmpty = false,
    ariaLabel,
    class: klass,
  }: Props = $props();

  const doFocus = $derived(autofocus ?? type === 'text');

  let el: HTMLInputElement;
  let draft = $state(untrack(() => String(value))); // seed once; re-synced below when not editing
  let editing = $state(false); // focused — guards draft re-sync from clobbering live typing
  let done = false; // one callback per edit session; reset on focus

  // Re-seed the draft from `value` whenever the field is not being edited, so a committed
  // store value (or a different Inspector selection) flows back in. While focused, the draft
  // is the user's to own.
  $effect(() => {
    const next = String(value);
    if (!editing) untrack(() => void (draft !== next && (draft = next)));
  });

  $effect(() => {
    if (doFocus && !disabled) {
      el.focus();
      el.select();
    }
  });

  function finish(commit: boolean): void {
    if (done) return;
    done = true;
    const original = String(value);
    if (!commit) {
      draft = original; // Esc → revert
      onCancel?.();
      return;
    }
    const decision = resolveCommit({ draft, value: original, type, min, max, allowEmpty });
    if (decision.action === 'commit') onCommit(decision.value);
    else if (decision.action === 'revert') {
      draft = original;
      onCancel?.();
    } else onCancel?.();
  }

  function onkeydown(e: KeyboardEvent): void {
    if (e.key === 'Enter') {
      e.preventDefault();
      el.blur(); // → onblur → finish(true)
    } else if (e.key === 'Escape') {
      e.preventDefault();
      finish(false);
      el.blur(); // guarded — finish already ran
    }
  }
</script>

<span class={['ci', klass]} class:mono class:disabled>
  <input
    bind:this={el}
    class="ci-input"
    {type}
    {min}
    {max}
    {step}
    {placeholder}
    {disabled}
    value={draft}
    aria-label={ariaLabel}
    oninput={(e) => (draft = e.currentTarget.value)}
    onfocus={() => {
      editing = true;
      done = false;
    }}
    {onkeydown}
    onblur={() => {
      editing = false;
      finish(true);
    }}
  />
  {#if suffix}<span class="ci-suffix">{suffix}</span>{/if}
</span>

<style>
  .ci {
    display: inline-flex;
    align-items: center;
    gap: var(--space-2);
    width: 100%;
    min-width: 0;
    padding: var(--space-1) var(--space-2);
    background: var(--surface-inset);
    border: 1px solid var(--border);
    border-radius: var(--radius-2);
    transition: border-color var(--dur-120) ease;
  }
  .ci:focus-within {
    border-color: var(--accent);
  }
  .ci.disabled {
    opacity: 0.5;
    pointer-events: none;
  }
  .ci-input {
    flex: 1;
    min-width: 0;
    width: 100%;
    padding: 0;
    font: inherit;
    font-size: var(--text-xs);
    color: var(--text);
    background: transparent;
    border: none;
    font-variant-numeric: tabular-nums;
  }
  .ci.mono .ci-input {
    font-family: var(--font-mono);
  }
  .ci-input::placeholder {
    color: var(--text-faint);
  }
  .ci-input:focus {
    outline: none;
  }
  .ci-suffix {
    flex: none;
    font-size: var(--text-2xs);
    font-family: var(--font-mono);
    color: var(--text-faint);
  }
</style>
