<script lang="ts">
  /* Thin divider on Bits UI Separator (decorative by default). */
  import { Separator } from 'bits-ui';

  type Props = {
    orientation?: 'horizontal' | 'vertical';
    class?: string;
  };

  let { orientation = 'horizontal', class: klass }: Props = $props();
</script>

<Separator.Root {orientation} class={['lab-sep', klass]} />

<style>
  :global(.lab-sep) {
    flex: none;
    background: var(--border);
  }
  :global(.lab-sep[data-orientation='horizontal']) {
    width: 100%;
    height: 1px;
  }
  :global(.lab-sep[data-orientation='vertical']) {
    width: 1px;
    align-self: stretch;
  }
</style>
