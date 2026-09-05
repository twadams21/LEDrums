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

afterEach(cleanup);

const LIVE: TunnelInfo = { status: 'live', url: 'https://foo.trycloudflare.com', pin: '4821' };

function key(target: EventTarget, keyName: string, init: KeyboardEventInit = {}): KeyboardEvent {
  const event = new KeyboardEvent('keydown', { key: keyName, bubbles: true, cancelable: true, ...init });
  target.dispatchEvent(event);
  return event;
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

    key(overlay, '1');
    key(overlay, 'Backspace');
    key(overlay, 'd', { metaKey: true });

    expect(store.fireSectionGraph).not.toHaveBeenCalled();
    expect(store.removeNode).not.toHaveBeenCalled();
    expect(duplicate).not.toHaveBeenCalled();
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

    expect(popover.closest('[data-keyboard-owner="popover"]')).not.toBeNull();
    key(popover, '1');
    key(popover, 'Backspace');
    key(popover, 'd', { metaKey: true });

    expect(store.fireSectionGraph).not.toHaveBeenCalled();
    expect(store.removeNode).not.toHaveBeenCalled();
    expect(duplicate).not.toHaveBeenCalled();
  });

  it('suppresses every background action inside the real portalled ContextMenu menu', async () => {
    const { store, duplicate } = fixture();
    const actions = [{ label: 'Rename', onSelect: vi.fn() }];
    const children = createRawSnippet(() => ({ render: () => '<span>row</span>' }));
    const { container } = render(ContextMenu, { props: { actions, children } });
    await fireEvent.contextMenu(container.querySelector('.ctx-anchor')!);
    const menu = await waitFor(() => screen.getByRole('menu'));
    const item = screen.getByRole('menuitem');

    expect(menu.getAttribute('data-keyboard-owner')).toBe('menu');
    expect(item.getAttribute('data-keyboard-owner')).toBe('menuitem');
    key(item, '1');
    key(item, 'Backspace');
    key(item, 'd', { metaKey: true });

    expect(store.fireSectionGraph).not.toHaveBeenCalled();
    expect(store.removeNode).not.toHaveBeenCalled();
    expect(duplicate).not.toHaveBeenCalled();
  });

  it('suppresses every background action inside the shared Dialog and native open dialog', () => {
    const { store, duplicate } = fixture();
    const children = createRawSnippet(() => ({ render: () => '<button>dialog action</button>' }));
    render(Dialog, { props: { open: true, title: 'Dialog', children } });
    const content = document.querySelector('[data-keyboard-owner="modal"]')!;

    key(content, '1');
    key(content, 'Backspace');
    key(content, 'd', { metaKey: true });

    const native = document.body.appendChild(document.createElement('dialog'));
    native.setAttribute('open', '');
    key(native, '1');
    key(native, 'Backspace');
    key(native, 'd', { metaKey: true });
    native.remove();

    expect(store.fireSectionGraph).not.toHaveBeenCalled();
    expect(store.removeNode).not.toHaveBeenCalled();
    expect(duplicate).not.toHaveBeenCalled();
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
});
