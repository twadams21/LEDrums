<script lang="ts">
  /* Patch copy / paste toolbar (group K / S45). Copy writes the current rig's device slices as a
     portable `patch` ClipDoc to the system clipboard; paste reads one back, diffs it, and — behind
     an explicit confirm (PatchDiffDialog) — re-rigs the device via the bulk `setProject` message.
     Non-patch or unreadable clipboard content is a friendly inline notice, never a silent failure;
     a server-side rejection (invalid payload) surfaces through the same notice via store.serverError.
     Patch-specific by design so it never collides with S44's generic authored-kinds clipboard UI. */
  import type { TriggerLab } from '../../trigger-lab/store.svelte';
  import { parse, isClipParseError, type ClipDocKind } from '../../trigger-lab/clipdoc';
  import { diffPatch, type PatchDiff } from '../../trigger-lab/patch-diff';
  import type { PatchPayload } from '../../trigger-lab/clipdoc';
  import IconButton from '../../ui/IconButton.svelte';
  import PatchDiffDialog from './PatchDiffDialog.svelte';
  import Copy from '@lucide/svelte/icons/copy';
  import ClipboardCheck from '@lucide/svelte/icons/clipboard-check';
  import ClipboardPaste from '@lucide/svelte/icons/clipboard-paste';
  import X from '@lucide/svelte/icons/x';

  let { store }: { store: TriggerLab } = $props();

  let copied = $state(false);
  let copyTimer: ReturnType<typeof setTimeout> | null = null;
  let localError = $state<string | null>(null);
  let dialogOpen = $state(false);
  let pending = $state<{ patch: PatchPayload; diff: PatchDiff } | null>(null);

  /** The active notice: a local paste problem takes precedence, else a server rejection. */
  const notice = $derived(localError ?? store.serverError);

  const KIND_LABEL: Record<ClipDocKind, string> = {
    graph: 'a trigger graph',
    section: 'a section',
    song: 'a song',
    patch: 'a patch',
  };

  async function copy(): Promise<void> {
    localError = null;
    const ok = await store.copyPatch();
    if (!ok) {
      localError = store.project ? 'Could not copy — the clipboard is unavailable here.' : 'Connect to a rig to copy its patch.';
      return;
    }
    copied = true;
    if (copyTimer) clearTimeout(copyTimer);
    copyTimer = setTimeout(() => (copied = false), 1400);
  }

  async function paste(): Promise<void> {
    localError = null;
    store.clearServerError();
    if (!navigator.clipboard?.readText) {
      localError = 'Pasting a patch isn’t supported in this browser.';
      return;
    }
    let text: string;
    try {
      text = await navigator.clipboard.readText();
    } catch {
      localError = 'Clipboard read was blocked — allow clipboard access and try again.';
      return;
    }
    const doc = parse(text);
    if (isClipParseError(doc)) {
      localError = 'The clipboard doesn’t contain a LEDrums patch.';
      return;
    }
    if (doc.kind !== 'patch') {
      localError = `That’s ${KIND_LABEL[doc.kind]}, not a patch — paste it in its own view.`;
      return;
    }
    pending = { patch: doc.payload.patch, diff: diffPatch(store.project, doc.payload.patch) };
    dialogOpen = true;
  }

  function confirmApply(): void {
    if (pending) store.setProjectPatch(pending.patch);
    dialogOpen = false;
    pending = null;
  }

  function closeDialog(): void {
    dialogOpen = false;
    pending = null;
  }
</script>

<div class="patch-clip">
  <div class="tools">
    <IconButton
      icon={copied ? ClipboardCheck : Copy}
      label={copied ? 'Copied patch' : 'Copy patch'}
      variant="soft"
      disabled={!store.project}
      onclick={copy}
    />
    <IconButton
      icon={ClipboardPaste}
      label="Paste patch"
      variant="soft"
      disabled={!store.canEdit}
      onclick={paste}
    />
  </div>

  {#if notice}
    <div class="notice" role="status">
      <span class="ntext">{notice}</span>
      <button
        type="button"
        class="ndismiss"
        aria-label="Dismiss"
        onclick={() => {
          localError = null;
          store.clearServerError();
        }}
      >
        <X size={13} aria-hidden="true" />
      </button>
    </div>
  {/if}
</div>

<PatchDiffDialog open={dialogOpen} diff={pending?.diff ?? null} onConfirm={confirmApply} onClose={closeDialog} />

<style>
  .patch-clip {
    display: flex;
    align-items: center;
    gap: var(--space-2);
    min-width: 0;
  }
  .tools {
    display: inline-flex;
    gap: var(--space-1);
    flex: none;
  }
  /* Enter softly from a small offset — an exit-lighter-than-enter notice (skill §6). */
  .notice {
    display: inline-flex;
    align-items: center;
    gap: var(--space-2);
    max-width: 46ch;
    min-width: 0;
    padding: 3px 3px 3px var(--space-2);
    border: 1px solid var(--border-faint);
    border-radius: var(--radius-2);
    background: var(--surface-inset);
    animation: notice-in var(--dur-150) var(--ease-control);
  }
  .ntext {
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    font-size: var(--text-2xs);
    color: var(--text-muted);
  }
  .ndismiss {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    flex: none;
    width: 20px;
    height: 20px;
    border-radius: var(--radius-1);
    color: var(--text-faint);
    line-height: 0;
    transition-property: background-color, color;
    transition-duration: var(--dur-120);
  }
  .ndismiss:hover {
    background: var(--surface);
    color: var(--ink);
  }
  @keyframes notice-in {
    from {
      opacity: 0;
      transform: translateY(-3px);
    }
    to {
      opacity: 1;
      transform: translateY(0);
    }
  }
  @media (prefers-reduced-motion: reduce) {
    .notice {
      animation: none;
    }
  }
</style>
