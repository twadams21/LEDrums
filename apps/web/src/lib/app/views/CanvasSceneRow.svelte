<script lang="ts">
  /* One Canvas Scenes row in the Objects view (U5). A selectable/renamable row (EditableRow)
     carrying duplicate + delete verbs, and an expandable JSON editor for day-1 authoring
     (locked decision 3 — no visual editor yet). The JSON editor drafts from
     `store.canvasSceneJson`; Save routes through `store.updateCanvasSceneJson`, which validates
     (id is stable, structural minimums) and surfaces an inline error on rejection. */
  import type { TriggerLab } from '../../trigger-lab/store.svelte';
  import type { CanvasSceneRow as CanvasSceneRowVM } from './objects-view';
  import EditableRow, { type ContextMenuAction } from '../../ui/EditableRow.svelte';
  import ConfirmDialog from '../../ui/ConfirmDialog.svelte';
  import IconButton from '../../ui/IconButton.svelte';
  import Shapes from '@lucide/svelte/icons/shapes';
  import Pencil from '@lucide/svelte/icons/pencil';
  import CopyPlus from '@lucide/svelte/icons/copy-plus';
  import Code from '@lucide/svelte/icons/code';
  import Trash2 from '@lucide/svelte/icons/trash-2';

  let {
    store,
    scene,
    active = false,
    onSelect,
  }: { store: TriggerLab; scene: CanvasSceneRowVM; active?: boolean; onSelect?: () => void } = $props();

  let editing = $state(false);
  let expanded = $state(false);
  let draft = $state('');
  let error = $state<string | null>(null);
  let confirmDelete = $state(false);

  const sub = $derived(
    `${scene.sampler} · ${scene.elementCount} ${scene.elementCount === 1 ? 'element' : 'elements'}` +
      (scene.lensCount ? ` · ${scene.lensCount} ${scene.lensCount === 1 ? 'lens' : 'lenses'}` : ''),
  );

  /** Open the JSON editor, seeding the draft from the live scene doc. */
  function openEditor(): void {
    draft = store.canvasSceneJson(scene.id);
    error = null;
    expanded = true;
    onSelect?.();
  }

  function save(): void {
    const res = store.updateCanvasSceneJson(scene.id, draft);
    if (res.ok) {
      error = null;
      expanded = false;
    } else {
      error = res.message;
    }
  }

  const actions = $derived<ContextMenuAction[]>([
    { label: 'Edit JSON', icon: Code, onSelect: openEditor },
    { label: 'Duplicate', icon: CopyPlus, onSelect: () => store.duplicateCanvasScene(scene.id) },
    { label: 'Delete', icon: Trash2, danger: true, onSelect: () => (confirmDelete = true) },
  ]);
</script>

<div class="scene-row" class:active>
  <EditableRow
    icon={Shapes}
    label={scene.name}
    secondary={sub}
    {active}
    bind:editing
    onclick={() => onSelect?.()}
    onCommit={(name) => store.renameCanvasScene(scene.id, name)}
    {actions}
    renameLabel="Canvas scene name"
  >
    {#snippet quickActions()}
      <IconButton icon={Code} label="Edit scene JSON" size={13} onclick={openEditor} />
      <IconButton icon={Pencil} label="Rename scene" size={13} onclick={() => (editing = true)} />
      <IconButton icon={CopyPlus} label="Duplicate scene" size={13} onclick={() => store.duplicateCanvasScene(scene.id)} />
    {/snippet}
  </EditableRow>

  {#if expanded}
    <div class="editor">
      <textarea
        class="json"
        bind:value={draft}
        spellcheck="false"
        aria-label={`${scene.name} scene JSON`}
        rows={14}
      ></textarea>
      {#if error}<p class="err">{error}</p>{/if}
      <div class="actions">
        <button type="button" class="btn ghost" onclick={() => (expanded = false)}>Cancel</button>
        <button type="button" class="btn accent" onclick={save} disabled={!store.canEdit}>Save</button>
      </div>
    </div>
  {/if}
</div>

<ConfirmDialog
  bind:open={confirmDelete}
  title="Delete canvas scene?"
  message={`"${scene.name}" will be removed. Play nodes using it retarget to another scene (or clear if none remain).`}
  confirmLabel="Delete"
  danger
  onConfirm={() => store.deleteCanvasScene(scene.id)}
/>

<style>
  .scene-row {
    display: flex;
    flex-direction: column;
  }
  .editor {
    display: flex;
    flex-direction: column;
    gap: var(--space-2);
    padding: var(--space-2) var(--space-2) var(--space-3);
  }
  .json {
    width: 100%;
    resize: vertical;
    padding: var(--space-2);
    background: var(--surface-1);
    border: 1px solid var(--border);
    border-radius: var(--radius-2);
    color: var(--ink);
    font-family: var(--font-mono);
    font-size: var(--text-2xs);
    line-height: 1.5;
    tab-size: 2;
  }
  .json:focus-visible {
    outline: none;
    border-color: var(--accent);
  }
  .err {
    margin: 0;
    font-size: var(--text-2xs);
    color: var(--danger, var(--warn));
    font-family: var(--font-mono);
  }
  .actions {
    display: flex;
    justify-content: flex-end;
    gap: var(--space-2);
  }
  .btn {
    padding: var(--space-1) var(--space-3);
    border-radius: var(--radius-2);
    border: 1px solid var(--border);
    background: var(--surface-2);
    color: var(--ink);
    font-size: var(--text-xs);
    font-weight: 600;
    cursor: pointer;
  }
  .btn.accent {
    border-color: var(--accent);
    background: color-mix(in oklch, var(--accent) 18%, transparent);
    color: var(--accent-bright, var(--accent));
  }
  .btn:disabled {
    opacity: 0.5;
    cursor: not-allowed;
  }
</style>
