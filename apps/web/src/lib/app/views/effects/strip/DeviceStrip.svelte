<script lang="ts">
  /* PLACEHOLDER (ui-grid) — ui-strip-chain ships the real DeviceStrip at this path and wins at merge. */
  import type { CellSelection, EffectsAuthoringApi } from '../../../../trigger-lab/effects-api';
  let { api, cell }: { api: EffectsAuthoringApi; cell: CellSelection | null } = $props();
</script>

<div class="strip-placeholder" data-can-edit={api.canEdit} data-cell={cell === null ? '' : typeof cell === 'string' ? cell : cell.row}></div>
