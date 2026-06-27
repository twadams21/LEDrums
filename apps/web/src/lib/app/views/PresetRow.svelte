<script lang="ts">
  /* One Presets-tab row in the Objects view. Delete is gated by the view-model's `deletable`
     (unused AND not a live effect's foundational `:default`) — the same guard the store
     enforces — so the menu + quick-action disable Delete in lockstep. `active` is the view's
     local highlight (presets have no nav target of their own). */
  import type { TriggerLab } from '../../trigger-lab/store.svelte';
  import type { PresetRow as PresetRowVM } from './objects-view';
  import EditableRow, { type ContextMenuAction } from '../../ui/EditableRow.svelte';
  import IconButton from '../../ui/IconButton.svelte';
  import Bookmark from '@lucide/svelte/icons/bookmark';
  import Pencil from '@lucide/svelte/icons/pencil';
  import CopyPlus from '@lucide/svelte/icons/copy-plus';
  import Trash2 from '@lucide/svelte/icons/trash-2';

  let {
    store,
    preset,
    active = false,
    onSelect,
  }: { store: TriggerLab; preset: PresetRowVM; active?: boolean; onSelect?: () => void } = $props();

  let editing = $state(false);
  const sub = $derived(
    `${preset.effectName} · ${preset.usage === 0 ? 'unused' : `used ${preset.usage}×`}${preset.isDefault ? ' · default' : ''}`,
  );

  function remove(): void {
    store.deletePreset(preset.id);
  }

  const actions = $derived<ContextMenuAction[]>([
    { label: 'Duplicate', icon: CopyPlus, onSelect: () => store.duplicatePreset(preset.id) },
    { label: 'Delete', icon: Trash2, danger: true, disabled: !preset.deletable, onSelect: remove },
  ]);
</script>

<EditableRow
  icon={Bookmark}
  label={preset.name}
  secondary={sub}
  {active}
  bind:editing
  onclick={() => onSelect?.()}
  onCommit={(name) => store.renamePreset(preset.id, name)}
  {actions}
  renameLabel="Preset name"
>
  {#snippet quickActions()}
    <IconButton icon={Pencil} label="Rename preset" size={13} onclick={() => (editing = true)} />
    <IconButton icon={CopyPlus} label="Duplicate preset" size={13} onclick={() => store.duplicatePreset(preset.id)} />
    <IconButton
      icon={Trash2}
      label={preset.deletable ? 'Delete preset' : 'In use — can’t delete'}
      size={13}
      disabled={!preset.deletable}
      onclick={remove}
    />
  {/snippet}
</EditableRow>
