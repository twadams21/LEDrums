<script lang="ts">
  /* The behaviour rules that are contracts, not vibes — what a UI agent must keep
     true when composing or extending the system. */
</script>

<section class="block" id="interaction">
  <div class="block-head">
    <h2>Interaction contract</h2>
    <p>Rules the app already keeps. New UI must keep them too.</p>
  </div>

  <div class="rules">
    <div class="rule">
      <h3>Focus</h3>
      <ul>
        <li>Keyboard focus shows the accent ring (<code>--accent-ring</code>) via <code>:focus-visible</code> — never <code>outline: none</code> without a replacement.</li>
        <li>Dialogs trap focus and restore it on close; Esc closes overlays (Dialog, Drawer, menus).</li>
      </ul>
    </div>

    <div class="rule">
      <h3>Keyboard</h3>
      <ul>
        <li>Keys <code>1–9</code>/<code>0</code> fire the active section's graphs 1–10 (perform surface).</li>
        <li><code>Enter</code> commits · <code>Esc</code> reverts (CommitInput, EditableRow rename).</li>
        <li>Splitters: arrow keys nudge (<code>step</code> px), <code>Home</code>/<code>End</code> jump to min/max — WAI-ARIA window-splitter semantics.</li>
        <li><code>Delete</code>/<code>Backspace</code> removes the graph selection.</li>
      </ul>
    </div>

    <div class="rule">
      <h3>Density &amp; sizing</h3>
      <ul>
        <li>13px body (<code>--text-base</code>), 4px spacing grid, 30px icon-button square (<code>--control-icon-size</code>), 29–30px control heights.</li>
        <li>Numeric read-outs are mono + <code>tabular-nums</code>, right-aligned in rows (see ReadRow).</li>
        <li>Hit areas ≥ 40px where it matters (Splitter's grab zone straddles its 2px hairline).</li>
        <li>Flush modules (no gutter — <code>--shell-gap</code>) rely on borders + surface steps for separation; resize rails announce themselves by thickening + tinting toward <code>--accent</code> on hover.</li>
      </ul>
    </div>

    <div class="rule">
      <h3>Motion &amp; state</h3>
      <ul>
        <li>Reduced motion is a policy, not per-component: every <code>--dur-*</code> collapses to 0ms; canvas animations (EffectThumb) render one static frame.</li>
        <li>State colour is never the only signal — LIVE/ok/warn pair colour with a label or dot; role colours always ride icon + label.</li>
        <li>Never block the UI on an animation; transitions are interruptible.</li>
      </ul>
    </div>

    <div class="rule">
      <h3>Composition</h3>
      <ul>
        <li>Compose from <code>lib/ui</code> primitives and the composites above; new panel = existing vocabulary first.</li>
        <li>Store-bound components read a narrow store surface — keep new ones presentational where possible (NodeCard pattern), with the store adapter at the view edge.</li>
        <li>Something new and reusable? Add it to <code>lib/ui</code>, demo it in the styleguide, regenerate this file (<code>pnpm design-system</code>) in the same change.</li>
      </ul>
    </div>
  </div>
</section>

<style>
  .rules {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(300px, 1fr));
    gap: var(--space-5) var(--space-6);
  }
  .rule {
    min-width: 0;
  }
  h3 {
    font-size: var(--text-sm);
    color: var(--text);
    margin-bottom: var(--space-2);
  }
  ul {
    margin: 0;
    padding-left: var(--space-4);
    display: flex;
    flex-direction: column;
    gap: var(--space-2);
  }
  li {
    font-size: var(--text-sm);
    color: var(--text-muted);
    line-height: var(--leading-normal);
  }
  li code {
    font-family: var(--font-mono);
    font-size: var(--text-2xs);
    color: var(--text-faint);
  }
</style>
