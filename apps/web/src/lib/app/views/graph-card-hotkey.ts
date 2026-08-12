/** Hotkey label for the n-th graph card in the active section: keys 1–9 fire graphs
    1–9 and 0 fires the tenth — the display-side mirror of App.svelte's global handler
    (which maps '0' back to index 9). Cards beyond the tenth have no hotkey. */
export function hotkeyLabel(index: number): string | null {
  if (index < 0) return null;
  if (index < 9) return String(index + 1);
  if (index === 9) return '0';
  return null;
}
