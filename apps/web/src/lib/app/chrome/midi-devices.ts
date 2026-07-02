// Pure presentation logic for the settings MIDI device list. Kept out of the Svelte
// component so the empty-state copy — which explains a browser/permission cause vs. an
// available-but-empty state — is unit-testable without a DOM or real WebMIDI.

/**
 * The message to show when there is no device list to render, or `null` when devices
 * exist and the list should be shown instead.
 *
 * - WebMIDI unavailable → explain the cause: `no-api` means the browser lacks the API;
 *   anything else (a denied/blocked access error) points at the permission.
 * - Available but zero ports → invite hot-plugging (the list refreshes on its own).
 */
export function deviceListEmptyState(
  available: boolean,
  reason: string | undefined,
  deviceCount: number,
): string | null {
  if (!available) {
    return reason === 'no-api'
      ? 'This browser doesn’t support WebMIDI. Try Chrome or Edge to see connected MIDI devices.'
      : 'MIDI access is blocked. Allow MIDI permission in your browser, then reload to list devices.';
  }
  if (deviceCount === 0) {
    return 'No MIDI devices detected. Connect one — the list updates automatically.';
  }
  return null;
}
