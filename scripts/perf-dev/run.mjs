#!/usr/bin/env node
import { createRequire } from 'node:module';
import { pathToFileURL } from 'node:url';
import { HELP, parseOptions } from './options.mjs';
import { runBenchmark } from './driver.mjs';

export async function main(args = process.argv.slice(2)) {
  const options = parseOptions(args);
  if (options.help) { console.log(HELP); return; }
  // Reuse the installed server dependency; no root dependency, install or global ws lookup.
  const serverRequire = createRequire(new URL('../../apps/server/package.json', import.meta.url));
  const { WebSocket } = serverRequire('ws');
  const aborter = new AbortController();
  const interrupt = () => aborter.abort();
  process.once('SIGINT', interrupt);
  process.once('SIGTERM', interrupt);
  try {
    const result = await runBenchmark(options, { WebSocket, signal: aborter.signal });
    console.log(JSON.stringify(result, null, 2));
    if (!result.ok) process.exitCode = 1;
  } finally {
    process.removeListener('SIGINT', interrupt);
    process.removeListener('SIGTERM', interrupt);
  }
}

if (process.argv[1] && pathToFileURL(process.argv[1]).href === import.meta.url) {
  main().catch((error) => { console.error(`perf-dev: ${error.message}`); process.exitCode = 1; });
}
