<script lang="ts">
  /* Right-dock Inspector — contextual settings for whatever is selected in the shell (a
     trigger-graph node, a layer/bus, a Patch device, or a setlist section). There is no
     separate Settings page; switching views resets the selection. This is the thin
     dispatcher: it resolves the selection to a primary object and hands off to a focused
     per-kind editor under `inspectors/`. The shared chrome it owns is the node header (kind
     selector + remove) and the Patch header / offline banner. Effect Gallery, Envelope Editor
     and Effect Creator stay as summoned overlays, opened from the editors via the engine store. */
  import type { TriggerLab } from '../../trigger-lab/store.svelte';
  import type { ShellStore } from '../shell-store.svelte';
  import { describePatchNode } from '../patch-topology';
  import { sectionRecall } from '../recall';
  import { type GraphNode, type NodeKind } from '../../trigger-lab/sim';
  import { KIND_OPTS } from '../views/node-options';
  import { patchEditorFor, type PatchEditor } from './patch-inspector';
  import { patchLabel } from './inspectors/forms';
  import Select from '../../ui/Select.svelte';
  import IconButton from '../../ui/IconButton.svelte';
  import Eyebrow from '../../ui/Eyebrow.svelte';
  import Trash2 from '@lucide/svelte/icons/trash-2';
  import MousePointerClick from '@lucide/svelte/icons/mouse-pointer-click';
  import TriggerSourceInspector from './inspectors/TriggerSourceInspector.svelte';
  import PlayNodeInspector from './inspectors/PlayNodeInspector.svelte';
  import ContainerNodeInspector from './inspectors/ContainerNodeInspector.svelte';
  import DelayNodeInspector from './inspectors/DelayNodeInspector.svelte';
  import BusInspector from './inspectors/BusInspector.svelte';
  import PatchZoneInspector from './inspectors/PatchZoneInspector.svelte';
  import PatchDrumInspector from './inspectors/PatchDrumInspector.svelte';
  import PatchHoopInspector from './inspectors/PatchHoopInspector.svelte';
  import PatchDataLineInspector from './inspectors/PatchDataLineInspector.svelte';
  import PatchOutputInspector from './inspectors/PatchOutputInspector.svelte';
  import PatchControllerInspector from './inspectors/PatchControllerInspector.svelte';
  import SectionInspector from './inspectors/SectionInspector.svelte';

  let { store, shell }: { store: TriggerLab; shell: ShellStore } = $props();

  const sel = $derived(shell.selection);

  // resolve a node selection against the active graph
  const node = $derived.by<GraphNode | null>(() => {
    if (sel?.kind !== 'node') return null;
    return store.selectedGraph?.nodes.find((n) => n.id === sel.nodeId) ?? null;
  });

  const bus = $derived(sel?.kind === 'bus' ? store.buses.find((b) => b.id === sel.busId) ?? null : null);

  // --- Section selection (transport recall) --------------------------------------
  // Resolve the section, its parent song, and their setlist indices — searching ALL songs
  // (not just the active one) so the panel stays correct if the active song changes while a
  // section is inspected. The recall indices match the server's convention (song index in
  // the setlist · section index in the song); the strings come from the pure helper.
  const sectionSel = $derived.by(() => {
    if (sel?.kind !== 'section') return null;
    const songIdx = store.songs.findIndex((s) => s.sections.some((sec) => sec.id === sel.sectionId));
    if (songIdx < 0) return null;
    const song = store.songs[songIdx]!;
    const sectionIdx = song.sections.findIndex((sec) => sec.id === sel.sectionId);
    const section = song.sections[sectionIdx]!;
    return { song, songIdx, section, sectionIdx, recall: sectionRecall(songIdx, sectionIdx) };
  });

  // --- Patch graph per-node editors (S4) -----------------------------------------
  // Decode the selected Patch node into the editor it opens; the editor reads the
  // authoritative store.project + the live patch routing itself. `project` here only gates
  // the shared offline banner.
  const patchId = $derived(sel?.kind === 'patch' ? sel.nodeId : null);
  const ed = $derived<PatchEditor | null>(patchId ? patchEditorFor(patchId) : null);
  const project = $derived(store.project);
</script>

<!-- A viewer (S2 read-only) gets a natively-disabled fieldset: every nested form control
     (buttons, selects, inputs, the bits-ui triggers) is disabled by the browser, and the CSS
     below dims the panel + neutralises the div-based slider drags. The store mutators already
     no-op for a viewer — this makes that visible. -->
<fieldset class="inspector" disabled={!store.canEdit}>
  {#if node && node.kind === 'trigger'}
    <TriggerSourceInspector {store} {node} />
  {:else if node}
    <!-- shared header for every editable node: change its kind + remove it -->
    <header class="nodehead">
      <span class="kindsel">
        <Select value={node.kind} options={KIND_OPTS} onChange={(v) => store.changeKind(node, v as NodeKind)} ariaLabel="Node type" />
      </span>
      <IconButton icon={Trash2} label="Remove node" variant="soft" size={14} onclick={() => store.removeNode(node)} />
    </header>
    {#if node.kind === 'play'}
      <PlayNodeInspector {store} {node} />
    {:else if node.kind === 'delay'}
      <DelayNodeInspector {store} {node} />
    {:else}
      <ContainerNodeInspector {store} {node} />
    {/if}
  {:else if bus}
    <BusInspector {store} {bus} />
  {:else if sel?.kind === 'patch' && ed}
    {@const editor = ed}
    {@const d = describePatchNode(sel.nodeId, store.drums)}
    <header class="ihead">
      <div class="titles">
        <Eyebrow>{d.stage}</Eyebrow>
        <h3 class="patch-title">{patchLabel(store, sel.nodeId, d.title)}</h3>
        <span class="sub">{d.sub}</span>
      </div>
    </header>

    {#if editor.kind === 'input' || editor.kind === 'trigger' || editor.kind === 'unknown'}
      <div class="nodeinfo">
        <p class="hint">
          {editor.kind === 'trigger'
            ? 'The drum’s trigger input. What each hit plays is wired in the Trigger graph; the editable device settings live on its zone, drum and hoop nodes.'
            : 'The performance input source. What each hit plays is wired in the Trigger graph.'}
        </p>
      </div>
    {:else}
      <div class="patchbody">
        {#if !project}
          <p class="offline">Offline — connect to the engine to edit device settings. Renaming still works.</p>
        {/if}

        {#if editor.kind === 'zone'}
          <PatchZoneInspector {store} {editor} nodeId={sel.nodeId} title={d.title} />
        {:else if editor.kind === 'drum'}
          <PatchDrumInspector {store} {editor} nodeId={sel.nodeId} title={d.title} />
        {:else if editor.kind === 'hoop'}
          <PatchHoopInspector {store} {shell} {editor} nodeId={sel.nodeId} title={d.title} />
        {:else if editor.kind === 'dataline'}
          <PatchDataLineInspector {store} {shell} {editor} nodeId={sel.nodeId} title={d.title} />
        {:else if editor.kind === 'output'}
          <PatchOutputInspector {store} {shell} {editor} nodeId={sel.nodeId} title={d.title} />
        {:else if editor.kind === 'controller'}
          <PatchControllerInspector {store} nodeId={sel.nodeId} title={d.title} />
        {/if}
      </div>
    {/if}
  {:else if sectionSel}
    {@const ss = sectionSel}
    <SectionInspector
      {store}
      sectionId={ss.section.id}
      sectionName={ss.section.name}
      songName={ss.song.name}
      sectionIdx={ss.sectionIdx}
      recall={ss.recall}
    />
  {:else}
    <div class="empty">
      <MousePointerClick size={22} aria-hidden="true" />
      <p>Select a node, a bus, a device, or a section to edit it here.</p>
    </div>
  {/if}
</fieldset>

<style>
  .inspector {
    /* fieldset reset — it carries the read-only gate but must lay out like the old div */
    margin: 0;
    padding: 0;
    border: 0;
    min-width: 0;
    display: flex;
    flex-direction: column;
    min-height: 0;
    height: 100%;
    overflow: auto;
  }
  /* Read-only viewer: dim the panel + stop drag-based controls (sliders/segmented) the native
     fieldset[disabled] can't reach (they're div/role-based, not form controls). */
  .inspector:disabled {
    opacity: 0.6;
  }
  .inspector:disabled :global(.slider),
  .inspector:disabled :global(.seg) {
    pointer-events: none;
  }
  .ihead {
    display: flex;
    align-items: center;
    gap: var(--space-3);
    padding: var(--space-3);
    border-bottom: 1px solid var(--border-faint);
  }
  .titles {
    flex: 1;
    min-width: 0;
  }
  h3 {
    margin: 0;
    font-size: var(--text-md);
    font-weight: 700;
    color: var(--ink);
  }
  .sub {
    font-size: var(--text-2xs);
    font-family: var(--font-mono);
    color: var(--text-faint);
  }
  /* shared node header: kind selector (grows) + remove button */
  .nodehead {
    display: flex;
    align-items: center;
    gap: var(--space-2);
    padding: var(--space-3);
    border-bottom: 1px solid var(--border-faint);
  }
  .kindsel {
    display: inline-flex;
    flex: 1;
    min-width: 0;
  }
  .kindsel :global(.sel-trigger) {
    font-weight: 700;
    color: var(--ink);
  }
  .nodeinfo {
    padding: var(--space-3);
    display: flex;
    flex-direction: column;
    gap: var(--space-2);
  }
  .patchbody {
    display: flex;
    flex-direction: column;
    gap: var(--space-3);
    padding: var(--space-3);
  }
  .patchbody :global(.sel) {
    width: 100%;
  }
  .offline {
    margin: 0;
    padding: var(--space-2);
    font-size: var(--text-2xs);
    color: var(--text-faint);
    background: var(--surface-2);
    border: 1px dashed var(--border);
    border-radius: var(--radius-2);
  }
  .hint {
    margin: 0;
    font-size: var(--text-xs);
    color: var(--text-muted);
    line-height: var(--leading-normal);
  }
  .empty {
    flex: 1;
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    gap: var(--space-2);
    padding: var(--space-4);
    text-align: center;
    color: var(--text-faint);
  }
  .empty p {
    margin: 0;
    font-size: var(--text-xs);
    max-width: 28ch;
  }
</style>
