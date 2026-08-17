/* Escape-to-dismiss policy for the shell's NON-MODAL overlays — the Inspector slideover
   and the on-canvas Add-node popover.

   Modal surfaces (everything through `lib/ui/Dialog.svelte` → Bits UI) own their own
   Escape: they trap focus and close themselves. A non-modal overlay listens on `window`
   instead, so it MUST NOT steal an Escape that belongs to something else:

   - an editable target keeps it (CommitInput reverts the edit and blurs, so the NEXT
     Escape lands on the body and reaches us);
   - an open modal keeps it (the slideover paints below `--z-modal`; dismissing it out
     from under a dialog would be dismissing a surface the user cannot even see).

   Both rules are one pure predicate so the ordering is unit-tested rather than
   re-derived per overlay. */

export interface EscapeDismissInput {
  /** `KeyboardEvent.key`. */
  key: string;
  /** Focus is in an input / textarea / select / contenteditable (see `primary-shortcut`). */
  isEditableTarget: boolean;
  /** A modal dialog is on screen above this overlay. */
  modalOpen: boolean;
}

/** True when a non-modal overlay should close on this key event. */
export function shouldDismissOnEscape({ key, isEditableTarget, modalOpen }: EscapeDismissInput): boolean {
  return key === 'Escape' && !isEditableTarget && !modalOpen;
}

/** The minimal `document` surface {@link isModalDialogOpen} reads — kept structural so the
    predicate unit-tests without a DOM. */
export interface DialogQueryable {
  querySelector(selectors: string): unknown;
}

/** Is a modal dialog currently mounted? Every modal in the app portals through
    `lib/ui/Dialog.svelte` (Bits UI `Dialog.Content`, which renders `role="dialog"`), so one
    query answers for all of them — and keeps answering as dialogs are added, which an
    enumerated list of store flags would not. */
export function isModalDialogOpen(doc: DialogQueryable): boolean {
  return doc.querySelector('[role="dialog"]') !== null;
}
