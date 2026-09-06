<script lang="ts">
  import {
    dispatchAppKeyboard,
    type AppKeyboardShell,
    type AppKeyboardStore,
  } from './app-keyboard';
  import type { ShortcutPlatform } from './primary-shortcut';
  import type { ShortcutEntry } from './shortcuts';

  type Props = {
    store: AppKeyboardStore;
    shell: AppKeyboardShell;
    shortcuts: readonly ShortcutEntry[];
    shortcutPlatform: ShortcutPlatform;
  };

  let { store, shell, shortcuts, shortcutPlatform }: Props = $props();

  function onKey(event: KeyboardEvent): void {
    dispatchAppKeyboard({ event, store, shell, shortcuts, shortcutPlatform });
  }
</script>

<svelte:window onkeydowncapture={onKey} />
