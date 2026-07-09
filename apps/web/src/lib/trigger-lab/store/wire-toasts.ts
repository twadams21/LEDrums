/* Rejection-reason copy for wire drops (R03 / doc 1.1). When the store refuses a wire, the graph
   view surfaces *why* in one plain-language toast — reusing the R02 toast conventions (one toast
   per user-visible event, plain language, states what's wrong). This is the single place the
   three rejection reasons become sentences, kept pure + DOM-free so it unit-tests without a store
   or host. The emission itself (tone `error`) lives at the view seam that owns the drag. */

import type { WireRejection } from './graph-wiring';

/** The plain-language message for a refused wire — states what's wrong, no jargon. Exhaustive
    over {@link WireRejection}, so a new reason is a compile error here until it has copy. */
export function wireRejectionMessage(reason: WireRejection): string {
  switch (reason) {
    case 'direction':
      return "Can't wire that way — connect an output into an input.";
    case 'duplicate':
      return 'Those are already wired together.';
    case 'cycle':
      return "That would loop the signal back on itself.";
  }
}
