/* System-clipboard IO adapter (S44). The thinnest possible wrapper over `navigator.clipboard`,
   isolated here so the store's copy/paste orchestration stays free of environment guards and the
   pure ClipDoc module (clipdoc.ts) never touches the DOM. Both calls degrade gracefully:
   `writeClipboardText` returns whether the write landed; `readClipboardText` returns null when the
   clipboard is unreadable (no API, SSR/node, or a denied permission) so the caller can fall back to
   a manual paste field rather than throwing. */

/** Write text to the system clipboard. Returns false when the API is absent or the write is
    rejected (e.g. no user gesture / denied permission) — never throws. */
export async function writeClipboardText(text: string): Promise<boolean> {
  try {
    if (typeof navigator === 'undefined' || !navigator.clipboard?.writeText) return false;
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    return false;
  }
}

/** Read text from the system clipboard, or null when it can't be read (absent API, SSR/node, or a
    denied/blocked read permission). Null is the caller's cue to offer a paste-text fallback. */
export async function readClipboardText(): Promise<string | null> {
  try {
    if (typeof navigator === 'undefined' || !navigator.clipboard?.readText) return null;
    return await navigator.clipboard.readText();
  } catch {
    return null;
  }
}
