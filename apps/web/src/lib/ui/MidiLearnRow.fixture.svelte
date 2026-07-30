<script lang="ts">
  /* Test-only harness for MidiLearnRow: the component takes its value field as a snippet, so the
     component test drives it through real {#snippet} content — the same shape the three inspector
     call sites use. Not shipped UI; imported solely by MidiLearnRow.test.ts. */
  import MidiLearnRow from './MidiLearnRow.svelte';

  let {
    learning = false,
    disabled = false,
    onToggle = () => {},
  }: { learning?: boolean; disabled?: boolean; onToggle?: () => void } = $props();
</script>

<MidiLearnRow {learning} {disabled} {onToggle}>
  <input data-testid="field" aria-label="MIDI note" />
</MidiLearnRow>
