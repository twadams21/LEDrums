/* THE one way a canvas-drawing component resolves design-token colours (phase-2 item 1b).
   Canvas can't read CSS custom properties directly, so components sample them off a live
   element with getComputedStyle. Two components hand-rolled this and both independently
   re-invented the SAME app-fatal bug: an `$effect` that read its own reactive colour state
   as the fallback while writing it (`c = { x: read('--tok', c.x) }`) → self-referential →
   `effect_update_depth_exceeded` → Svelte halts effect flush app-wide and every delegated
   onclick dies (fixed in 6d19f14 / 6c4bc06). This helper makes that idiom unwritable: the
   fallbacks are a FIXED map the caller passes in, never reactive state.

   Usage (inside a component):
     const FALLBACKS = { signal: '#7c9cff', track: '#3a4056' };
     let c = $state({ ...FALLBACKS });
     $effect(() => { c = readThemeTokens(root, { signal: '--role-modulation', track: '--border-faint' }, FALLBACKS); });
*/

/** Resolve each named token (`tokens[key]` = the CSS custom-property name) from `el`'s
    computed style, falling back to the FIXED `fallbacks[key]` when the property is empty
    (pre-layout, tests, missing token). Never reads reactive state — pass literal fallbacks. */
export function readThemeTokens<K extends string>(
  el: Element | null | undefined,
  tokens: Record<K, string>,
  fallbacks: Record<K, string>,
): Record<K, string> {
  if (!el || typeof getComputedStyle === 'undefined') return { ...fallbacks };
  const cs = getComputedStyle(el);
  const out = {} as Record<K, string>;
  for (const key of Object.keys(tokens) as K[]) {
    out[key] = cs.getPropertyValue(tokens[key]).trim() || fallbacks[key];
  }
  return out;
}
