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
const POPUP_SURFACE_SELECTOR =
  '[data-keyboard-owner="popover"], [data-keyboard-owner="menu"], ' +
  '[role="listbox"], [role="menu"], [popover]';
const POPUP_TRIGGER_SELECTOR =
  '[role="combobox"], [data-keyboard-owner="select"]';

function hasOpenState(element: Element): boolean {
  // A mounted Bits surface remains in the DOM during its exit animation. Its state is the
  // authority, not its presence or its role. The explicit marker is for primitives that do not
  // expose data-state but do expose a shared open/closed state.
  const keyboardOpen = element.getAttribute('data-keyboard-open');
  if (keyboardOpen !== null) return keyboardOpen === 'true';
  const state = element.getAttribute('data-state');
  if (state === 'closed') return false;
  if (state === 'open') return true;
  const expanded = element.getAttribute('aria-expanded');
  if (expanded !== null) return expanded === 'true';

  // Native popovers use :popover-open rather than an open attribute. Older browsers and jsdom
  // may not parse that selector, so treat it as an optional capability and retain the native
  // `open` property/attribute fallback for dialog-like primitives.
  try {
    if (element.matches(':popover-open')) return true;
  } catch {
    // The selector is unsupported in this browser/runtime.
  }
  if (element.hasAttribute('open')) return true;
  return (element as Element & { open?: unknown }).open === true;
}

function isOpenPopupSurface(element: Element): boolean {
  return element.matches(POPUP_SURFACE_SELECTOR) && hasOpenState(element);
}

function isOpenPopupTrigger(element: Element): boolean {
  return element.matches(POPUP_TRIGGER_SELECTOR) && hasOpenState(element);
}

function documentHasOpenPopup(): boolean {
  if (typeof document === 'undefined') return false;
  return (
    Array.from(document.querySelectorAll(POPUP_SURFACE_SELECTOR)).some(isOpenPopupSurface) ||
    Array.from(document.querySelectorAll(POPUP_TRIGGER_SELECTOR)).some(isOpenPopupTrigger)
  );
}

/** Read the keyboard surface that owns an event, without inspecting focus history or blurring it.
    Bits UI portals its popup content to body, so listbox/option roles cover events in the portal;
    the trigger markers cover the trigger while it is open. */
export function performanceKeyTarget(input: TargetOrEvent): PerformanceKeyTarget {
  const eventPath = eventElements(input);
  const focusPath = typeof document !== 'undefined' ? eventElements(document.activeElement) : [];
  const elements = [...new Set([...eventPath, ...focusPath])];
  const element = eventPath[0] ?? focusPath[0] ?? null;
  const globallyModal = typeof document !== 'undefined' && document.querySelector(MODAL_SELECTOR) !== null;
  const globallyOpenPopup = documentHasOpenPopup();

  return {
    isEditableTarget: isEditableShortcutTarget(element),
    // Items inherit ownership only through an open owning surface in the same composed path.
    // Matching item roles directly would make force-mounted closed items swallow Perform keys.
    inOpenPopup: globallyOpenPopup || elements.some(isOpenPopupSurface) || elements.some(isOpenPopupTrigger),
    inKeyboardControl: matches(elements,
      '[data-keyboard-owner="select"], [data-keyboard-owner="roving"], ' +
        '[data-keyboard-owner="slider"], [data-keyboard-owner="separator"], ' +
        '[role="radio"], [role="switch"], [role="slider"], [role="separator"], [aria-pressed], select',
    ),
    inFlowCanvas: matches(elements, '.svelte-flow'),
    inModal: matches(elements, MODAL_SELECTOR) || globallyModal,
  };
}
