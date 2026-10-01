<script lang="ts">
  /* The Effects grid (effect chains, S06a): the active section as rows (Kit, then each drum in kit
     order) × columns (the union of zone slots, then Always / Clock / Cue). Each cell is a stack of
     Effects; the Kit row starts with the Master cell (the section's master modifier chain).

     - Click selects (the device strip below shows the selection). Double-click an empty cell opens
       the Generator picker to add an Effect. Right-click: add, copy, paste, clear, save / load file.
     - Keyboard: one roving tab stop (grid-nav.ts); arrows / Home / End move, Enter or Space selects.
       The grid is deliberately NOT a marked keyboard owner: digits 1–9 / 0 stay the app's audition
       keys while a cell has focus, and the app never claims arrows outside Perform.
     - Reads and edits go only through `api` (EffectsAuthoringApi), so the grid follows the active
       section and is demoable over the standalone api. */
  import { tick } from 'svelte';
  import { effectChain } from '@ledrums/core';
  import { MASTER_CELL, type ApplyResult, type EffectsAuthoringApi } from '../../../../trigger-lab/effects-api';
  import { sameCell } from '../../../../trigger-lab/effects-doc';
  import ContextMenu, { type ContextMenuAction } from '../../../../ui/ContextMenu.svelte';
  import { pushToast } from '../../../../ui/toast.svelte';
  import Plus from '@lucide/svelte/icons/plus';
  import Copy from '@lucide/svelte/icons/copy';
  import ClipboardPaste from '@lucide/svelte/icons/clipboard-paste';
  import Eraser from '@lucide/svelte/icons/eraser';
  import Save from '@lucide/svelte/icons/save';
  import FolderOpen from '@lucide/svelte/icons/folder-open';
  import GridCell from './GridCell.svelte';
  import GeneratorPicker from './GeneratorPicker.svelte';
  import { MASTER_COL, initialFocus, isGridNavKey, moveFocus, type GridPos, type GridShape } from './grid-nav';

  type EffectCell = effectChain.EffectCell;

  let { api }: { api: EffectsAuthoringApi } = $props();

  const rows = $derived(api.gridRows);
  const columns = $derived(api.gridColumns);
  const cellAt = (r: number, c: number): EffectCell => ({ row: rows[r]!.id, column: columns[c]!.column });
  /** Index of the first non-zone column: the trigger group gets a divider before it. */
  const firstTrigger = $derived(columns.findIndex((c) => c.column.kind !== 'zone'));

  const shape: GridShape = $derived({
    rows: rows.length,
    cols: columns.length,
    enabled: (r, c) => api.cellSummary(cellAt(r, c)).enabled,
  });

  /** Where the selection sits in the grid (null when nothing, or a cell the grid doesn't show). */
  const selectedPos = $derived.by((): GridPos | null => {
    const sel = api.selectedCell;
    if (sel === null) return null;
    if (sel === MASTER_CELL) return { row: 0, col: MASTER_COL };
    const r = rows.findIndex((row) => row.id === sel.row);
    const c = columns.findIndex((col) => sameCell({ row: sel.row, column: col.column }, sel));
    return r < 0 || c < 0 ? null : { row: r, col: c };
  });

  // The roving tab stop: the last focused position, else the selection, else the first cell. A
  // stale position (columns shrank, a zone was removed) falls back through the same rule.
  let focusPos = $state<GridPos | null>(null);
  const tabStop = $derived(initialFocus(shape, focusPos ?? selectedPos));

  let root = $state<HTMLElement | null>(null);
  const cellEl = (pos: GridPos): HTMLElement | null =>
    root?.querySelector<HTMLElement>(`[role="gridcell"][data-row="${pos.row}"][data-col="${pos.col}"]`) ?? null;

  async function focusAt(pos: GridPos): Promise<void> {
    focusPos = pos;
    await tick();
    cellEl(pos)?.focus();
  }

  function select(pos: GridPos): void {
    focusPos = pos;
    api.selectCell(pos.col === MASTER_COL ? MASTER_CELL : cellAt(pos.row, pos.col));
  }

  function onkeydown(event: KeyboardEvent): void {
    if (event.ctrlKey || event.metaKey || event.altKey) return;
    const target = event.target as HTMLElement | null;
    if (target?.getAttribute('role') !== 'gridcell') return;
    if (isGridNavKey(event.key) && !event.shiftKey) {
      event.preventDefault();
      void focusAt(moveFocus(shape, tabStop, event.key));
      return;
    }
    if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault();
      select(tabStop);
    }
  }

  // ---- Generator picker ---------------------------------------------------------------------
  let picker = $state<{ pos: GridPos; anchor: { left: number; top: number; bottom: number } } | null>(null);

  function openPicker(pos: GridPos): void {
    if (!api.canEdit) return;
    const rect = cellEl(pos)?.getBoundingClientRect();
    if (!rect) return;
    picker = { pos, anchor: { left: rect.left, top: rect.top, bottom: rect.bottom } };
  }
  function closePicker(): void {
    const pos = picker?.pos;
    picker = null;
    if (pos) void focusAt(pos);
  }
  function pick(kind: effectChain.GeneratorKind): void {
    if (!picker) return;
    api.addEffect(cellAt(picker.pos.row, picker.pos.col), kind);
    closePicker();
  }

  function activate(pos: GridPos): void {
    select(pos);
    if (pos.col !== MASTER_COL && api.cellSummary(cellAt(pos.row, pos.col)).count === 0) openPicker(pos);
  }

  // ---- Context menu (one menu for the grid; the right-clicked cell names its target) ----------
  let menuPos = $state<GridPos | null>(null);

  function report(result: ApplyResult): void {
    if (!result.ok) pushToast(result.reason, { tone: 'error' });
  }

  const menuActions = $derived.by((): ContextMenuAction[] => {
    if (!menuPos || menuPos.col === MASTER_COL) return [];
    const pos = menuPos;
    const cell = cellAt(pos.row, pos.col);
    const count = api.cellSummary(cell).count;
    const edit = api.canEdit;
    return [
      { label: 'Add Effect…', icon: Plus, disabled: !edit, onSelect: () => openPicker(pos) },
      { label: 'Copy cell', icon: Copy, disabled: count === 0, onSelect: () => api.copyCell(cell) },
      { label: 'Paste into cell', icon: ClipboardPaste, disabled: !edit || !api.canPasteCell, onSelect: () => report(api.pasteCell(cell)) },
      { label: 'Save cell to file…', icon: Save, disabled: count === 0, onSelect: () => void api.saveCellToFile(cell) },
      { label: 'Load file into cell…', icon: FolderOpen, disabled: !edit, onSelect: () => void api.loadFileIntoCell(cell).then(report) },
      { label: 'Clear cell', icon: Eraser, danger: true, disabled: !edit || count === 0, onSelect: () => api.clearCell(cell) },
    ];
  });

  /** Only an enabled cell has a menu. Headers, gaps and the Master (its devices live in the strip)
      suppress it — and the browser's — before the event reaches the menu trigger around the grid. */
  function guardMenu(event: MouseEvent): void {
    const cell = (event.target as Element | null)?.closest('[role="gridcell"]');
    const isCell = cell && cell.getAttribute('aria-disabled') !== 'true' && cell.getAttribute('data-col') !== String(MASTER_COL);
    if (isCell) return;
    menuPos = null;
    event.preventDefault();
    event.stopPropagation();
  }
</script>

<ContextMenu actions={menuActions} class="grid-menu">
  <div
    class="grid"
    bind:this={root}
    role="grid"
    tabindex="-1"
    aria-label="Effects grid"
    aria-rowcount={rows.length + 1}
    aria-colcount={columns.length + 1}
    style:--cols={columns.length}
    {onkeydown}
    oncontextmenu={guardMenu}
  >
    <div class="row head" role="row">
      <div class="corner" role="columnheader"><span class="sr">Row</span></div>
      {#each columns as col, c (col.column.kind === 'zone' ? `z${col.column.slot}` : col.column.kind)}
        <div class="colhead" class:group={c === firstTrigger && c > 0} role="columnheader">
          <span class="collabel">{col.label}</span>
        </div>
      {/each}
    </div>

    {#each rows as row, r (row.id)}
      <div class="row" role="row">
        <div class="rowhead" class:kit={r === 0} role="none">
          {#if r === 0}
            <span class="rowlabel" role="rowheader">{row.label}</span>
            <span class="master">
              <GridCell
                variant="master"
                label="Master"
                count={api.masterChain.length}
                row={0}
                col={MASTER_COL}
                selected={api.selectedCell === MASTER_CELL}
                tabbable={tabStop.row === 0 && tabStop.col === MASTER_COL}
                onselect={() => select({ row: 0, col: MASTER_COL })}
                onfocus={() => (focusPos = { row: 0, col: MASTER_COL })}
              />
            </span>
          {:else}
            <span class="dot" style:background={row.color ?? 'var(--text-faint)'} aria-hidden="true"></span>
            <span class="rowlabel" role="rowheader">{row.label}</span>
          {/if}
        </div>
        {#each columns as col, c (col.column.kind === 'zone' ? `z${col.column.slot}` : col.column.kind)}
          {@const cell = { row: row.id, column: col.column }}
          {@const s = api.cellSummary(cell)}
          {@const label = r === 0 ? `Kit ${s.label}` : col.column.kind === 'zone' ? s.label : `${row.label} ${s.label}`}
          <div class="slot" class:group={c === firstTrigger && c > 0}>
            <GridCell
              {label}
              map={s.enabled ? { target: { kind: 'fireCell', cell }, kind: 'button', label } : undefined}
              enabled={s.enabled}
              count={s.count}
              firstName={s.firstName}
              firstGenerator={s.firstGenerator}
              allBypassed={s.allBypassed}
              row={r}
              col={c}
              selected={selectedPos?.row === r && selectedPos.col === c}
              tabbable={tabStop.row === r && tabStop.col === c}
              fireAt={s.enabled ? api.cellFireAt(cell) : 0}
              onselect={() => select({ row: r, col: c })}
              onactivate={() => activate({ row: r, col: c })}
              onfocus={() => (focusPos = { row: r, col: c })}
              oncontextmenu={() => (menuPos = { row: r, col: c })}
            />
          </div>
        {/each}
      </div>
    {/each}
  </div>
</ContextMenu>

{#if picker}
  {@const s = api.cellSummary(cellAt(picker.pos.row, picker.pos.col))}
  <GeneratorPicker anchor={picker.anchor} label={`Add Effect to ${s.label}`} onpick={pick} onclose={closePicker} />
{/if}

<style>
  .grid {
    --row-head-w: 156px;
    --grid-cell-h: 52px;
    display: grid;
    grid-template-columns: var(--row-head-w) repeat(var(--cols), minmax(96px, 1fr));
    gap: 4px;
    min-width: max-content;
    padding: 0 var(--space-3) var(--space-3) 0;
    outline: none;
  }
  .row {
    display: contents;
  }
  /* Headers stay put while a tall / wide grid scrolls under them (the view's scroller). The fill
     covers the gap strip too, so cells never peek through between headers. */
  .corner,
  .colhead {
    position: sticky;
    top: 0;
    z-index: 1;
    display: flex;
    align-items: flex-end;
    min-width: 0;
    height: 30px;
    padding: 0 var(--space-1) 4px;
    background: var(--grid-bg, var(--surface));
    box-shadow: 0 4px 0 var(--grid-bg, var(--surface));
  }
  .corner {
    left: 0;
    z-index: 2;
  }
  .collabel {
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    font-size: 11px;
    font-weight: 500;
    letter-spacing: 0.02em;
    color: var(--text-faint);
  }
  /* The trigger columns (Always / Clock / Cue) read as their own group after the zones. */
  .group {
    position: relative;
    margin-left: var(--space-2);
  }
  .group::before {
    content: '';
    position: absolute;
    top: 2px;
    bottom: 2px;
    left: calc(var(--space-2) * -0.5 - 2px - 0.5px);
    width: 1px;
    background: var(--border-faint);
  }
  .rowhead {
    position: sticky;
    left: 0;
    z-index: 1;
    display: flex;
    align-items: center;
    gap: var(--space-2);
    min-width: 0;
    height: var(--grid-cell-h);
    padding-left: var(--space-3);
    background: var(--grid-bg, var(--surface));
    box-shadow: 4px 0 0 var(--grid-bg, var(--surface));
  }
  .rowlabel {
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    font-size: var(--text-xs);
    font-weight: 500;
    color: var(--text-muted);
  }
  .rowhead.kit .rowlabel {
    flex: none;
    width: 36px;
    color: var(--ink);
  }
  .master {
    flex: 1;
    min-width: 0;
  }
  .dot {
    flex: none;
    width: 8px;
    height: 8px;
    border-radius: 50%;
    box-shadow: 0 0 0 1px rgba(255, 255, 255, 0.1);
  }
  .slot {
    min-width: 0;
  }
  .sr {
    position: absolute;
    width: 1px;
    height: 1px;
    overflow: hidden;
    clip-path: inset(50%);
    white-space: nowrap;
  }
</style>
