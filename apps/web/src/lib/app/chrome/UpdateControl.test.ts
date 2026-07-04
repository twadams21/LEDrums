// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';
import { render, fireEvent, waitFor } from '@testing-library/svelte';
import { createDesktopBridge, type DesktopAdapter, type UpdateCheckResult } from '../desktop-bridge.svelte';
import type { TauriBootPayload } from '../boot-reducer';
import UpdateControl from './UpdateControl.svelte';

/* UpdateControl is the single desktop-update flow (S07). These tests drive it THROUGH the bridge
   with a fake adapter — no Tauri — asserting the progress bar reflects streamed percentages and the
   install action routes through the host. */

interface Fake {
  adapter: DesktopAdapter;
  invoked: string[];
  emit: (payload: TauriBootPayload) => void;
}

function fakeAdapter(opts: { snapshot?: TauriBootPayload | null; checkResult?: UpdateCheckResult } = {}): Fake {
  let handler: ((p: unknown) => void) | null = null;
  const invoked: string[] = [];
  const adapter: DesktopAdapter = {
    invoke: async <T>(command: string): Promise<T> => {
      invoked.push(command);
      if (command === 'get_boot_status') return (opts.snapshot ?? null) as T;
      if (command === 'check_for_update_now') return (opts.checkResult ?? { available: false, version: null }) as T;
      if (command === 'install_update_now') return undefined as T;
      throw new Error(`unexpected ${command}`);
    },
    listen: async (name, h) => {
      if (name === 'boot://status') handler = h;
      return () => (handler = null);
    },
  };
  return { adapter, invoked, emit: (p) => handler?.(p) };
}

describe('UpdateControl', () => {
  it('reflects streamed download percentages on the progress bar (through the bridge)', async () => {
    const fake = fakeAdapter({ snapshot: { stage: 'running', localUrl: 'http://local' } });
    const bridge = createDesktopBridge();
    await bridge.start(async () => fake.adapter);

    const { container } = render(UpdateControl, { props: { bridge } });

    for (const pct of [0, 40, 100]) {
      fake.emit({ stage: 'updating', message: `Downloading update… ${pct}%`, progressPct: pct });
      await waitFor(() => {
        const bar = container.querySelector('[role="progressbar"]');
        expect(bar?.getAttribute('aria-valuenow')).toBe(String(pct));
        expect((container.querySelector('.fill') as HTMLElement).style.width).toBe(`${pct}%`);
      });
    }
  });

  it('installs only on user action and never before', async () => {
    const fake = fakeAdapter({ snapshot: { stage: 'running', updateAvailable: true, updateVersion: '2.0.0' } });
    const bridge = createDesktopBridge();
    await bridge.start(async () => fake.adapter);

    const { getByRole } = render(UpdateControl, { props: { bridge } });
    expect(fake.invoked).not.toContain('install_update_now');

    await fireEvent.click(getByRole('button', { name: /install/i }));
    await waitFor(() => expect(fake.invoked).toContain('install_update_now'));
  });

  it('degrades to a muted note in a plain browser (no host)', async () => {
    const bridge = createDesktopBridge();
    await bridge.start(async () => null); // locked non-desktop; onMount's start() is idempotent
    const { queryByText, queryByRole } = render(UpdateControl, { props: { bridge } });
    expect(queryByText(/desktop app/i)).not.toBeNull();
    expect(queryByRole('button')).toBeNull();
  });
});
