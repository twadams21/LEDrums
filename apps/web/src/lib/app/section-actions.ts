import { effectChain } from '@ledrums/core';
import type { TriggerLab } from '../trigger-lab/store.svelte';
import { MASTER_CELL, type EffectsAuthoringApi } from '../trigger-lab/effects-api';
import type { ContextMenuAction } from '../ui/ContextMenu.svelte';
import ArrowLeft from '@lucide/svelte/icons/arrow-left';
import ArrowRight from '@lucide/svelte/icons/arrow-right';
import ArrowLeftToLine from '@lucide/svelte/icons/arrow-left-to-line';
import ArrowRightToLine from '@lucide/svelte/icons/arrow-right-to-line';
import CopyPlus from '@lucide/svelte/icons/copy-plus';
import Copy from '@lucide/svelte/icons/copy';
import ClipboardPaste from '@lucide/svelte/icons/clipboard-paste';
import Pencil from '@lucide/svelte/icons/pencil';
import Trash2 from '@lucide/svelte/icons/trash-2';
import FolderOpen from '@lucide/svelte/icons/folder-open';

/** Where a section-menu file load lands when no cell of that section is selected: the Kit row's
    Always column, the one cell every kit has (agent-chosen). */
const DEFAULT_LOAD_CELL: effectChain.EffectCell = { row: effectChain.KIT_ROW, column: { kind: 'always' } };

/**
 * "Load cell / effect from file…" for a section: activates the section, then loads the picked
 * Effect or cell file into its selected cell (when the section was already active and a grid
 * cell is selected), else into {@link DEFAULT_LOAD_CELL}. A successful load selects that cell.
 * Result toasts are the store's (as for every file load).
 */
export async function loadFileIntoSection(store: TriggerLab, api: EffectsAuthoringApi, sectionId: string): Promise<void> {
  const wasActive = store.activeSectionId === sectionId;
  store.setActiveSection(sectionId);
  const selected = api.selectedCell;
  const cell = wasActive && selected != null && selected !== MASTER_CELL ? selected : DEFAULT_LOAD_CELL;
  const result = await api.loadFileIntoCell(cell);
  if (result.ok) api.selectCell(cell);
}

export function sectionActions(
  store: TriggerLab,
  sectionId: string,
  rename: () => void,
  api: EffectsAuthoringApi = store as unknown as EffectsAuthoringApi, // TODO(ec-w4): store-wire
): ContextMenuAction[] {
  const sections = store.activeSongById?.sections ?? [];
  const index = sections.findIndex((section) => section.id === sectionId);
  const disabled = !store.canEditActiveSong || index < 0;
  const first = disabled || index === 0;
  const last = disabled || index === sections.length - 1;
  return [
    { label: 'Move left', icon: ArrowLeft, disabled: first, onSelect: () => store.moveSection(sectionId, index - 1) },
    { label: 'Move right', icon: ArrowRight, disabled: last, onSelect: () => store.moveSection(sectionId, index + 2) },
    { label: 'Move to start', icon: ArrowLeftToLine, disabled: first, onSelect: () => store.moveSection(sectionId, 0) },
    { label: 'Move to end', icon: ArrowRightToLine, disabled: last, onSelect: () => store.moveSection(sectionId, sections.length) },
    { label: 'Duplicate', icon: CopyPlus, disabled, onSelect: () => store.duplicateSection(sectionId) },
    { label: 'Rename', icon: Pencil, disabled, onSelect: rename },
    { label: 'Copy', icon: Copy, disabled, onSelect: () => void store.copySectionToClipboard(sectionId) },
    { label: 'Paste', icon: ClipboardPaste, disabled, onSelect: () => void store.pasteSectionFromClipboard() },
    { label: 'Load cell / effect from file…', icon: FolderOpen, disabled, onSelect: () => void loadFileIntoSection(store, api, sectionId) },
    { label: 'Delete', icon: Trash2, disabled, danger: true, onSelect: () => store.removeSection(sectionId) },
  ];
}
