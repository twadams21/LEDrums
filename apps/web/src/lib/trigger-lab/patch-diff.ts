/* Patch diff (group K / S45): the change summary shown in the paste-patch confirm dialog BEFORE a
   `setProject` is sent. A patch re-rigs the physical device wholesale (kit incl. outputs, input
   map, output settings), so the user must SEE what changes — drum count, total pixels, the output
   host, and the protocol — and confirm explicitly before the live rig is re-wired. Pure + tested;
   the dialog only renders these rows. */

import { buildPixelModel, type Project } from '@ledrums/core';
import type { PatchPayload } from './clipdoc';

/** One before→after comparison line. `changed` drives the row's "this differs" emphasis. */
export interface PatchDiffRow {
  key: 'drums' | 'pixels' | 'host' | 'protocol';
  label: string;
  from: string;
  to: string;
  changed: boolean;
}

export interface PatchDiff {
  /** The incoming patch's project name, or null when it carries none. */
  name: string | null;
  rows: PatchDiffRow[];
  /** True when ANY row differs from the current rig (a no-change paste still confirms, but the
      dialog can note "no changes"). */
  hasChanges: boolean;
}

/** Total pixel count a kit expands to, or null when the topology can't be built (a foreign/
    malformed kit that the server would reject anyway — the dialog shows "—" rather than throwing). */
function totalPixels(kit: Project['kit']): number | null {
  try {
    return buildPixelModel(kit).pixelCount;
  } catch {
    return null;
  }
}

function px(count: number | null): string {
  return count === null ? '—' : count.toLocaleString('en-US');
}

/**
 * Diff the incoming patch against the current rig. `current` is null when offline (no live
 * project yet) — every row then reads from "—", so the dialog still shows what the paste WOULD
 * install. The four rows mirror the acceptance summary: drum count, pixel totals, output host,
 * protocol.
 */
export function diffPatch(current: Project | null, incoming: PatchPayload): PatchDiff {
  const rows: PatchDiffRow[] = [
    {
      key: 'drums',
      label: 'Drums',
      from: current ? String(current.kit.drums.length) : '—',
      to: String(incoming.kit.drums.length),
      changed: !!current && current.kit.drums.length !== incoming.kit.drums.length,
    },
    {
      key: 'pixels',
      label: 'Pixels',
      from: current ? px(totalPixels(current.kit)) : '—',
      to: px(totalPixels(incoming.kit)),
      changed: !!current && px(totalPixels(current.kit)) !== px(totalPixels(incoming.kit)),
    },
    {
      key: 'host',
      label: 'Output host',
      from: current ? current.output.host : '—',
      to: incoming.output.host,
      changed: !!current && current.output.host !== incoming.output.host,
    },
    {
      key: 'protocol',
      label: 'Protocol',
      from: current ? current.output.protocol.toUpperCase() : '—',
      to: incoming.output.protocol.toUpperCase(),
      changed: !!current && current.output.protocol !== incoming.output.protocol,
    },
  ];
  return {
    name: incoming.name ?? null,
    rows,
    hasChanges: rows.some((r) => r.changed),
  };
}
