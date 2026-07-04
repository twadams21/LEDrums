/* desktop-bridge — the web app's single source of desktop boot + update state (S06).
 *
 * Deepened from the old `desktop-updater` helper. It owns a reactive `bootStatus` fed by two
 * sources: a one-shot `get_boot_status` snapshot and a live subscription to the existing
 * `boot://status` Tauri event, both folded through the pure {@link reduceBoot} reducer. It also
 * exposes the update actions (`checkForUpdate`, `installUpdate`) and an `isDesktop` flag.
 *
 * In a plain browser there is no Tauri: the adapter loads as `null`, `isDesktop` stays false, and
 * `bootStatus` remains at its `starting` default. All Tauri access goes through the injectable
 * {@link DesktopAdapter} seam so tests can drive the bridge with a fake invoke/event pair — the
 * `@tauri-apps/api` modules are dynamic-imported (never a hard dependency of the web bundle).
 *
 * This bridge is CONSUMED by S07 (settings progress) and S08 (boot overlay + share gating); it
 * changes no UI on its own. */

import {
  reduceBoot,
  initialBootStatus,
  type BootStatus,
  type BridgeEvent,
  type TauriBootPayload,
} from './boot-reducer';

export type { BootStatus, BootStage } from './boot-reducer';

export interface UpdateCheckResult {
  available: boolean;
  version: string | null;
  currentVersion?: string | null;
  canInstall?: boolean;
  error?: string;
}

/** The seam over Tauri the bridge depends on — real in the app, faked in tests.
 * `listen` resolves to an unlisten function; `invoke` rejects on command failure (like Tauri's). */
export interface DesktopAdapter {
  invoke<T>(command: string): Promise<T>;
  listen(event: string, handler: (payload: unknown) => void): Promise<() => void>;
}

/** Build the real Tauri adapter, or `null` in a plain browser (no `@tauri-apps` present).
 * Dynamic-imported so the web bundle never hard-depends on Tauri. */
export async function loadTauriAdapter(): Promise<DesktopAdapter | null> {
  try {
    const core = await import('@tauri-apps/api/core');
    const event = await import('@tauri-apps/api/event');
    return {
      invoke: <T>(command: string) => core.invoke<T>(command),
      listen: (name, handler) =>
        event.listen(name, (e) => handler((e as { payload: unknown }).payload)),
    };
  } catch {
    return null;
  }
}

export class DesktopBridge {
  private _status = $state<BootStatus>({ ...initialBootStatus });
  private _isDesktop = $state(false);
  private adapter: DesktopAdapter | null = null;
  private unlisten: (() => void) | null = null;
  private startPromise: Promise<void> | null = null;

  /** The live, reactive boot/update state. */
  get bootStatus(): BootStatus {
    return this._status;
  }

  /** True once a Tauri adapter has loaded (i.e. we're running inside the desktop shell). */
  get isDesktop(): boolean {
    return this._isDesktop;
  }

  /** Directly fold an event into state — used internally and by tests. */
  dispatch(event: BridgeEvent): void {
    this._status = reduceBoot(this._status, event);
  }

  /** Connect to the desktop host: subscribe to `boot://status`, then pull the current snapshot.
   * Idempotent (repeated calls await the first). `loadAdapter` is injectable for tests; it defaults
   * to the real Tauri loader. Subscribing before the snapshot means no status published between the
   * two calls is lost. */
  async start(loadAdapter: () => Promise<DesktopAdapter | null> = loadTauriAdapter): Promise<void> {
    if (this.startPromise) return this.startPromise;
    this.startPromise = this.#start(loadAdapter);
    return this.startPromise;
  }

  async #start(loadAdapter: () => Promise<DesktopAdapter | null>): Promise<void> {
    const adapter = await loadAdapter();
    this.adapter = adapter;
    this._isDesktop = adapter !== null;
    if (!adapter) return;

    try {
      this.unlisten = await adapter.listen('boot://status', (payload) =>
        this.dispatch({ kind: 'status', payload: (payload ?? {}) as TauriBootPayload }),
      );
      const snapshot = await adapter.invoke<TauriBootPayload | null>('get_boot_status');
      if (snapshot) this.dispatch({ kind: 'snapshot', payload: snapshot });
    } catch {
      // A transient wiring failure must not crash the app; the bridge just stays at its default.
    }
  }

  /** Ask the host whether a newer build is available, folding the result into `bootStatus`.
   * Returns `null` in a plain browser (no desktop updater). */
  async checkForUpdate(): Promise<UpdateCheckResult | null> {
    if (!this.adapter) return null;
    try {
      const result = await this.adapter.invoke<UpdateCheckResult>('check_for_update_now');
      this.dispatch(
        result?.available
          ? { kind: 'update-available', version: result.version ?? null }
          : { kind: 'update-unavailable' },
      );
      return result ? { ...result, canInstall: true } : null;
    } catch (error) {
      return { available: false, version: null, error: errorMessage(error) };
    }
  }

  /** Trigger the host's download + install. Returns whether it started; the host restarts on
   * success, and download progress arrives via `bootStatus.progressPct` through `boot://status`. */
  async installUpdate(): Promise<boolean> {
    if (!this.adapter) return false;
    try {
      await this.adapter.invoke<void>('install_update_now');
      return true;
    } catch {
      return false;
    }
  }

  /** Tear down the event subscription (mainly for tests / hot-reload). */
  stop(): void {
    this.unlisten?.();
    this.unlisten = null;
  }
}

function errorMessage(error: unknown): string {
  if (error instanceof Error) return error.message;
  return typeof error === 'string' ? error : 'update check failed';
}

/** Fresh, isolated bridge — used by tests so runes state never leaks between cases. */
export function createDesktopBridge(): DesktopBridge {
  return new DesktopBridge();
}

/** App-wide singleton. Call `.start()` once during app boot (S07/S08 wire this up). */
export const desktopBridge = createDesktopBridge();
