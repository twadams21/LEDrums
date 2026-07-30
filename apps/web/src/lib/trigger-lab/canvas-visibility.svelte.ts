/* The two gates every canvas preview in the lab shares: is it on screen, and does the operator
   want motion at all. EffectThumb and SignalFace each carried their own copy of both — 52 lines
   including a subtle correctness guard, which is exactly the kind of fix that gets applied to one
   copy and not the other.

   Both helpers create a `$state` + `$effect`, so they MUST be called during component init
   (top level of <script>), not inside a handler or a nested effect. Teardown is the effect's own,
   so a component that unmounts disconnects its observer and drops its listener automatically. */

/** Is `getEl()`'s element on screen?
 *
 *  Starts `true` and — THIS IS THE LOAD-BEARING PART — only ever goes false AFTER the element has
 *  been confirmed visible at least once. A portaled panel (dialog, drawer) fires a spurious
 *  pre-layout `isIntersecting: false` before it is laid out; without the guard that first false
 *  would kill the ticker subscription of a preview that is, in fact, about to be visible.
 *
 *  Falls back to permanently-visible where IntersectionObserver does not exist (jsdom, SSR),
 *  which is the safe direction: draw rather than silently freeze. */
export function elementVisibility(getEl: () => HTMLElement | undefined): { readonly current: boolean } {
  let visible = $state(true);

  $effect(() => {
    const el = getEl();
    if (!el) return;

    let hasBeenVisible = false;

    const observer =
      typeof IntersectionObserver !== 'undefined'
        ? new IntersectionObserver(([entry]) => {
            if (entry) {
              if (entry.isIntersecting) {
                hasBeenVisible = true;
                visible = true;
              } else if (hasBeenVisible) {
                visible = false;
              }
              // Pre-layout false: hasBeenVisible is still false → leave `visible` true.
            }
          })
        : null;

    if (observer) {
      observer.observe(el);
      return () => observer.disconnect();
    }
  });

  return {
    get current() {
      return visible;
    },
  };
}

/** Does the operator prefer reduced motion? Live — it tracks changes to the media query, so a
 *  preference flipped mid-session takes effect without a reload. False where matchMedia does not
 *  exist (jsdom, SSR). */
export function prefersReducedMotion(): { readonly current: boolean } {
  let reduced = $state(false);

  $effect(() => {
    const mq = typeof matchMedia !== 'undefined' ? matchMedia('(prefers-reduced-motion: reduce)') : null;
    if (!mq) return;

    const handler = (): void => {
      reduced = mq.matches;
    };
    handler(); // seed from the current value

    mq.addEventListener('change', handler);
    return () => mq.removeEventListener('change', handler);
  });

  return {
    get current() {
      return reduced;
    },
  };
}
