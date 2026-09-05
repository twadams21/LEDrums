/* DOM adapter for performance-key ownership. The decision itself stays pure in
   performance-key.ts; this module only observes stable accessibility/component semantics. */

import { isEditableShortcutTarget } from './primary-shortcut';

export interface PerformanceKeyTarget {
  isEditableTarget: boolean;
  inOpenPopup: boolean;
  inKeyboardControl: boolean;
  inFlowCanvas: boolean;
}

function elementTarget(target: EventTarget | null | undefined): Element | null {
  return typeof Element !== 'undefined' && target instanceof Element ? target : null;
}

/** Read the keyboard surface that owns an event, without inspecting focus history or blurring it.
    Bits UI portals its popup content to body, so listbox/option roles cover events in the portal;
    the trigger markers cover the trigger while it is open. */
export function performanceKeyTarget(target: EventTarget | null | undefined): PerformanceKeyTarget {
  const element = elementTarget(target);
  const closest = (selector: string): Element | null => element?.closest(selector) ?? null;

  return {
    isEditableTarget: isEditableShortcutTarget(target),
    inOpenPopup: !!closest(
      '[role="listbox"], [role="option"], [role="combobox"][aria-expanded="true"], ' +
        '[data-keyboard-owner="select"][aria-expanded="true"], [data-keyboard-owner="select"][data-state="open"]',
    ),
    inKeyboardControl: !!closest(
      '[data-keyboard-owner="roving"], [role="radio"], [role="switch"], [aria-pressed]',
    ),
    inFlowCanvas: !!closest('.svelte-flow'),
  };
}
