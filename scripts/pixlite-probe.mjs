#!/usr/bin/env node
// Throwaway PixLite Mk3 diagnostic. Reproduces the app's exact requests against a
// REAL controller and isolates the three hypotheses (dropped / malformed / silent).
//
//   node pixlite-probe.mjs <host> [port] [password]
//
// Prints, per attempt: elapsed ms, HTTP status, error name/message, body head.
// No deps. Uses node:http + node:crypto only (same as the app).

import http from 'node:http';
import { createHash } from 'node:crypto';

const host = process.argv[2];
const port = Number(process.argv[3] ?? 80);
const password = process.argv[4] ?? '';
if (!host) {
  console.error('usage: node pixlite-probe.mjs <host> [port] [password]');
  process.exit(1);
}
const auth = createHash('sha256').update(password, 'utf8').digest('base64url');
const STAT_BODY = '{"req":"statisticRead","id":1,"params":{"path":[""]}}';
const TIMEOUT = 2000; // same default as HttpPixliteClient

// One request. `agent` lets us toggle keep-alive. `path` is the raw request-target.
function once(label, { method, path, body, agent }) {
  return new Promise((resolve) => {
    const t0 = Date.now();
    const headers = body !== undefined
      ? { 'Content-Type': 'application/json', 'Content-Length': String(Buffer.byteLength(body)) }
      : {};
    const req = http.request(
      { host, port, method, path, headers, agent },
      (res) => {
        const chunks = [];
        res.on('data', (c) => chunks.push(c));
        res.on('end', () => {
          const b = Buffer.concat(chunks).toString('utf8');
          resolve({ label, ms: Date.now() - t0, status: res.statusCode,
            connHdr: res.headers.connection, bodyHead: b.slice(0, 160), bodyLen: b.length });
        });
      },
    );
    req.on('error', (e) =>
      resolve({ label, ms: Date.now() - t0, error: `${e.code ?? e.name}: ${e.message}` }));
    req.setTimeout(TIMEOUT, () => req.destroy(new Error(`timed out after ${TIMEOUT}ms`)));
    if (body !== undefined) req.write(body);
    req.end();
  });
}

// Keep-alive agent to mirror Node's default global agent (keepAlive true since Node 19).
const keepAlive = new http.Agent({ keepAlive: true, maxSockets: 1 });

const q = `?user=admin&auth=${auth}`;
const attempts = [
  // 0. Baseline — this is what "detection" uses. Expected to work.
  ['GET /ver (baseline, detection path)', { method: 'GET', path: '/ver', agent: false }],

  // 1. EXACT current app request: POST /v1.7/?... trailing slash, default keep-alive.
  ['POST /v1.7/?...  (current impl, keep-alive)',
    { method: 'POST', path: `/v1.7/${q}`, body: STAT_BODY, agent: keepAlive }],

  // 2. Same request but fresh connection (Connection: close) — tests keep-alive/socket-reuse.
  ['POST /v1.7/?...  (agent:false, fresh conn)',
    { method: 'POST', path: `/v1.7/${q}`, body: STAT_BODY, agent: false }],

  // 3. No trailing slash: /v1.7?... — matches the only concrete URL example in the spec (WS).
  ['POST /v1.7?...   (no trailing slash, fresh conn)',
    { method: 'POST', path: `/v1.7${q}`, body: STAT_BODY, agent: false }],

  // 4. GET the mgmt endpoint (in case reads want GET not POST).
  ['GET  /v1.7/?...  (GET instead of POST, fresh conn)',
    { method: 'GET', path: `/v1.7/${q}`, agent: false }],
];

(async () => {
  console.log(`host=${host}:${port}  auth=${auth}  password=${password ? '(set)' : '(empty)'}\n`);

  // Run each isolated attempt.
  for (const [label, spec] of attempts) {
    const r = await once(label, spec);
    console.log(fmt(r));
  }

  // 5. Reproduce the adopt->poll sequence over ONE shared keep-alive agent:
  //    probe /ver, then immediately POST statisticRead on the same pooled socket.
  console.log('\n-- adopt->poll reuse sequence (shared keep-alive agent) --');
  console.log(fmt(await once('  probe /ver (shared agent)',
    { method: 'GET', path: '/ver', agent: keepAlive })));
  console.log(fmt(await once('  POST statisticRead (shared agent, reused socket)',
    { method: 'POST', path: `/v1.7/${q}`, body: STAT_BODY, agent: keepAlive })));

  keepAlive.destroy();
})();

function fmt(r) {
  const head = `[${String(r.ms).padStart(5)}ms] ${r.label}`;
  if (r.error) return `${head}\n            ERROR  ${r.error}`;
  return `${head}\n            status=${r.status} conn=${r.connHdr} len=${r.bodyLen}` +
    `\n            body: ${r.bodyHead.replace(/\s+/g, ' ')}`;
}
