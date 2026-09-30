// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/svelte';
import { createRawSnippet } from 'svelte';
import type { TunnelInfo } from '../ws/protocol-types';
import type { TriggerLab } from '../trigger-lab/store.svelte';
import AppKeyboardCapture from './AppKeyboardCapture.svelte';
import type { AppKeyboardShell, AppKeyboardStore } from './app-keyboard';
import type { ShortcutEntry } from './shortcuts';
import { createAppShortcuts } from './app-shortcuts';
import BootOverlay from './chrome/BootOverlay.svelte';
import { initialBootStatus } from './boot-reducer';
import ShareInfo from './chrome/ShareInfo.svelte';
import ContextMenu from '../ui/ContextMenu.svelte';
import Dialog from '../ui/Dialog.svelte';

beforeEach(() => {
  vi.stubGlobal('ResizeObserver', class {
    observe(): void {}
    unobserve(): void {}
    disconnect(): void {}
  });
  vi.stubGlobal('matchMedia', (query: string) => ({
    matches: false,
    media: query,
    onchange: null,
    addListener: () => {},
    removeListener: () => {},
    addEventListener: () => {},
    removeEventListener: () => {},
    dispatchEvent: () => false,
  }));
});

const laterWindowListeners: Array<(event: KeyboardEvent) => void> = [];

afterEach(() => {
  cleanup();
  document.body.replaceChildren();
  for (const listener of laterWindowListeners) window.removeEventListener('keydown', listener);
  laterWindowListeners.length = 0;
});

const LIVE: TunnelInfo = { status: 'live', url: 'https://foo.trycloudflare.com', pin: '4821' };

function key(target: EventTarget, keyName: string, init: KeyboardEventInit = {}): KeyboardEvent {
  const event = new KeyboardEvent('keydown', { key: keyName, bubbles: true, cancelable: true, ...init });
  target.dispatchEvent(event);
  return event;
}

function installLaterWindowListener(): ReturnType<typeof vi.fn> {
  const listener = vi.fn<(event: KeyboardEvent) => void>();
  window.addEventListener('keydown', listener);
  laterWindowListeners.push(listener);
  return listener;
}

function fixture() {
  const stepSetlist = vi.fn(() => true);
  const store: AppKeyboardStore = {
    fireEffectAt: vi.fn(),
    stepSetlist,
  };
  const shell: AppKeyboardShell = {
    view: 'perform',
    settingsPane: null,
  };
  const duplicate = vi.fn(() => true);
  const shortcuts: ShortcutEntry[] = [
    { combo: 'mod+d', description: 'Duplicate selection', run: duplicate },
  ];
  render(AppKeyboardCapture, {
    props: { store, shell, shortcuts, shortcutPlatform: 'mac' },
  });
  return { store, shell, duplicate };
}

describe('AppKeyboardCapture — mounted App-level shortcut seam', () => {
  it('claims Perform digits, arrows, duplicate, and delete through one capture handler', () => {
    const { store, duplicate } = fixture();

    const digit = key(document.body, '1');
    const arrow = key(document.body, 'ArrowRight', { repeat: true });
    const duplicateEvent = key(document.body, 'd', { metaKey: true });
    const deleteEvent = key(document.body, 'Backspace');

    expect(store.fireEffectAt).toHaveBeenCalledWith(0);
    expect(store.stepSetlist).toHaveBeenCalledWith('section', 1);
    expect(duplicate).toHaveBeenCalledOnce();
    expect(deleteEvent.defaultPrevented).toBe(true);
    expect(digit.defaultPrevented).toBe(true);
    expect(arrow.defaultPrevented).toBe(true);
    expect(duplicateEvent.defaultPrevented).toBe(true);
  });

  it('delegates a middle section move through the same stepper as the section arrows', () => {
    const { store } = fixture();

    key(document.body, 'ArrowLeft');

    expect(store.stepSetlist).toHaveBeenCalledWith('section', -1);
  });

  it.each([
    ['first', 'ArrowLeft', -1],
    ['last', 'ArrowRight', 1],
  ] as const)('takes no action when the store reports the %s section is clamped', (_edge, keyName, delta) => {
    const { store } = fixture();
    vi.mocked(store.stepSetlist).mockReturnValue(false);

    const event = key(document.body, keyName);

    expect(store.stepSetlist).toHaveBeenCalledWith('section', delta);
    expect(store.fireEffectAt).not.toHaveBeenCalled();
    expect(event.defaultPrevented).toBe(true);
  });

  it('suppresses every background action behind the real BootOverlay alertdialog', () => {
    const { store, duplicate } = fixture();
    render(BootOverlay, { props: { active: true, status: initialBootStatus } });
    const overlay = screen.getByRole('alertdialog');
    const laterWindow = installLaterWindowListener();

    key(overlay, '1');
    const shortcut = key(overlay, 'd', { metaKey: true });
    laterWindow.mockClear();
    const deleteEvent = key(overlay, 'Backspace');

    expect(store.fireEffectAt).not.toHaveBeenCalled();
    expect(duplicate).not.toHaveBeenCalled();
    expect(shortcut.defaultPrevented).toBe(true);
    expect(deleteEvent.defaultPrevented).toBe(true);
    expect(laterWindow).not.toHaveBeenCalled();
  });

  it('suppresses every background action inside the real portalled ShareInfo popover', async () => {
    const { store, duplicate } = fixture();
    const shareStore = {
      tunnel: LIVE,
      isViewer: false,
      setSharing: vi.fn(),
    } as unknown as TriggerLab;
    render(ShareInfo, { props: { store: shareStore } });
    await fireEvent.click(screen.getByLabelText('Share room'));
    const popover = await screen.findByText('Share room');
    const laterWindow = installLaterWindowListener();

    expect(popover.closest('[data-keyboard-owner="popover"]')).not.toBeNull();
    key(popover, '1');
    const shortcut = key(popover, 'd', { metaKey: true });
    laterWindow.mockClear();
    const deleteEvent = key(popover, 'Backspace');

    expect(store.fireEffectAt).not.toHaveBeenCalled();
    expect(duplicate).not.toHaveBeenCalled();
    expect(shortcut.defaultPrevented).toBe(true);
    expect(deleteEvent.defaultPrevented).toBe(true);
    expect(laterWindow).not.toHaveBeenCalled();
  });

  it('suppresses every background action inside the real portalled ContextMenu menu', async () => {
    const { store, duplicate } = fixture();
    const actions = [{ label: 'Rename', onSelect: vi.fn() }];
    const children = createRawSnippet(() => ({ render: () => '<span>row</span>' }));
    const { container } = render(ContextMenu, { props: { actions, children } });
    await fireEvent.contextMenu(container.querySelector('.ctx-anchor')!);
    const menu = await waitFor(() => screen.getByRole('menu'));
    const item = screen.getByRole('menuitem');
    const laterWindow = installLaterWindowListener();

    expect(menu.getAttribute('data-keyboard-owner')).toBe('menu');
    expect(item.getAttribute('data-keyboard-owner')).toBe('menuitem');
    key(item, '1');
    const shortcut = key(item, 'd', { metaKey: true });
    laterWindow.mockClear();
    const deleteEvent = key(item, 'Backspace');

    expect(store.fireEffectAt).not.toHaveBeenCalled();
    expect(duplicate).not.toHaveBeenCalled();
    expect(shortcut.defaultPrevented).toBe(true);
    expect(deleteEvent.defaultPrevented).toBe(true);
    expect(laterWindow).not.toHaveBeenCalled();
  });

  it('suppresses every background action inside the shared Dialog and native open dialog', () => {
    const { store, duplicate } = fixture();
    const children = createRawSnippet(() => ({ render: () => '<button>dialog action</button>' }));
    render(Dialog, { props: { open: true, title: 'Dialog', children } });
    const content = document.querySelector('[data-keyboard-owner="modal"]')!;
    const laterWindow = installLaterWindowListener();

    key(content, '1');
    const shortcut = key(content, 'd', { metaKey: true });
    laterWindow.mockClear();
    const dialogDelete = key(content, 'Backspace');
    const textInput = content.appendChild(document.createElement('input'));
    const textDelete = key(textInput, 'Backspace');
    const textUndo = key(textInput, 'z', { metaKey: true });
    expect(dialogDelete.defaultPrevented).toBe(true);
    expect(shortcut.defaultPrevented).toBe(true);
    expect(textDelete.defaultPrevented).toBe(false);
    expect(textUndo.defaultPrevented).toBe(false);
    expect(laterWindow).toHaveBeenCalledTimes(2);

    const native = document.body.appendChild(document.createElement('dialog'));
    native.setAttribute('open', '');
    key(native, '1');
    key(native, 'd', { metaKey: true });
    laterWindow.mockClear();
    const nativeDelete = key(native, 'Backspace');
    native.remove();

    expect(store.fireEffectAt).not.toHaveBeenCalled();
    expect(duplicate).not.toHaveBeenCalled();
    expect(nativeDelete.defaultPrevented).toBe(true);
    expect(laterWindow).not.toHaveBeenCalled();
  });

  it('consumes Cmd+D inside a modal with the real App registry, so SectionsView cannot duplicate behind it', () => {
    const store: AppKeyboardStore = { fireEffectAt: vi.fn(), stepSetlist: vi.fn(() => true) };
    const shell: AppKeyboardShell = { view: 'sections', settingsPane: null };
    const shortcuts = createAppShortcuts({ undo: vi.fn(() => false) });
    render(AppKeyboardCapture, { props: { store, shell, shortcuts, shortcutPlatform: 'mac' } });
    // Stand-in for SectionsView's window capture listener: it acts only on a non-prevented chord.
    const sectionDuplicate = vi.fn();
    const sectionsListener = (e: KeyboardEvent): void => {
      if (!e.defaultPrevented && e.metaKey && e.key === 'd') sectionDuplicate();
    };
    window.addEventListener('keydown', sectionsListener);
    laterWindowListeners.push(sectionsListener);

    // Outside a modal the no-op entry falls through to the view.
    const chrome = document.body.appendChild(document.createElement('button'));
    const open = key(chrome, 'd', { metaKey: true });
    expect(open.defaultPrevented).toBe(false);
    expect(sectionDuplicate).toHaveBeenCalledTimes(1);

    const children = createRawSnippet(() => ({ render: () => '<button>dialog action</button>' }));
    render(Dialog, { props: { open: true, title: 'Dialog', children } });
    const content = document.querySelector('[data-keyboard-owner="modal"]')!;
    const inModal = key(content, 'd', { metaKey: true });
    expect(inModal.defaultPrevented).toBe(true);
    expect(sectionDuplicate).toHaveBeenCalledTimes(1);
  });

  it('outside a modal, a focused control keeps its arrows but a digit auditions its Effect', () => {
    // Clicking a slider / segmented / dropdown leaves it focused; the 1–9,0 bank must still work
    // (Tim, 2026-09-28). None of those controls uses a digit.
    const { store } = fixture();
    const control = document.body.appendChild(document.createElement('button'));
    control.setAttribute('data-keyboard-owner', 'slider');
    const received = vi.fn();
    control.addEventListener('keydown', received);

    const arrow = key(control, 'ArrowRight');
    const digit = key(control, '1');

    expect(received).toHaveBeenCalledTimes(1); // the arrow only
    expect(arrow.defaultPrevented).toBe(false);
    expect(digit.defaultPrevented).toBe(true);
    expect(store.fireEffectAt).toHaveBeenCalledWith(0);
  });

  it('outside a modal, Backspace on a focused control is still suppressed — it never reaches the view', () => {
    fixture();
    const control = document.body.appendChild(document.createElement('button'));
    control.setAttribute('data-keyboard-owner', 'roving');
    expect(key(control, 'Backspace').defaultPrevented).toBe(true);
  });

  it('outside a modal, a mapped key performs through a focused control — but not the keys it navigates by', () => {
    const performKey = vi.fn((code: string) => code === 'KeyQ' || code === 'ArrowRight');
    const session = { learnKey: vi.fn(), clearArmed: vi.fn(), performKey, isKeyMapped: vi.fn(() => true), reset: vi.fn() };
    const store: AppKeyboardStore = { fireEffectAt: vi.fn(), stepSetlist: vi.fn(() => true) };
    const shell: AppKeyboardShell = { view: 'perform', settingsPane: null, mapMode: false, mapSession: session };
    render(AppKeyboardCapture, { props: { store, shell, shortcuts: [], shortcutPlatform: 'mac' } });
    const control = document.body.appendChild(document.createElement('button'));
    control.setAttribute('data-keyboard-owner', 'slider');
    const received = vi.fn();
    control.addEventListener('keydown', received);

    const mapped = key(control, 'q', { code: 'KeyQ' });
    const arrow = key(control, 'ArrowRight', { code: 'ArrowRight' });

    expect(performKey).toHaveBeenCalledWith('KeyQ');
    expect(mapped.defaultPrevented).toBe(true);
    expect(performKey).not.toHaveBeenCalledWith('ArrowRight'); // the slider's own key
    expect(arrow.defaultPrevented).toBe(false);
    expect(received).toHaveBeenCalledTimes(1); // only the arrow reached the control
  });

  it('lets marked keyboard controls receive Perform arrows and digits inside a modal and popup', () => {
    const { store } = fixture();
    const modal = document.body.appendChild(document.createElement('div'));
    modal.setAttribute('role', 'dialog');
    modal.setAttribute('aria-modal', 'true');
    const modalControl = modal.appendChild(document.createElement('button'));
    modalControl.setAttribute('data-keyboard-owner', 'roving');
    const popup = document.body.appendChild(document.createElement('div'));
    popup.setAttribute('data-keyboard-owner', 'popover');
    const popupControl = popup.appendChild(document.createElement('button'));
    popupControl.setAttribute('data-keyboard-owner', 'select');
    const received = vi.fn();
    modalControl.addEventListener('keydown', received);
    popupControl.addEventListener('keydown', received);

    const modalArrow = key(modalControl, 'ArrowLeft');
    const modalDigit = key(modalControl, '2');
    const popupArrow = key(popupControl, 'ArrowRight');
    const popupDigit = key(popupControl, '3');

    expect(received).toHaveBeenCalledTimes(4);
    expect(modalArrow.defaultPrevented).toBe(false);
    expect(modalDigit.defaultPrevented).toBe(false);
    expect(popupArrow.defaultPrevented).toBe(false);
    expect(popupDigit.defaultPrevented).toBe(false);
    expect(store.fireEffectAt).not.toHaveBeenCalled();
  });

  it('claims Backspace outside text without stopping it, and leaves editable text alone', () => {
    fixture();
    const surface = document.body.appendChild(document.createElement('div'));
    const laterWindow = installLaterWindowListener();

    const surfaceDelete = key(surface, 'Backspace');
    expect(surfaceDelete.defaultPrevented).toBe(true);
    expect(laterWindow).toHaveBeenCalledOnce();

    const input = document.body.appendChild(document.createElement('input'));
    const textDelete = key(input, 'Backspace');
    expect(textDelete.defaultPrevented).toBe(false);
    expect(laterWindow).toHaveBeenCalledTimes(2);
  });
});
