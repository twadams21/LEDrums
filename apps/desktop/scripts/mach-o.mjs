// Pure helpers for reasoning about Mach-O binaries inside a macOS bundle.
//
// Kept free of IO so the universal-bundle parity guard (verify-universal.mjs) can be unit-tested
// without building a .app: the guard supplies bytes and `lipo` output, this module decides.

/** Mach-O / fat-archive magic numbers, as the first 4 bytes read big-endian. */
const MACH_O_MAGIC = new Set([
  0xfeedface, // MH_MAGIC      32-bit
  0xcefaedfe, // MH_CIGAM      32-bit, byte-swapped
  0xfeedfacf, // MH_MAGIC_64
  0xcffaedfe, // MH_CIGAM_64
  0xcafebabe, // FAT_MAGIC     universal archive
  0xbebafeca, // FAT_CIGAM
  0xcafebabf, // FAT_MAGIC_64
  0xbfbafeca, // FAT_CIGAM_64
]);

/**
 * Does this file start with a Mach-O (or Mach-O fat archive) magic number?
 *
 * Detection is by magic, not by extension: the binaries that matter inside a `.app` — the shell
 * executable, the sidecar, cloudflared — have no extension at all.
 *
 * Caveat worth knowing: `0xCAFEBABE` is ALSO the Java `.class` magic. A `.class` file would be
 * reported here as a Mach-O and then fail `lipo`, which the guard treats as a hard error rather
 * than a silent skip (fail closed). There are no `.class` files in this bundle; if that ever
 * changes, exempt it explicitly rather than loosening the magic test.
 *
 * @param {Buffer|Uint8Array} head first bytes of the file (4 are enough)
 */
export function isMachO(head) {
  if (!head || head.length < 4) return false;
  const magic = ((head[0] << 24) | (head[1] << 16) | (head[2] << 8) | head[3]) >>> 0;
  return MACH_O_MAGIC.has(magic);
}

/**
 * Parse the architecture list `lipo -archs <file>` prints (one space-separated line, e.g.
 * `x86_64 arm64`). A thin binary prints exactly one.
 *
 * @param {string} stdout raw `lipo -archs` output
 * @returns {string[]}
 */
export function parseLipoArchs(stdout) {
  return String(stdout ?? '')
    .trim()
    .split(/\s+/)
    .filter(Boolean);
}

/**
 * The parity verdict for a whole bundle: EVERY Mach-O must carry EVERY required architecture.
 *
 * This is the guard the universal build exists to satisfy. A universal `.app` whose sidecar (or
 * cloudflared, or any dylib) is thin still installs and still launches on the builder's machine —
 * it just silently runs under Rosetta, or fails outright, for everyone on the other architecture.
 * That regression is invisible to every other check, so it gets its own explicit assertion.
 *
 * @param {{path: string, archs: string[]}[]} entries every Mach-O found, with its architectures
 * @param {string[]} required architectures that must be present in each
 * @returns {{ok: boolean, thin: {path: string, archs: string[], missing: string[]}[], checked: number}}
 */
export function assessArchCoverage(entries, required) {
  const thin = [];
  for (const entry of entries) {
    const missing = required.filter((arch) => !entry.archs.includes(arch));
    if (missing.length > 0) thin.push({ path: entry.path, archs: entry.archs, missing });
  }
  return { ok: thin.length === 0, thin, checked: entries.length };
}

/**
 * Which of the binaries the caller EXPECTED to find are actually in the bundle, by basename.
 *
 * `assessArchCoverage` can only judge what is there — a binary that never made it into the bundle
 * passes it vacuously. That is a real hole in a release: if the cloudflared fetch step were removed
 * or silently skipped, the guard would happily report "all Mach-Os universal" over a bundle that
 * simply has no cloudflared in it. So a caller that knows what the bundle must contain says so, and
 * absence becomes a failure rather than a smaller checklist.
 *
 * @param {{path: string}[]} entries every Mach-O found (paths relative to the bundle)
 * @param {string[]} required basenames that must appear, e.g. ['cloudflared']
 * @returns {{ok: boolean, missing: string[]}}
 */
export function assessRequiredBinaries(entries, required) {
  const names = new Set(entries.map((e) => e.path.split('/').pop()));
  const missing = required.filter((name) => !names.has(name));
  return { ok: missing.length === 0, missing };
}
