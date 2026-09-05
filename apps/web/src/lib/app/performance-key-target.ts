/* DOM adapter for performance-key ownership. The decision itself stays pure in
   performance-key.ts; this module only observes stable accessibility/component semantics. */

import { isEditableShortcutTarget } from './primary-shortcut';

export interface PerformanceKeyTarget {
  isEditableTarget: boolean;
  inOpenPopup: boolean;
  inKeyboardControl: boolean;
  inFlowCanvas: boolean;
  inModal: boolean;
}

function elementTarget(target: EventTarget | null | undefined): Element | null {
  return typeof Element !== 'undefined' && target instanceof Element ? target : null;
}

type TargetOrEvent = Event | EventTarget | null | undefined;

function isDomEvent(input: TargetOrEvent): input is Event {
  return typeof Event !== 'undefined' && input instanceof Event;
}

function eventElements(input: TargetOrEvent): Element[] {
  if (isDomEvent(input)) {
    return input.composedPath().filter((entry): entry is Element => elementTarget(entry) !== null);
  }
  const start = elementTarget(input);
  const elements: Element[] = [];
  for (let current = start; current; current = current.parentElement) elements.push(current);
  return elements;
}

function matches(elements: readonly Element[], selector: string): boolean {
  return elements.some((entry) => entry.matches(selector));
}

const MODAL_SELECTOR =
  '[role="dialog"][aria-modal="true"], [role="alertdialog"], dialog[open], [data-keyboard-owner="modal"]';
const OPEN_POPUP_SELECTOR =
  '[data-keyboard-owner="popover"], [data-keyboard-owner="menu"], [data-keyboard-owner="menuitem"], ' +
  '[role="listbox"], [role="option"], [role="menu"], [role="menuitem"]';

/** Read the keyboard surface that owns an event, without inspecting focus history or blurring it.
    Bits UI portals its popup content to body, so listbox/option roles cover events in the portal;
    the trigger markers cover the trigger while it is open. */
export function performanceKeyTarget(input: TargetOrEvent): PerformanceKeyTarget {
  const eventPath = eventElements(input);
  const focusPath = typeof document !== 'undefined' ? eventElements(document.activeElement) : [];
  const elements = [...new Set([...eventPath, ...focusPath])];
  const element = eventPath[0] ?? focusPath[0] ?? null;
  const globallyModal = typeof document !== 'undefined' && document.querySelector(MODAL_SELECTOR) !== null;
  const globallyOpenPopup = typeof document !== 'undefined' && document.querySelector(OPEN_POPUP_SELECTOR) !== null;

  return {
    isEditableTarget: isEditableShortcutTarget(element),
    inOpenPopup: globallyOpenPopup || matches(elements,
      '[role="combobox"][aria-expanded="true"], ' +
        '[data-keyboard-owner="select"][aria-expanded="true"], [data-keyboard-owner="select"][data-state="open"], ' +
        '[data-keyboard-owner="popover"], [data-keyboard-owner="menu"], [data-keyboard-owner="menuitem"], ' +
        '[role="listbox"], [role="option"], [role="menu"], [role="menuitem"]',
    ),
    inKeyboardControl: matches(elements,
      '[data-keyboard-owner="select"], [data-keyboard-owner="roving"], ' +
        '[data-keyboard-owner="slider"], [data-keyboard-owner="separator"], ' +
        '[role="radio"], [role="switch"], [role="slider"], [role="separator"], [aria-pressed], select',
    ),
    inFlowCanvas: matches(elements, '.svelte-flow'),
    inModal: matches(elements, MODAL_SELECTOR) || globallyModal,
  };
}
