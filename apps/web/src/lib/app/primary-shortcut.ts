export type ShortcutPlatform = 'mac' | 'other';

export interface ModifierLike {
  ctrlKey: boolean;
  metaKey: boolean;
}

export function platformShortcutModifier(platform: string): ShortcutPlatform {
  return /Mac|iPhone|iPad|iPod/i.test(platform) ? 'mac' : 'other';
}

export function hasPrimaryModifier(event: ModifierLike, platform: ShortcutPlatform): boolean {
  return platform === 'mac' ? event.metaKey && !event.ctrlKey : event.ctrlKey && !event.metaKey;
}

/** True when a global shortcut event started inside user-editable text UI. Keep this
    structural (rather than `instanceof HTMLElement`) so it stays unit-testable in node and
    safe during SSR. */
export function isEditableShortcutTarget(target: EventTarget | null | undefined): boolean {
  if (!target || typeof target !== 'object') return false;
  const el = target as {
    isContentEditable?: boolean;
    tagName?: string;
    closest?: (selector: string) => unknown;
  };
  if (el.isContentEditable) return true;
  const tag = el.tagName?.toLowerCase();
  if (tag === 'input' || tag === 'textarea' || tag === 'select') return true;
  return (
    typeof el.closest === 'function' &&
    !!el.closest('input, textarea, select, [contenteditable="true"], [contenteditable="plaintext-only"]')
  );
}
