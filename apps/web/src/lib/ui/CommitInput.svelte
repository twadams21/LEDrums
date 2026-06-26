<script lang="ts">
  /* Inline commit-on-Enter / commit-on-blur text editor, for in-place renames (section /
     song / graph / show names). It owns a local draft seeded from `value`; commits the
     TRIMMED draft on Enter or blur, and reverts on Escape. Exactly ONE of `onCommit` /
     `onCancel` fires per edit session: `onCommit(value)` when the trimmed draft is non-empty
     AND changed, otherwise `onCancel()` (Escape, blank, or unchanged). It typically appears
     when you enter edit mode, so it autofocuses + selects on mount by default (override with
     `autofocus={false}`). Styled on the same input tokens as TextField/SearchField.

     Usage:
       <CommitInput value={section.name} ariaLabel="Section name"
         onCommit={(name) => { store.renameSection(id, name); editing = null; }}
         onCancel={() => (editing = null)} /> */
  import { untrack } from 'svelte';

  type Props = {
    value: string;
    onCommit: (value: string) => void;
    onCancel?: () => void;
    placeholder?: string;
    ariaLabel?: string;
    autofocus?: boolean;
    class?: string;
  };

  let { value, onCommit, onCancel, placeholder, ariaLabel, autofocus = true, class: klass }: Props = $props();

  let draft = $state(untrack(() => value)); // seed once from the prop; the draft is uncontrolled after
  let el: HTMLInputElement;
  let done = false; // guard so Enter→blur (and Escape→blur) fire a callback exactly once

  $effect(() => {
    if (autofocus) {
      el.focus();
      el.select();
    }
  });

  function finish(commit: boolean): void {
    if (done) return;
    done = true;
    const trimmed = draft.trim();
    if (commit && trimmed && trimmed !== value) onCommit(trimmed);
    else onCancel?.();
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

<input
  bind:this={el}
  class={['ci', klass]}
  type="text"
  bind:value={draft}
  {placeholder}
  aria-label={ariaLabel}
  {onkeydown}
  onblur={() => finish(true)}
/>

<style>
  .ci {
    width: 100%;
    min-width: 0;
    padding: 6px 8px;
    font: inherit;
    font-size: var(--text-xs);
    color: var(--ink);
    background: var(--surface-inset);
    border: 1px solid var(--accent);
    border-radius: var(--radius-2);
  }
  .ci:focus {
    outline: none;
    border-color: var(--accent);
  }
  .ci::placeholder {
    color: var(--text-faint);
  }
</style>
