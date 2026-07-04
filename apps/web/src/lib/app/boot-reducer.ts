/* Pure boot/update state reducer for the desktop bridge (S06).
 *
 * The Rust side publishes `boot://status` events and answers `get_boot_status` with a snapshot;
 * the web `desktop-bridge` folds those, plus update-availability from `check_for_update_now`, into
 * one reactive `bootStatus`. All the merge/transition logic lives here as a pure function so it is
 * unit-testable without Tauri or the Svelte runtime. The reactive wrapper (desktop-bridge.svelte.ts)
 * owns nothing but the `$state` cell and the adapter wiring. */

export type BootStage = 'starting' | 'running' | 'no-tunnel' | 'updating' | 'error';

/** The reactive boot/update state the app renders from. */
export interface BootStatus {
  stage: BootStage;
  /** Human-readable detail — failure text on `error`, "Downloading… N%" while `updating`. */
  message: string | null;
  /** Download progress 0–100 while `updating`; `null` at every other stage. */
  progressPct: number | null;
  /** Bytes downloaded so far / total content length while `updating` (when the updater reports a
   *  content length); `null` at every other stage. Drives the "123 / 144 MB" size readout. */
  downloadedBytes: number | null;
  totalBytes: number | null;
  localUrl: string | null;
  tunnelUrl: string | null;
  pin: string | null;
  /** Whether the startup OTA check found a newer build (from `checkForUpdate`, not the boot event). */
  updateAvailable: boolean;
  /** The available version string, when known. */
  updateVersion: string | null;
}

/** Raw payload shape emitted by Rust `boot://status` / returned by `get_boot_status`.
 * Serde renames make these camelCase; every field is optional/nullable on the wire.
 * `updateAvailable`/`updateVersion` ride the boot event only when the Rust startup OTA check
 * finds a newer build (skip-serialized otherwise) — that's how startup availability reaches the
 * in-app badge without a native dialog (S07). */
export interface TauriBootPayload {
  stage?: BootStage;
  message?: string | null;
  progressPct?: number | null;
  downloadedBytes?: number | null;
  totalBytes?: number | null;
  localUrl?: string | null;
  tunnelUrl?: string | null;
  pin?: string | null;
  updateAvailable?: boolean;
  updateVersion?: string | null;
}

/** Events the reducer folds into `BootStatus`. `snapshot` and `status` share merge semantics — the
 * distinction is kept for readers/tests (snapshot = the one-shot `get_boot_status`, status = a live
 * `boot://status` event). */
export type BridgeEvent =
  | { kind: 'snapshot'; payload: TauriBootPayload }
  | { kind: 'status'; payload: TauriBootPayload }
  | { kind: 'update-available'; version: string | null }
  | { kind: 'update-unavailable' };

export const initialBootStatus: BootStatus = {
  stage: 'starting',
  message: null,
  progressPct: null,
  downloadedBytes: null,
  totalBytes: null,
  localUrl: null,
  tunnelUrl: null,
  pin: null,
  updateAvailable: false,
  updateVersion: null,
};

/** Fold one bridge event into the boot status. Pure — never mutates its input.
 *
 * Merge rule for boot payloads: a field the payload doesn't carry (`undefined`) is kept from prior
 * state; a null-but-present field is treated the same as absent for the "sticky" fields
 * (localUrl/tunnelUrl/pin) so an `updating` payload — which Rust rebuilds fresh with only
 * stage+message+progress — never wipes the URL/PIN learned during boot. `progressPct` is only
 * meaningful while `updating`, so it is cleared whenever the stage is anything else.
 * `updateAvailable`/`updateVersion` are likewise sticky: only a payload that carries them (the
 * startup availability publish) changes them, so an ordinary boot event never clears the badge. */
export function reduceBoot(state: BootStatus, event: BridgeEvent): BootStatus {
  switch (event.kind) {
    case 'snapshot':
    case 'status': {
      const p = event.payload;
      // An empty stage (e.g. a bare availability publish before the sidecar set one) is treated as
      // absent so it can never overwrite a real stage with an invalid value.
      const stage = p.stage ? p.stage : state.stage;
      const next: BootStatus = {
        ...state,
        stage,
        message: p.message !== undefined ? p.message : state.message,
        localUrl: p.localUrl ?? state.localUrl,
        tunnelUrl: p.tunnelUrl ?? state.tunnelUrl,
        pin: p.pin ?? state.pin,
        progressPct: p.progressPct !== undefined ? p.progressPct : state.progressPct,
        downloadedBytes:
          p.downloadedBytes !== undefined ? p.downloadedBytes : state.downloadedBytes,
        totalBytes: p.totalBytes !== undefined ? p.totalBytes : state.totalBytes,
        updateAvailable: p.updateAvailable !== undefined ? p.updateAvailable : state.updateAvailable,
        updateVersion: p.updateVersion !== undefined ? p.updateVersion : state.updateVersion,
      };
      // Progress + byte counts are only meaningful while updating; clear them at every other stage.
      if (stage !== 'updating') {
        next.progressPct = null;
        next.downloadedBytes = null;
        next.totalBytes = null;
      }
      return next;
    }
    case 'update-available':
      return { ...state, updateAvailable: true, updateVersion: event.version };
    case 'update-unavailable':
      return { ...state, updateAvailable: false, updateVersion: null };
  }
}
