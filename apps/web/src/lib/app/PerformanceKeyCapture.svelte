<script lang="ts">
  import { claimPerformanceKey, decidePerformanceKey } from './performance-key';
  import { performanceKeyTarget } from './performance-key-target';
  import type { View } from './shell-nav';

  type Section = { id: string };

  export interface PerformanceKeyStore {
    activeSong: { sections: readonly Section[] } | null;
    activeSectionId: string | null;
    fireSectionGraph(index: number): void;
    setActiveSection(id: string): void;
  }

  export interface PerformanceKeyShell {
    view: View;
    settingsPane: unknown;
  }

  let { store, shell }: { store: PerformanceKeyStore; shell: PerformanceKeyShell } = $props();

  function onKey(e: KeyboardEvent): void {
    const target = performanceKeyTarget(e);
    const decision = decidePerformanceKey({
      key: e.key,
      view: shell.view,
      settingsOpen: shell.settingsPane !== null || target.inModal,
      repeat: e.repeat,
      ctrlKey: e.ctrlKey,
      metaKey: e.metaKey,
      altKey: e.altKey,
      shiftKey: e.shiftKey,
      ...target,
    });
    claimPerformanceKey(e, decision);
    if (decision.fireGraphIndex !== undefined) {
      store.fireSectionGraph(decision.fireGraphIndex);
      return;
    }
    if (decision.sectionStep === undefined) return;
    const sections = store.activeSong?.sections ?? [];
    if (sections.length === 0) return;
    const current = sections.findIndex((section) => section.id === store.activeSectionId);
    const next = sections[(current + decision.sectionStep + sections.length) % sections.length];
    if (next) store.setActiveSection(next.id);
  }
</script>

<svelte:window onkeydowncapture={onKey} />
