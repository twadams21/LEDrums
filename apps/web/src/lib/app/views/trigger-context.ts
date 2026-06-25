/* Context key the Trigger Graph view uses to hand the live TriggerLab store down to
   its xyflow custom nodes. xyflow renders node components as descendants of
   <SvelteFlow>, so a setContext() on the view reaches every TriggerNode — letting a
   node read its live model (effect name, preset, params for the thumb) reactively
   instead of freezing a snapshot into xyflow `data`. */
import type { TriggerLab } from '../../trigger-lab/store.svelte';

export const TRIGGER_STORE_KEY = Symbol('ledrums.trigger-store');

/** Typed getContext helper so nodes don't repeat the cast. */
export type TriggerStoreContext = TriggerLab;
