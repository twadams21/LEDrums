/* System-action toasts (R02): whenever the app migrates or auto-wires a graph on the user's
   behalf, it announces itself in one plain-language toast. This is the EMISSION SEAM — the pure
   hydrate pass computes a {@link SystemActionSummary} (what the app did), and this module turns
   that summary into a single batched message and pushes it. Kept out of the store's mutation
   logic so toast copy lives in one place, and `describeSystemActions` stays unit-testable with no
   DOM/store. One summary ⇒ at most one toast, even when a hydrate normalised several graphs. */

import { pushToast } from '../../ui/toast.svelte';
import type { SystemActionSummary } from './hydrate';

/** Plain-language, batched sentence for the actions a hydrate performed — or `null` when the
    hydrate touched nothing on the user's behalf (so the caller emits no toast). */
export function describeSystemActions(actions: SystemActionSummary): string | null {
  const { migratedGraphs, autoWiredNodes } = actions;
  if (migratedGraphs <= 0 && autoWiredNodes <= 0) return null;

  const parts: string[] = [];
  if (migratedGraphs > 0) {
    parts.push(
      migratedGraphs === 1
        ? 'Graph updated to the Gen3 schema.'
        : `${migratedGraphs} graphs updated to the Gen3 schema.`,
    );
  }
  if (autoWiredNodes > 0) {
    parts.push(
      autoWiredNodes === 1
        ? 'A node was wired up to the Output anchor.'
        : `${autoWiredNodes} nodes were wired up to the Output anchor.`,
    );
  }
  return parts.join(' ');
}

/** Announce a hydrate's system actions as one toast. Returns the toast id, or `null` when there
    was nothing to announce. `push` is injectable so tests assert emission without the shared store. */
export function announceSystemActions(
  actions: SystemActionSummary,
  push: typeof pushToast = pushToast,
): number | null {
  const message = describeSystemActions(actions);
  if (message === null) return null;
  return push(message, { tone: 'info' });
}
