/* File IO adapter for Save / Load of Effect, cell and device files — the file twin of clipboard-io.ts. The
   store builds and applies the ClipDoc; this module only moves text to and from a file the user
   picks, so the store stays free of environment guards.

   Two routes, one contract:
   - Desktop (Tauri webview): native Save / Open panels through the shell's `save_text_file` /
     `open_text_file` commands. A WKWebView neither downloads an `<a download>` blob nor reliably
     shows an `<input type=file>` panel without host support, so the shell owns the dialogs. An
     older shell without the commands rejects with Tauri's ACL error — only then do we fall through
     to the browser route; any other rejection is a real IO failure and reads as `failed`.
   - Browser: the File System Access picker where it exists (Chrome/Edge), else a blob download;
     an `<input type=file>` for opening.

   Nothing here throws: every outcome is a value the store turns into a toast. */

/** What happened to a save. `cancelled` = the user closed the panel; nothing to report. */
export type SaveOutcome = 'saved' | 'cancelled' | 'failed';

/** A file the user picked, as text. */
export interface OpenedFile {
  name: string;
  text: string;
}

/** What happened to an open: the file, `cancelled`, or `failed` (unreadable / too large). */
export type OpenOutcome = OpenedFile | 'cancelled' | 'failed';

/** Refuse anything larger — an Effect file is kilobytes; a 16 MB one is the wrong file. */
export const MAX_FILE_BYTES = 16 * 1024 * 1024;

/** A file name safe on macOS, Windows and Linux: path/reserved characters become `-`, blank
    becomes `fallback`. The extension is the caller's. */
export function safeFileName(name: string, fallback: string): string {
  const cleaned = name.replace(/[\\/:*?"<>|\u0000-\u001f]+/g, '-').replace(/\s+/g, ' ').trim().replace(/^\.+/, '');
  return cleaned || fallback;
}

type Invoke = <T>(command: string, args?: Record<string, unknown>) => Promise<T>;

function isTauriRuntime(): boolean {
  return typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window;
}

async function tauriInvoke(): Promise<Invoke | null> {
  if (!isTauriRuntime()) return null;
  try {
    const core = await import('@tauri-apps/api/core');
    return core.invoke as Invoke;
  } catch {
    return null;
  }
}

/** Tauri refuses a command the shell never registered with `<command> not allowed. Command not
    found`; the shell's own IO errors are OS messages that never say "not allowed". */
function isMissingCommand(error: unknown): boolean {
  return /not allowed/i.test(String(error));
}

/** Ask the user where to save `text`, suggesting `fileName`. */
export async function saveTextFile(fileName: string, text: string): Promise<SaveOutcome> {
  const invoke = await tauriInvoke();
  if (invoke) {
    try {
      return (await invoke<boolean>('save_text_file', { suggestedName: fileName, contents: text })) ? 'saved' : 'cancelled';
    } catch (error) {
      // An older desktop shell has no such command — the browser route below may still work.
      if (!isMissingCommand(error)) return 'failed';
    }
  }
  return saveInBrowser(fileName, text);
}

/** Ask the user for a `.json` file and read it as text. */
export async function openTextFile(): Promise<OpenOutcome> {
  const invoke = await tauriInvoke();
  if (invoke) {
    try {
      const file = await invoke<{ name: string; contents: string } | null>('open_text_file');
      return file ? { name: file.name, text: file.contents } : 'cancelled';
    } catch (error) {
      // Older shell, as above.
      if (!isMissingCommand(error)) return 'failed';
    }
  }
  return openInBrowser();
}

type SavePicker = (options: {
  suggestedName: string;
  types: Array<{ description: string; accept: Record<string, string[]> }>;
}) => Promise<{ createWritable(): Promise<{ write(data: string): Promise<void>; close(): Promise<void> }> }>;

async function saveInBrowser(fileName: string, text: string): Promise<SaveOutcome> {
  if (typeof window === 'undefined' || typeof document === 'undefined') return 'failed';
  const picker = (window as unknown as { showSaveFilePicker?: SavePicker }).showSaveFilePicker;
  if (picker) {
    try {
      const handle = await picker({ suggestedName: fileName, types: [{ description: 'LEDrums file', accept: { 'application/json': ['.json'] } }] });
      const writable = await handle.createWritable();
      await writable.write(text);
      await writable.close();
      return 'saved';
    } catch (error) {
      return (error as { name?: string })?.name === 'AbortError' ? 'cancelled' : 'failed';
    }
  }
  try {
    // No picker: a download lands in the browser's downloads folder. It can't report a cancel.
    const url = URL.createObjectURL(new Blob([text], { type: 'application/json' }));
    const link = document.createElement('a');
    link.href = url;
    link.download = fileName;
    link.style.display = 'none';
    document.body.append(link);
    link.click();
    link.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
    return 'saved';
  } catch {
    return 'failed';
  }
}

function openInBrowser(): Promise<OpenOutcome> {
  if (typeof document === 'undefined') return Promise.resolve('failed');
  return new Promise((resolve) => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = '.json,application/json';
    input.style.display = 'none';
    let settled = false;
    const settle = (outcome: OpenOutcome): void => {
      if (settled) return;
      settled = true;
      input.remove();
      resolve(outcome);
    };
    input.addEventListener('cancel', () => settle('cancelled'));
    input.addEventListener('change', () => {
      const file = input.files?.[0];
      if (!file) return settle('cancelled');
      if (file.size > MAX_FILE_BYTES) return settle('failed');
      file.text().then(
        (text) => settle({ name: file.name, text }),
        () => settle('failed'),
      );
    });
    document.body.append(input);
    input.click();
  });
}
