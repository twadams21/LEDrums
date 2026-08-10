import assert from 'node:assert/strict';
import { test } from 'node:test';
import { assessArchCoverage, assessRequiredBinaries, isMachO, parseLipoArchs } from './mach-o.mjs';

const bytes = (...b) => Buffer.from(b);

test('isMachO recognises 64-bit Mach-O executables in both byte orders', () => {
  assert.equal(isMachO(bytes(0xfe, 0xed, 0xfa, 0xcf)), true); // MH_MAGIC_64
  assert.equal(isMachO(bytes(0xcf, 0xfa, 0xed, 0xfe)), true); // MH_CIGAM_64
});

test('isMachO recognises fat archives (the shape a universal binary has)', () => {
  assert.equal(isMachO(bytes(0xca, 0xfe, 0xba, 0xbe)), true); // FAT_MAGIC
  assert.equal(isMachO(bytes(0xca, 0xfe, 0xba, 0xbf)), true); // FAT_MAGIC_64
  assert.equal(isMachO(bytes(0xbe, 0xba, 0xfe, 0xca)), true); // FAT_CIGAM
});

test('isMachO ignores ordinary bundle payload (scripts, images, html)', () => {
  assert.equal(isMachO(Buffer.from('#!/b')), false);
  assert.equal(isMachO(Buffer.from('<!DO')), false);
  assert.equal(isMachO(bytes(0x89, 0x50, 0x4e, 0x47)), false); // PNG
});

test('isMachO is false for a truncated or missing head rather than throwing', () => {
  assert.equal(isMachO(bytes(0xfe, 0xed)), false);
  assert.equal(isMachO(Buffer.alloc(0)), false);
  assert.equal(isMachO(undefined), false);
});

test('parseLipoArchs reads the architecture list, thin or fat', () => {
  assert.deepEqual(parseLipoArchs('x86_64 arm64\n'), ['x86_64', 'arm64']);
  assert.deepEqual(parseLipoArchs('arm64\n'), ['arm64']);
  assert.deepEqual(parseLipoArchs('  x86_64   arm64  '), ['x86_64', 'arm64']);
  assert.deepEqual(parseLipoArchs(''), []);
});

test('assessArchCoverage passes only when every binary carries every required arch', () => {
  const verdict = assessArchCoverage(
    [
      { path: 'Contents/MacOS/LEDrums', archs: ['x86_64', 'arm64'] },
      { path: 'Contents/MacOS/ledrums-server', archs: ['arm64', 'x86_64'] },
    ],
    ['x86_64', 'arm64'],
  );
  assert.equal(verdict.ok, true);
  assert.equal(verdict.checked, 2);
  assert.deepEqual(verdict.thin, []);
});

test('assessArchCoverage fails a bundle whose sidecar is single-arch, naming what is missing', () => {
  // The exact regression the guard exists for: shell lipo'd by Tauri, sidecar left thin.
  const verdict = assessArchCoverage(
    [
      { path: 'Contents/MacOS/LEDrums', archs: ['x86_64', 'arm64'] },
      { path: 'Contents/MacOS/ledrums-server', archs: ['x86_64'] },
    ],
    ['x86_64', 'arm64'],
  );
  assert.equal(verdict.ok, false);
  assert.equal(verdict.checked, 2);
  assert.deepEqual(verdict.thin, [
    { path: 'Contents/MacOS/ledrums-server', archs: ['x86_64'], missing: ['arm64'] },
  ]);
});

test('assessArchCoverage reports every missing arch, not just the first', () => {
  const verdict = assessArchCoverage([{ path: 'Contents/Resources/cloudflared', archs: ['i386'] }], ['x86_64', 'arm64']);
  assert.equal(verdict.ok, false);
  assert.deepEqual(verdict.thin[0].missing, ['x86_64', 'arm64']);
});

test('assessArchCoverage on an empty bundle is not a pass by default', () => {
  // It returns ok:true (nothing violated the rule), so the CLI must treat "no binaries found" as a
  // failure separately — this pins that the pure layer does NOT smuggle in that judgement.
  const verdict = assessArchCoverage([], ['x86_64', 'arm64']);
  assert.equal(verdict.checked, 0);
});

const BUNDLE = [
  { path: 'Contents/MacOS/LEDrums', archs: ['x86_64', 'arm64'] },
  { path: 'Contents/MacOS/ledrums-server', archs: ['x86_64', 'arm64'] },
  { path: 'Contents/Resources/cloudflared/cloudflared', archs: ['x86_64', 'arm64'] },
];

test('assessRequiredBinaries finds a required binary by basename, wherever it sits', () => {
  const verdict = assessRequiredBinaries(BUNDLE, ['cloudflared', 'ledrums-server']);
  assert.equal(verdict.ok, true);
  assert.deepEqual(verdict.missing, []);
});

test('assessRequiredBinaries catches the vacuous pass: an all-fat bundle with cloudflared MISSING', () => {
  // The exact hole arch-checking cannot see — drop the fetch step and every remaining binary is
  // still universal, so assessArchCoverage alone reports success over an incomplete bundle.
  const withoutTunnel = BUNDLE.filter((e) => !e.path.endsWith('cloudflared'));
  assert.equal(assessArchCoverage(withoutTunnel, ['x86_64', 'arm64']).ok, true);

  const verdict = assessRequiredBinaries(withoutTunnel, ['cloudflared']);
  assert.equal(verdict.ok, false);
  assert.deepEqual(verdict.missing, ['cloudflared']);
});

test('assessRequiredBinaries reports every absentee, and requiring nothing passes', () => {
  assert.deepEqual(assessRequiredBinaries([], ['cloudflared', 'ledrums-server']).missing, [
    'cloudflared',
    'ledrums-server',
  ]);
  assert.equal(assessRequiredBinaries(BUNDLE, []).ok, true);
});

test('assessRequiredBinaries matches the basename exactly, not a suffix', () => {
  // `ledrums-server` must not be satisfied by `ledrums-server-x86_64-apple-darwin` sitting nearby.
  const verdict = assessRequiredBinaries([{ path: 'Contents/MacOS/xx-cloudflared' }], ['cloudflared']);
  assert.equal(verdict.ok, false);
});
