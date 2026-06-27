<script lang="ts">
  /* One Effects-tab row in the Objects view. Effects are foundational — rename + duplicate
     only, never deletable (the menu and quick-actions omit Delete). `active` is the view's
     local highlight (effects have no nav target of their own). */
  import type { TriggerLab } from '../../trigger-lab/store.svelte';
  import type { EffectRow as EffectRowVM } from './objects-view';
  import EditableRow, { type ContextMenuAction } from '../../ui/EditableRow.svelte';
  import IconButton from '../../ui/IconButton.svelte';
  import Sparkles from '@lucide/svelte/icons/sparkles';
  import Pencil from '@lucide/svelte/icons/pencil';
  import CopyPlus from '@lucide/svelte/icons/copy-plus';

  let {
    store,
    effect,
    active = false,
    onSelect,
  }: { store: TriggerLab; effect: EffectRowVM; active?: boolean; onSelect?: () => void } = $props();

  let editing = $state(false);
  const sub = $derived(`${effect.presetCount} ${effect.presetCount === 1 ? 'preset' : 'presets'}`);

  const actions = $derived<ContextMenuAction[]>([
    { label: 'Duplicate', icon: CopyPlus, onSelect: () => store.duplicateEffect(effect.id) },
  ]);
</script>

<EditableRow
  icon={Sparkles}
  label={effect.name}
  secondary={sub}
  {active}
  bind:editing
  onclick={() => onSelect?.()}
  onCommit={(name) => store.renameEffect(effect.id, name)}
  {actions}
  renameLabel="Effect name"
>
  {#snippet quickActions()}
    <IconButton icon={Pencil} label="Rename effect" size={13} onclick={() => (editing = true)} />
    <IconButton icon={CopyPlus} label="Duplicate effect" size={13} onclick={() => store.duplicateEffect(effect.id)} />
  {/snippet}
</EditableRow>
