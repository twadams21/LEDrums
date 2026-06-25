<script lang="ts">
  /* Perform ⇄ Author switch — a segmented control bound to the shell store mode.
     The shell crossfades between the two layouts (see App.svelte). */
  import type { ShellStore } from '../shell-store.svelte';
  import type { Mode } from '../shell-nav';
  import SegmentedControl from '../../ui/SegmentedControl.svelte';

  let { shell }: { shell: ShellStore } = $props();

  // text labels (not icons) — SegmentedControl renders icon-only when icons are set
  const OPTS = [
    { value: 'perform', label: 'Perform' },
    { value: 'author', label: 'Author' },
  ];
</script>

<SegmentedControl
  value={shell.mode}
  options={OPTS}
  onChange={(v) => shell.setMode(v as Mode)}
  ariaLabel="Mode"
/>
