import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

// All rejected before Playwright is loaded or a browser/network connection is started.
for (const args of [[], ['http://example.com:5294'], ['http://localhost:5294'], ['http://127.0.0.1:4321'],
  ['http://127.0.0.1:5173'], ['file:///tmp/test'], ['http://user:pass@127.0.0.1:5294'],
  ['http://127.0.0.1:5294/?style'], ['http://127.0.0.1:5294', 'extra']]) {
  test(`GPU check refuses unsafe/ambiguous URL arguments: ${JSON.stringify(args)}`, () => {
    const result = spawnSync(process.execPath, [fileURLToPath(new URL('./browser-check.mjs', import.meta.url)), ...args], {
      encoding: 'utf8', timeout: 10000,
    });
    assert.equal(result.status, 1);
    assert.match(result.stderr, /Refusing: supply one non-default literal-loopback isolated Vite URL/);
    assert.equal(result.stdout, '');
  });
}
