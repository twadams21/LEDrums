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
