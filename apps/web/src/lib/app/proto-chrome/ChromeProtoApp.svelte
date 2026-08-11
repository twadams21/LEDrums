<script lang="ts">
  /* PROTOTYPE (throwaway — see NOTES.md). Root for the tabbed-chrome layout
     exploration, mounted by main.ts on `?proto=chrome`. Owns a real TriggerLab
     store (real engine link + data) and a real ShellStore, renders the tabbed
     proto shell for the current variant, and floats the variant switcher. */
  import { onMount } from 'svelte';
  import { TriggerLab } from '../../trigger-lab/store.svelte';
  import { ShellStore } from '../shell-store.svelte';
  import { parseSearch } from '../shell-nav';
  import ProtoShell, { type ProtoOpen } from './ProtoShell.svelte';
  import ProtoSwitcher, { type ProtoVariant } from './ProtoSwitcher.svelte';

  const search = typeof location !== 'undefined' ? location.search : '';
  const store = new TriggerLab();
  // `?view=` deep-links a tab (same param as the real app); default = trigger.
  const shell = new ShellStore({ view: parseSearch(search).view ?? 'trigger' });

  function parseVariant(s: string): ProtoVariant {
    const v = new URLSearchParams(s).get('variant');
    return v === 'C' ? 'C' : 'B';
  }

  // `?open=settings|patch` pre-opens the settings / patch-graph modals — for
  // ui-shot captures (the shot seam isn't installed on the proto route).
  function parseOpen(s: string): ProtoOpen {
    const v = new URLSearchParams(s).get('open');
    return v === 'settings' || v === 'patch' ? v : null;
  }

  let variant = $state<ProtoVariant>(parseVariant(search));
  const initialOpen = parseOpen(search);
  const initialPane = new URLSearchParams(search).get('pane');

  function setVariant(v: ProtoVariant): void {
    variant = v;
    const url = new URL(location.href);
    url.searchParams.set('variant', v);
    history.replaceState(null, '', url);
  }

  onMount(() => {
    store.start();
    return () => store.stop();
  });
</script>

<div class="proto-root">
  <ProtoShell {store} {shell} {variant} {initialOpen} {initialPane} />
</div>

<ProtoSwitcher {variant} onSelect={setVariant} />

<style>
  .proto-root {
    height: 100vh;
    width: 100vw;
  }
</style>
