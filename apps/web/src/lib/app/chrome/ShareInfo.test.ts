// @vitest-environment jsdom
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/svelte';
import type { TunnelInfo } from '../../ws/protocol-types';
import type { TriggerLab } from '../../trigger-lab/store.svelte';
import ShareInfo from './ShareInfo.svelte';

/* ShareInfo folds the share surface behind a single Share button that opens a Bits UI
   Popover (portaled to <body>, queried via `screen`), now with the item-4 lifecycle:
   off → Start sharing; starting → progress; live → url+pin+copy+Stop; error → explanation
   + retry. Bits UI's floating content needs a few browser APIs jsdom lacks — stub them. */
const writeText = vi.fn<(text: string) => Promise<void>>().mockResolvedValue(undefined);

beforeAll(() => {
  class ResizeObserverStub {
    observe(): void {}
    unobserve(): void {}
    disconnect(): void {}
  }
  vi.stubGlobal('ResizeObserver', ResizeObserverStub);
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
  Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true });
});

afterEach(() => writeText.mockClear());

function mockStore(tunnel: TunnelInfo | null, opts: { isViewer?: boolean } = {}) {
  const setSharing = vi.fn<(on: boolean) => void>();
  const store = { tunnel, isViewer: opts.isViewer ?? false, setSharing } as unknown as TriggerLab;
  return { store, setSharing };
}

const openShare = async (): Promise<void> => {
  await fireEvent.click(screen.getByLabelText('Share room'));
};

const LIVE: TunnelInfo = { status: 'live', url: 'https://foo.trycloudflare.com', pin: '4821' };
const OFF: TunnelInfo = { status: 'off', url: null, pin: null };

describe('ShareInfo', () => {
  it('renders nothing only when the server reports no tunnel surface at all', () => {
    render(ShareInfo, { props: { store: mockStore(null).store } });
    expect(screen.queryByLabelText('Share room')).toBeNull();
  });

  it('is ALWAYS visible when a tunnel surface exists — even fully off', async () => {
    render(ShareInfo, { props: { store: mockStore(OFF).store } });
    expect(screen.getByLabelText('Share room')).toBeTruthy();
  });

  it('off → offers Start sharing, which sends the start control', async () => {
    const { store, setSharing } = mockStore(OFF);
    render(ShareInfo, { props: { store } });
    await openShare();
    const btn = await screen.findByText('Start sharing');
    await fireEvent.click(btn);
    expect(setSharing).toHaveBeenCalledWith(true);
  });

  it('off + viewer → Start sharing is disabled with an explanation', async () => {
    const { store } = mockStore(OFF, { isViewer: true });
    render(ShareInfo, { props: { store } });
    await openShare();
    const btn = (await screen.findByText('Start sharing')) as HTMLButtonElement;
    expect(btn.disabled).toBe(true);
    expect(screen.getByText(/Only the editor/)).toBeTruthy();
  });

  it('starting → shows a progress note (no start/stop action)', async () => {
    const { store } = mockStore({ status: 'starting', url: null, pin: '4821' });
    render(ShareInfo, { props: { store } });
    await openShare();
    expect(await screen.findByText(/Starting the share tunnel/)).toBeTruthy();
    expect(screen.queryByText('Start sharing')).toBeNull();
    expect(screen.queryByText('Stop sharing')).toBeNull();
  });

  it('error → explains itself and offers Try again', async () => {
    const { store, setSharing } = mockStore({ status: 'error', url: null, pin: null, error: 'cloudflared was not found.' });
    render(ShareInfo, { props: { store } });
    await openShare();
    expect(await screen.findByText('cloudflared was not found.')).toBeTruthy();
    await fireEvent.click(screen.getByText('Try again'));
    expect(setSharing).toHaveBeenCalledWith(true);
  });

  it('live → reveals the url and pin, and Stop sharing sends the stop control', async () => {
    const { store, setSharing } = mockStore(LIVE);
    render(ShareInfo, { props: { store } });
    await openShare();
    expect(await screen.findByText(LIVE.url!)).toBeTruthy();
    expect(screen.getByText(LIVE.pin!)).toBeTruthy();
    await fireEvent.click(screen.getByText('Stop sharing'));
    expect(setSharing).toHaveBeenCalledWith(false);
  });

  it('Copy invite copies the url and PIN on separate lines in one click', async () => {
    render(ShareInfo, { props: { store: mockStore(LIVE).store } });
    await openShare();
    await screen.findByText(LIVE.url!);
    await fireEvent.click(screen.getByText(/Copy invite/));
    expect(writeText).toHaveBeenLastCalledWith(`${LIVE.url}\nPIN: ${LIVE.pin}`);
  });

  it('copies the url and the pin from their own copy buttons', async () => {
    render(ShareInfo, { props: { store: mockStore(LIVE).store } });
    await openShare();
    await screen.findByText(LIVE.url!);

    await fireEvent.click(screen.getByLabelText('Copy URL'));
    expect(writeText).toHaveBeenLastCalledWith(LIVE.url);

    await fireEvent.click(screen.getByLabelText('Copy PIN'));
    expect(writeText).toHaveBeenLastCalledWith(LIVE.pin);
  });

  it('flips the row to the copied (check) state after a successful copy', async () => {
    render(ShareInfo, { props: { store: mockStore(LIVE).store } });
    await openShare();
    await screen.findByText(LIVE.url!);

    const btn = screen.getByLabelText('Copy URL');
    // Starts on the Copy icon, not the Check icon.
    expect(btn.querySelector('.lucide-check')).toBeNull();
    await fireEvent.click(btn);
    await waitFor(() => expect(btn.querySelector('.lucide-check')).not.toBeNull());
  });

  it('does not flip to the copied state when the Clipboard API is unavailable', async () => {
    // Optional chaining alone would resolve without throwing; the explicit guard must
    // keep the copied state from being set when writeText is missing.
    Object.defineProperty(navigator, 'clipboard', { value: undefined, configurable: true });
    try {
      render(ShareInfo, { props: { store: mockStore(LIVE).store } });
      await openShare();
      await screen.findByText(LIVE.url!);

      const btn = screen.getByLabelText('Copy URL');
      await fireEvent.click(btn);
      expect(writeText).not.toHaveBeenCalled();
      expect(btn.querySelector('.lucide-check')).toBeNull();
    } finally {
      Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true });
    }
  });

  it('a legacy tunnel shape without status still renders live from its url', async () => {
    const legacy = { url: 'https://foo.trycloudflare.com', pin: '4821' } as TunnelInfo;
    render(ShareInfo, { props: { store: mockStore(legacy).store } });
    await openShare();
    expect(await screen.findByText(legacy.url!)).toBeTruthy();
  });

  it('closes the popover on Escape', async () => {
    render(ShareInfo, { props: { store: mockStore(LIVE).store } });
    await openShare();
    const url = await screen.findByText(LIVE.url!);
    await fireEvent.keyDown(document.activeElement ?? document.body, { key: 'Escape' });
    await waitFor(() => expect(url.isConnected).toBe(false));
  });
});
