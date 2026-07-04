// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';
import {
  createDesktopBridge,
  loadTauriAdapter,
  type DesktopAdapter,
  type UpdateCheckResult,
} from './desktop-bridge.svelte';
import type { TauriBootPayload } from './boot-reducer';

/* desktop-bridge driven through a fake invoke/event adapter — no Tauri, no real @tauri-apps import.
   Covers the three seams S07/S08 build on: the browser-null path, the snapshot+stream merge, and the
   progress stream. The test file is `.svelte.ts` so Svelte compiles the runes in the bridge. */

interface FakeAdapter {
  adapter: DesktopAdapter;
  invoked: string[];
  emit: (payload: TauriBootPayload) => void;
  readonly subscribed: boolean;
}

function fakeAdapter(opts: {
  snapshot?: TauriBootPayload | null;
  checkResult?: UpdateCheckResult;
  installThrows?: boolean;
} = {}): FakeAdapter {
  let statusHandler: ((payload: unknown) => void) | null = null;
  const invoked: string[] = [];
  const adapter: DesktopAdapter = {
    invoke: async <T>(command: string): Promise<T> => {
      invoked.push(command);
      if (command === 'get_boot_status') return (opts.snapshot ?? null) as T;
      if (command === 'check_for_update_now')
        return (opts.checkResult ?? { available: false, version: null }) as T;
      if (command === 'install_update_now') {
        if (opts.installThrows) throw new Error('install failed');
        return undefined as T;
      }
      throw new Error(`unexpected command ${command}`);
    },
    listen: async (name, handler) => {
      if (name === 'boot://status') statusHandler = handler;
      return () => {
        statusHandler = null;
      };
    },
  };
  return {
    adapter,
    invoked,
    emit: (payload) => statusHandler?.(payload),
    get subscribed() {
      return statusHandler !== null;
    },
  };
}

describe('DesktopBridge', () => {
  it('stays inert in a plain browser (null adapter)', async () => {
    const bridge = createDesktopBridge();
    await bridge.start(async () => null);
    expect(bridge.isDesktop).toBe(false);
    expect(bridge.bootStatus.stage).toBe('starting');
    expect(await bridge.checkForUpdate()).toBeNull();
    expect(await bridge.installUpdate()).toBe(false);
  });

  it('merges the get_boot_status snapshot then live boot://status events', async () => {
    const fake = fakeAdapter({
      snapshot: { stage: 'running', localUrl: 'http://127.0.0.1:4178', pin: '481923' },
    });
    const bridge = createDesktopBridge();
    await bridge.start(async () => fake.adapter);

    expect(bridge.isDesktop).toBe(true);
    expect(fake.subscribed).toBe(true);
    expect(fake.invoked).toContain('get_boot_status');
    expect(bridge.bootStatus).toMatchObject({ stage: 'running', localUrl: 'http://127.0.0.1:4178', pin: '481923' });

    // A live updating event keeps the snapshot's pin/url but carries progress.
    fake.emit({ stage: 'updating', message: 'Downloading update… 40%', progressPct: 40 });
    expect(bridge.bootStatus).toMatchObject({ stage: 'updating', progressPct: 40, pin: '481923', localUrl: 'http://127.0.0.1:4178' });
  });

  it('reflects a streamed progress sequence via boot://status', async () => {
    const fake = fakeAdapter({ snapshot: { stage: 'running', localUrl: 'http://local' } });
    const bridge = createDesktopBridge();
    await bridge.start(async () => fake.adapter);

    for (const pct of [0, 25, 75, 100]) {
      fake.emit({ stage: 'updating', message: `Downloading update… ${pct}%`, progressPct: pct });
      expect(bridge.bootStatus.progressPct).toBe(pct);
    }
    expect(bridge.bootStatus.localUrl).toBe('http://local');
  });

  it('folds update availability from checkForUpdate and marks it installable', async () => {
    const fake = fakeAdapter({ checkResult: { available: true, version: '1.4.0' } });
    const bridge = createDesktopBridge();
    await bridge.start(async () => fake.adapter);

    const result = await bridge.checkForUpdate();
    expect(result).toMatchObject({ available: true, version: '1.4.0', canInstall: true });
    expect(bridge.bootStatus).toMatchObject({ updateAvailable: true, updateVersion: '1.4.0' });
  });

  it('installUpdate returns true on success and false when the host throws', async () => {
    const ok = createDesktopBridge();
    const okFake = fakeAdapter();
    await ok.start(async () => okFake.adapter);
    expect(await ok.installUpdate()).toBe(true);
    expect(okFake.invoked).toContain('install_update_now');

    const bad = createDesktopBridge();
    await bad.start(async () => fakeAdapter({ installThrows: true }).adapter);
    expect(await bad.installUpdate()).toBe(false);
  });

  it('start is idempotent — the adapter loads once', async () => {
    let loads = 0;
    const fake = fakeAdapter({ snapshot: { stage: 'running' } });
    const bridge = createDesktopBridge();
    const load = async () => {
      loads += 1;
      return fake.adapter;
    };
    await Promise.all([bridge.start(load), bridge.start(load)]);
    await bridge.start(load);
    expect(loads).toBe(1);
  });

  // Regression (group-C review): `@tauri-apps/api` is an installed dep, so importing it resolves in a
  // plain browser too — detecting desktop by import-success mislabelled every browser as the desktop
  // shell and left the boot overlay permanently covering the web app. Detection must key off the
  // Tauri runtime global, absent here in jsdom.
  it('the real loader reports NOT-desktop in a plain browser (no __TAURI_INTERNALS__)', async () => {
    expect('__TAURI_INTERNALS__' in globalThis).toBe(false);
    expect(await loadTauriAdapter()).toBeNull();

    const bridge = createDesktopBridge();
    await bridge.start(); // real default loader, no fake
    expect(bridge.isDesktop).toBe(false);
  });
});
