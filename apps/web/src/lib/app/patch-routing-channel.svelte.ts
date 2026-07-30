/* The live Patch-graph routing side channel.

   PatchGraphView knows the routing that is actually on screen — including just-added palette
   lines and un-remounted reorders — and the Patch inspectors need it for their first/last-pixel
   read-out, because a re-chunked snapshot of committed outputs has synthetic dataline ids that
   never match the selected node id. One publisher (the view, while it is mounted), two readers
   (PatchOutputInspector, PatchHoopInspector).

   INIT-02 S18 (speculative-generality-0007, second half): this used to live on ShellStore as
   `liveRouting` + `patchRouting` + `setPatchRouting`. A Patch-view side channel is not navigation
   state — it was the only state the navigation store genuinely owned, and it made "which view am
   I on" and "what is the patch graph wired like" the same object's business.

   It stays a FIELD on the shell object (`shell.patch`) rather than a separately-threaded prop:
   re-threading a new prop down through the view tree is more churn and more risk than the
   concern-separation is worth. That is a deliberate trade, not an oversight — the plan surfaces
   it as an open question rather than presenting it as settled. */

import type { PatchRouting } from './patch-routing';

export class PatchRoutingChannel {
  /** The LIVE Patch-graph routing (graph-node-id-keyed datalines + outputs). null when no patch
      view is mounted — a patch node is only selectable from within it, so reads are always fresh. */
  routing = $state<PatchRouting | null>(null);

  /** PatchGraphView publishes its live routing here (null on unmount). */
  publish(r: PatchRouting | null): void {
    this.routing = r;
  }
}
