// Unit tests for the bootstrap-shell token substitution (S08). Uses the built-in node:test runner
// (no extra dependency) so `pnpm -r run test` picks it up in this build-script-only package.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { substituteShellTokens, readTokenValue, SHELL_TOKEN_NAMES } from './shell-tokens.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const desktopDir = join(here, '..');
const repoRoot = join(desktopDir, '..', '..');
const tokensCss = readFileSync(join(repoRoot, 'apps', 'web', 'src', 'styles', 'tokens.css'), 'utf8');
const templateHtml = readFileSync(join(desktopDir, 'shell', 'index.template.html'), 'utf8');

const HEX_COLOR = /#[0-9a-fA-F]{3,8}\b/;

test('readTokenValue returns the base :root value (first match), not an accent override', () => {
  // --accent is re-declared in the [data-accent] blocks below the base :root; first-match must win.
  assert.equal(readTokenValue(tokensCss, '--accent'), 'oklch(0.845 0.190 128)');
  assert.equal(readTokenValue(tokensCss, '--bg'), 'oklch(0.124 0.011 256)');
});

test('substitution replaces every shell placeholder with the real token value', () => {
  const out = substituteShellTokens(templateHtml, tokensCss);
  for (const name of SHELL_TOKEN_NAMES) {
    const value = readTokenValue(tokensCss, name);
    assert.ok(value, `token ${name} missing from tokens.css`);
    assert.ok(out.includes(`${name}: ${value};`), `expected ${name} substituted to ${value}`);
  }
});

test('the generated shell page carries token (oklch) values and NO hardcoded hex', () => {
  const out = substituteShellTokens(templateHtml, tokensCss);
  assert.ok(out.includes('oklch('), 'expected substituted oklch values');
  assert.doesNotMatch(out, HEX_COLOR, 'no hardcoded hex colour may remain in the served shell');
});

test('substitution rewrites hex placeholders → oklch (works even from a hex template)', () => {
  const template = ':root { --bg: #0b0b0f; --accent: #7c6cff; --live: #ff5c6c; }';
  const out = substituteShellTokens(template, tokensCss, ['--bg', '--accent', '--live']);
  assert.doesNotMatch(out, HEX_COLOR);
  assert.ok(out.includes('--bg: oklch(0.124 0.011 256);'));
  assert.ok(out.includes('--accent: oklch(0.845 0.190 128);'));
});

test('a missing token in the source CSS fails the build loudly', () => {
  assert.throws(() => substituteShellTokens(templateHtml, ':root {}'), /not found in tokens\.css/);
});

test('a template missing a declaration to substitute fails loudly', () => {
  assert.throws(
    () => substituteShellTokens('<style>:root {}</style>', tokensCss, ['--bg']),
    /missing a --bg declaration/,
  );
});
