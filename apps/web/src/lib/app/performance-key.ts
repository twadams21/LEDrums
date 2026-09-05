/* Performance-key ownership. The live performer gets the computer-keyboard shortcuts only in
   the Perform view. Authoring views leave their controls alone, so a digit or arrow has one
   owner: the focused editor control/canvas, not a hidden performance action behind it.

   Perform still yields to keyboard-native surfaces. Text fields own digits/caret arrows;
   open popup controls own typeahead/navigation; and radio/toggle/segmented controls own their
   roving focus. The caller installs this decision in the window's capture-phase listener and
   must claim an app-owned event with both preventDefault and stopPropagation. */

import type { View } from './shell-nav';

export type SectionStep = -1 | 1;

export interface PerformanceKeyInput {
  key: string;
  view: View;
  /** Settings overlays the workspace, so it must never expose hidden performance actions. */
  settingsOpen: boolean;
  /** Native text entry, including contenteditable and native select elements. */
  isEditableTarget: boolean;
  /** An open Bits Select/listbox/combobox popup owns its typeahead and navigation keys. */
  inOpenPopup: boolean;
  /** Radio/toggle/segmented controls own their keyboard interaction. */
  inKeyboardControl: boolean;
  /** The graph canvas owns ArrowLeft/ArrowRight for selected-node movement. */
  inFlowCanvas: boolean;
  /** Any modifier reserves the chord for the focused/native surface. */
  ctrlKey: boolean;
  metaKey: boolean;
  altKey: boolean;
  shiftKey: boolean;
  /** Held graph digits must not retrigger; arrows intentionally repeat for navigation. */
  repeat: boolean;
}

export interface PerformanceKeyDecision {
  /** Index into the active section's graph list, when a digit fired one. */
  fireGraphIndex?: number;
  /** Direction to step the active song's sections, when an arrow asked for it. */
  sectionStep?: SectionStep;
  /** The caller must prevent the browser default and stop propagation when true. */
  claim: boolean;
}

const NOTHING: PerformanceKeyDecision = { claim: false };

export function decidePerformanceKey(input: PerformanceKeyInput): PerformanceKeyDecision {
  if (input.view !== 'perform' || input.settingsOpen) return NOTHING;
  if (input.isEditableTarget || input.inOpenPopup || input.inKeyboardControl) return NOTHING;
  if (input.ctrlKey || input.metaKey || input.altKey || input.shiftKey) return NOTHING;

  if (/^[0-9]$/.test(input.key)) {
    // A held digit is one graph intent. Let the repeated event continue to its native owner.
    if (input.repeat) return NOTHING;
    // `0` is the tenth graph, so the row reads 1…9,0 like a keyboard shortcut bank.
    return { fireGraphIndex: input.key === '0' ? 9 : Number(input.key) - 1, claim: true };
  }

  if (input.key === 'ArrowLeft' || input.key === 'ArrowRight') {
    if (input.inFlowCanvas) return NOTHING;
    // Arrow repeat is intentional: holding an arrow walks through sections at the browser's
    // repeat cadence. This is different from graph digits, which are edge-triggered above.
    return { sectionStep: input.key === 'ArrowRight' ? 1 : -1, claim: true };
  }

  return NOTHING;
}

/** Apply the capture-phase claim required by the ownership contract. Kept beside the pure
    decision so tests pin that an app-owned event cannot continue into a focused control. */
export function claimPerformanceKey(
  event: { preventDefault(): void; stopPropagation(): void },
  decision: PerformanceKeyDecision,
): void {
  if (!decision.claim) return;
  event.preventDefault();
  event.stopPropagation();
}
