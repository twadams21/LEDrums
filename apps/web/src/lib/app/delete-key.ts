/* Backspace / Delete decision logic, split out of App.svelte so it is unit-testable.

   Why the app claims the key at all: in a bare WKWebView — which is what the packaged
   desktop shell renders in — Backspace still performs WebKit's history-back navigation
   (Safari and Chrome disabled that years ago, which is why it never reproduces in dev).
   The shell's webview history is exactly [boot shell, app], so ONE unclaimed Backspace
   lands the drummer on the dead "Starting…" boot page and reads as a crash.

   So the rule is: outside editable text, the app owns Backspace/Delete unconditionally —
   whether or not anything is actually deleted. The caller must call `preventDefault()`
   and must NOT call `stopPropagation()`: xyflow's key handler listens on window in the
   BUBBLE phase and still needs the event to delete a selected wire. */

/** Node shape this decision cares about — the graph node a 'node' selection resolves to. */
export interface DeleteKeyNode {
  kind: string;
}

/** Selection shape this decision cares about (structurally compatible with shell `Selection`). */
export interface DeleteKeySelection {
  kind: string;
}

export interface DeleteKeyInput {
  key: string;
  /** True when the event started inside user-editable text UI (`isEditableShortcutTarget`). */
  isEditableTarget: boolean;
  selection: DeleteKeySelection | null | undefined;
  /** The graph node the selection resolves to, or null when it resolves to nothing. */
  resolvedNode: DeleteKeyNode | null | undefined;
}

export interface DeleteKeyDecision {
  /** Call `event.preventDefault()` — claims the key from WebKit's history-back default. */
  prevent: boolean;
  /** Remove `resolvedNode` from the active graph and clear the selection. */
  removeNode: boolean;
}

const NONE: DeleteKeyDecision = { prevent: false, removeNode: false };

/** Backspace and forward-Delete are treated identically — both are "delete" on the canvas,
    and Backspace alone carries the history-navigation default we have to claim. */
export function isDeleteKey(key: string): boolean {
  return key === 'Backspace' || key === 'Delete';
}

export function decideDeleteKey(input: DeleteKeyInput): DeleteKeyDecision {
  if (!isDeleteKey(input.key)) return NONE;
  // Inside a text field the key means "delete a character" — never claim it there.
  if (input.isEditableTarget) return NONE;
  const node = input.selection?.kind === 'node' ? input.resolvedNode : null;
  // Trigger nodes are the graph's fixed root and are never removable.
  const removeNode = !!node && node.kind !== 'trigger';
  return { prevent: true, removeNode };
}
