/* Backspace / Delete decision logic, split out of App.svelte so it is unit-testable.

   Why the app claims the key at all: in a bare WKWebView — which is what the packaged
   desktop shell renders in — Backspace still performs WebKit's history-back navigation
   (Safari and Chrome disabled that years ago, which is why it never reproduces in dev).
   The shell's webview history is exactly [boot shell, app], so ONE unclaimed Backspace
   lands the drummer on the dead "Starting…" boot page and reads as a crash.

   So the rule is: outside editable text, the app owns Backspace/Delete unconditionally —
   whether or not anything is actually deleted. The caller must call `preventDefault()`
   and must NOT call `stopPropagation()`: a later listener in the event's path may still
   own the key. */

export interface DeleteKeyInput {
  key: string;
  /** True when the event started inside user-editable text UI (`isEditableShortcutTarget`). */
  isEditableTarget: boolean;
}

export interface DeleteKeyDecision {
  /** Call `event.preventDefault()` — claims the key from WebKit's history-back default. */
  prevent: boolean;
}

const NONE: DeleteKeyDecision = { prevent: false };

/** Backspace and forward-Delete are treated identically — both are "delete", and Backspace
    alone carries the history-navigation default we have to claim. */
export function isDeleteKey(key: string): boolean {
  return key === 'Backspace' || key === 'Delete';
}

export function decideDeleteKey(input: DeleteKeyInput): DeleteKeyDecision {
  if (!isDeleteKey(input.key)) return NONE;
  // Inside a text field the key means "delete a character" — never claim it there.
  if (input.isEditableTarget) return NONE;
  return { prevent: true };
}
