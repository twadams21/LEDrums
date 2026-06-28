// @vitest-environment jsdom
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/svelte';
import type { TriggerLab } from '../../trigger-lab/store.svelte';
import ShareInfo from './ShareInfo.svelte';

/* ShareInfo folds the share URL + PIN behind a single Share button that opens a Bits UI
   Popover (portaled to <body>, queried via `screen`). Bits UI's floating content needs a
   few browser APIs jsdom lacks — stub them so the popover mounts. */
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

function mockStore(tunnel: { url: string | null; pin: string | null } | null): TriggerLab {
  return { tunnel } as unknown as TriggerLab;
}

const TUNNEL = { url: 'https://foo.trycloudflare.com', pin: '4821' };

describe('ShareInfo', () => {
  it('renders nothing when there is no tunnel url or pin', () => {
    render(ShareInfo, { props: { store: mockStore(null) } });
    expect(screen.queryByLabelText('Share room link and PIN')).toBeNull();
  });

  it('renders nothing when the tunnel has neither url nor pin', () => {
    render(ShareInfo, { props: { store: mockStore({ url: null, pin: null }) } });
    expect(screen.queryByLabelText('Share room link and PIN')).toBeNull();
  });

  it('shows a Share button (and no inline url/pin) when a tunnel exists', () => {
    render(ShareInfo, { props: { store: mockStore(TUNNEL) } });
    expect(screen.getByLabelText('Share room link and PIN')).toBeTruthy();
    // The url/pin are folded away until the popover opens.
    expect(screen.queryByText(TUNNEL.url)).toBeNull();
  });

  it('reveals the url and pin in a popover when the Share button is clicked', async () => {
    render(ShareInfo, { props: { store: mockStore(TUNNEL) } });
    await fireEvent.click(screen.getByLabelText('Share room link and PIN'));
    expect(await screen.findByText(TUNNEL.url)).toBeTruthy();
    expect(screen.getByText(TUNNEL.pin)).toBeTruthy();
  });

  it('copies the url and the pin from their own copy buttons', async () => {
    render(ShareInfo, { props: { store: mockStore(TUNNEL) } });
    await fireEvent.click(screen.getByLabelText('Share room link and PIN'));
    await screen.findByText(TUNNEL.url);

    await fireEvent.click(screen.getByLabelText('Copy URL'));
    expect(writeText).toHaveBeenLastCalledWith(TUNNEL.url);

    await fireEvent.click(screen.getByLabelText('Copy PIN'));
    expect(writeText).toHaveBeenLastCalledWith(TUNNEL.pin);
  });

  it('only offers the pin row when there is no url', async () => {
    render(ShareInfo, { props: { store: mockStore({ url: null, pin: '4821' }) } });
    await fireEvent.click(screen.getByLabelText('Share room link and PIN'));
    expect(await screen.findByText('4821')).toBeTruthy();
    expect(screen.queryByLabelText('Copy URL')).toBeNull();
    expect(screen.getByLabelText('Copy PIN')).toBeTruthy();
  });

  it('closes the popover on Escape', async () => {
    render(ShareInfo, { props: { store: mockStore(TUNNEL) } });
    await fireEvent.click(screen.getByLabelText('Share room link and PIN'));
    const url = await screen.findByText(TUNNEL.url);
    await fireEvent.keyDown(document.activeElement ?? document.body, { key: 'Escape' });
    await waitFor(() => expect(url.isConnected).toBe(false));
  });
});
