/* `mappable` — the Svelte attachment that makes a control MIDI-mappable (effect chains S07b).

   <button {@attach mappable({ target: { kind: 'fireCell', cell }, kind: 'button', label: 'Kick · Center' })}>

   While map mode is on, the overlay outlines every registered control, shows its binding, and
   turns a click on it into "arm for learn" instead of the control's own action. Outside map
   mode the attachment does nothing but keep the registration. Re-evaluating the spec (a cell
   moved, a param renamed) re-registers it: Svelte re-runs an attachment when its argument
   expression changes. */

import type { Attachment } from 'svelte/attachments';
import type { MappableSpec } from '../../trigger-lab/map-api';
import { mapRegistry, type MapRegistry } from './registry.svelte';

export function mappable(spec: MappableSpec, registry: MapRegistry = mapRegistry): Attachment<HTMLElement> {
  return (node) => {
    node.dataset.mappable = spec.kind;
    const unregister = registry.register(node, spec);
    return () => {
      unregister();
      delete node.dataset.mappable;
    };
  };
}
