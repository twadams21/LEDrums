/* Context key the Patch Graph view uses to hand the live TriggerLab store down to its
   xyflow custom nodes. xyflow renders node components as descendants of <SvelteFlow>, so
   a setContext() on the view reaches every PatchNode — letting a node read the live
   rename override (`store.patchLabels[id]`) reactively, so renaming in the Inspector
   updates the node face without a remount. Mirrors trigger-context.ts. */
import type { TriggerLab } from '../../trigger-lab/store.svelte';

export const PATCH_STORE_KEY = Symbol('ledrums.patch-store');

/** Typed getContext helper so nodes don't repeat the cast. */
export type PatchStoreContext = TriggerLab;
