/* Pure commit-decision logic for CommitInput.svelte — extracted so it can be
   unit-tested in the repo's node test environment (no DOM). The component owns
   focus / keyboard wiring; this owns the "what should happen on commit" rules
   for both text (inline-rename) and number (clamped field) modes. */

export type CommitInputType = 'text' | 'number' | 'password';

/** The outcome of a commit attempt (Enter / blur). `commit` fires `onCommit(value)`;
    `cancel` fires `onCancel?.()` and leaves the value untouched; `revert` additionally
    resets the draft back to the incoming value (garbage numeric input). */
export type CommitDecision =
  | { action: 'commit'; value: string }
  | { action: 'cancel' }
  | { action: 'revert' };

export interface ResolveCommitOptions {
  /** The current (uncommitted) draft text. */
  draft: string;
  /** The incoming `value` prop, stringified. */
  value: string;
  type?: CommitInputType;
  min?: number;
  max?: number;
  /** Text mode: when true, an emptied field commits '' (clear) instead of cancelling.
      Rename sites leave this false so a blank reverts; persistent fields that clear-to-remove
      (e.g. an optional OSC address) set it true. Ignored in number mode, which always
      commits '' for an emptied field so the caller can decide. */
  allowEmpty?: boolean;
}

/** Clamp `n` into the optional [min, max] range. */
export function clampNumber(n: number, min?: number, max?: number): number {
  if (min !== undefined && n < min) return min;
  if (max !== undefined && n > max) return max;
  return n;
}

/** Decide what a commit (Enter / blur) should do, given the draft and the incoming value.
    Esc-revert is handled directly by the component and does not go through here. */
export function resolveCommit(o: ResolveCommitOptions): CommitDecision {
  const original = o.value;

  if (o.type === 'password') {
    // A credential: NEVER trim (surrounding whitespace can be significant) and never round-trip the
    // stored value — the caller holds only a hash and passes `value=''`, so the field always starts
    // empty and clears after a commit. Any non-empty draft commits the raw password; an empty draft
    // is a no-op (clearing a set password is done elsewhere, not by submitting blank).
    return o.draft ? { action: 'commit', value: o.draft } : { action: 'cancel' };
  }

  if (o.type === 'number') {
    const raw = o.draft.trim();
    if (raw === '') {
      // Emptied: clear (commit '') unless it was already empty.
      return original.trim() === '' ? { action: 'cancel' } : { action: 'commit', value: '' };
    }
    const n = Number(raw);
    if (!Number.isFinite(n)) return { action: 'revert' }; // garbage → keep prior value
    const clamped = String(clampNumber(n, o.min, o.max));
    return clamped === original.trim() ? { action: 'cancel' } : { action: 'commit', value: clamped };
  }

  // Text mode.
  const trimmed = o.draft.trim();
  if (o.allowEmpty) {
    return trimmed === original.trim() ? { action: 'cancel' } : { action: 'commit', value: trimmed };
  }
  // Rename semantics: commit only a non-empty, changed value; otherwise cancel (revert).
  return trimmed && trimmed !== original ? { action: 'commit', value: trimmed } : { action: 'cancel' };
}
