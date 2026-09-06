// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/svelte';
import { createRawSnippet } from 'svelte';
import type { TunnelInfo } from '../ws/protocol-types';
import type { TriggerLab } from '../trigger-lab/store.svelte';
import AppKeyboardCapture from './AppKeyboardCapture.svelte';
import type { AppKeyboardShell, AppKeyboardStore } from './app-keyboard';
import type { ShortcutEntry } from './shortcuts';
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
  const store: AppKeyboardStore = {
    activeSong: { sections: [{ id: 'a' }, { id: 'b' }] },
    activeSectionId: 'a',
    selectedGraph: { nodes: [{ id: 'node', kind: 'effect' }] },
    fireSectionGraph: vi.fn(),
    setActiveSection: vi.fn(),
    removeNode: vi.fn(),
  };
  const shell: AppKeyboardShell = {
    view: 'perform',
    settingsPane: null,
    selection: { kind: 'node', nodeId: 'node' },
    clearSelection: vi.fn(),
  };
  const duplicate = vi.fn(() => true);
  const shortcuts: ShortcutEntry[] = [
    { combo: 'mod+d', description: 'Duplicate selected node', run: duplicate },
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
    key(document.body, 'Backspace');

    expect(store.fireSectionGraph).toHaveBeenCalledWith(0);
    expect(store.setActiveSection).toHaveBeenCalledWith('b');
    expect(duplicate).toHaveBeenCalledOnce();
    expect(store.removeNode).toHaveBeenCalledOnce();
    expect(digit.defaultPrevented).toBe(true);
    expect(arrow.defaultPrevented).toBe(true);
    expect(duplicateEvent.defaultPrevented).toBe(true);
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

    expect(store.fireSectionGraph).not.toHaveBeenCalled();
    expect(store.removeNode).not.toHaveBeenCalled();
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

    expect(store.fireSectionGraph).not.toHaveBeenCalled();
    expect(store.removeNode).not.toHaveBeenCalled();
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

    expect(store.fireSectionGraph).not.toHaveBeenCalled();
    expect(store.removeNode).not.toHaveBeenCalled();
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

    expect(store.fireSectionGraph).not.toHaveBeenCalled();
    expect(store.removeNode).not.toHaveBeenCalled();
    expect(duplicate).not.toHaveBeenCalled();
    expect(nativeDelete.defaultPrevented).toBe(true);
    expect(laterWindow).not.toHaveBeenCalled();
  });

  it('keeps ordinary Perform canvas arrows with the canvas and still fires a digit', () => {
    const { store } = fixture();
    const canvas = document.body.appendChild(document.createElement('div'));
    canvas.className = 'svelte-flow';
    let bubbled = 0;
    canvas.addEventListener('keydown', () => bubbled++);

    const arrow = key(canvas, 'ArrowRight');
    const digit = key(canvas, '1');

    expect(store.setActiveSection).not.toHaveBeenCalled();
    expect(store.fireSectionGraph).toHaveBeenCalledWith(0);
    expect(arrow.defaultPrevented).toBe(false);
    expect(digit.defaultPrevented).toBe(true);
    expect(bubbled).toBe(1); // ArrowRight reaches the canvas; the claimed digit stops in capture.
  });

  it('keeps intended delete propagation on the canvas and in normal editable text', () => {
    const { store } = fixture();
    const canvas = document.body.appendChild(document.createElement('div'));
    canvas.className = 'svelte-flow';
    const laterWindow = installLaterWindowListener();

    const canvasDelete = key(canvas, 'Backspace');
    expect(canvasDelete.defaultPrevented).toBe(true);
    expect(store.removeNode).toHaveBeenCalledOnce();
    expect(laterWindow).toHaveBeenCalledOnce();

    const input = document.body.appendChild(document.createElement('input'));
    const textDelete = key(input, 'Backspace');
    expect(textDelete.defaultPrevented).toBe(false);
    expect(store.removeNode).toHaveBeenCalledOnce();
    expect(laterWindow).toHaveBeenCalledTimes(2);
  });
});
