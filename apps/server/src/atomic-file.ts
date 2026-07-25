import { mkdirSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { mkdir, rename, rm, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';

/** Monotonic suffix so concurrent writers never collide on the same temp file. */
let tmpSeq = 0;

/** Resolve a unique same-directory temp file for an atomic write target. */
function tmpPath(final: string): string {
  return `${final}.${process.pid}.${tmpSeq++}.tmp`;
}

/**
 * Atomically write a file by writing a unique same-directory temp file and renaming it into
 * place. The same-directory rename keeps the write on one filesystem, so readers never observe
 * a half-written target file. UTF-8 text (`string`) is the common case; a `Uint8Array` is
 * written verbatim (the snapshot store's gzipped bundles, #123) — Node ignores the encoding
 * argument for a buffer, so the same helper serves both.
 */
export function writeFileAtomicSync(final: string, data: string | Uint8Array): void {
  mkdirSync(dirname(final), { recursive: true });
  const tmp = tmpPath(final);
  try {
    writeFileSync(tmp, data, 'utf8');
    renameSync(tmp, final);
  } catch (err) {
    rmSync(tmp, { force: true });
    throw err;
  }
}

/** Async variant of {@link writeFileAtomicSync} for debounced background saves. */
export async function writeFileAtomic(final: string, data: string | Uint8Array): Promise<void> {
  await mkdir(dirname(final), { recursive: true });
  const tmp = tmpPath(final);
  try {
    await writeFile(tmp, data, 'utf8');
    await rename(tmp, final);
  } catch (err) {
    await rm(tmp, { force: true }).catch(() => {});
    throw err;
  }
}
