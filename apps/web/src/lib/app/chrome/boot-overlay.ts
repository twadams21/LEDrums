/* Pure view mapping for the desktop boot overlay (S08).
 *
 * Turns the desktop bridge's reactive {@link BootStatus} into the small view model BootOverlay.svelte
 * renders — or `null` when no overlay should show. Kept pure (no Svelte, no singleton) so every
 * stage → view decision is unit-testable without the runtime.
 *
 * `active` is the bridge's `isDesktop` flag: the overlay only ever shows inside the desktop shell.
 * In a plain browser (`active === false`) the stage stays at its `starting` default forever, so
 * gating on `active` is what stops the overlay from permanently covering the web app. */

import type { BootStatus } from '../boot-reducer';

export type BootOverlayVariant = 'starting' | 'updating' | 'error';

export interface BootOverlayView {
  variant: BootOverlayVariant;
  title: string;
  message: string;
  /** Download progress 0–100 while `updating`; `null` otherwise (and while updating with an unknown
   *  percentage — the bar then renders indeterminate). */
  progressPct: number | null;
  /** Bytes downloaded / total content length while `updating`, when the updater reports a content
   *  length; `null` otherwise. Drives the "123 / 144 MB" size readout under the bar. */
  downloadedBytes: number | null;
  totalBytes: number | null;
}

export function computeBootOverlay(active: boolean, status: BootStatus): BootOverlayView | null {
  if (!active) return null;
  switch (status.stage) {
    case 'starting':
      return {
        variant: 'starting',
        title: 'Starting LEDrums',
        message: status.message ?? 'Bringing the lighting engine online…',
        progressPct: null,
        downloadedBytes: null,
        totalBytes: null,
      };
    case 'updating':
      return {
        variant: 'updating',
        title: 'Updating LEDrums',
        message:
          status.message ?? 'Downloading the latest version. The app will restart automatically.',
        progressPct: clampPct(status.progressPct),
        downloadedBytes: status.downloadedBytes,
        totalBytes: status.totalBytes,
      };
    case 'error':
      return {
        variant: 'error',
        title: 'Something went wrong',
        message:
          status.message ??
          'The server failed to start. Quit and reopen the app; if it persists, check the logs.',
        progressPct: null,
        downloadedBytes: null,
        totalBytes: null,
      };
    // running / no-tunnel: the app itself is up and visible — no overlay.
    default:
      return null;
  }
}

function clampPct(pct: number | null): number | null {
  if (pct === null || Number.isNaN(pct)) return null;
  return Math.max(0, Math.min(100, pct));
}
