import type { IncomingMessage, ServerResponse } from 'node:http';
import { existsSync, readFileSync, statSync } from 'node:fs';
import { dirname, extname, join, normalize, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
/** Default web build output, resolved relative to this module (apps/web/dist). */
export const DEFAULT_WEB_ROOT = resolve(here, '..', '..', 'web', 'dist');

/**
 * Resolve the directory the built web UI is served from. An explicit `LEDRUMS_WEB_ROOT`
 * wins — the packaged desktop shell (S4) points it at the web `dist` it bundles as a Tauri
 * resource, since the in-repo {@link DEFAULT_WEB_ROOT} path does not exist inside a packaged
 * binary. Unset (plain `pnpm dev`/`pnpm start`) falls back to {@link DEFAULT_WEB_ROOT}, so
 * today's behavior is unchanged. Pure over `env` so it is unit-testable.
 */
export function resolveWebRoot(env: NodeJS.ProcessEnv = process.env): string {
  const override = env.LEDRUMS_WEB_ROOT?.trim();
  return override ? resolve(override) : DEFAULT_WEB_ROOT;
}

const CONTENT_TYPES: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
  '.map': 'application/json; charset=utf-8',
  '.woff2': 'font/woff2',
};

const PLACEHOLDER = `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>LEDrums</title>
    <style>
      body { font-family: system-ui, sans-serif; background: #0b0b0f; color: #e6e6ee;
             display: grid; place-items: center; height: 100vh; margin: 0; }
      code { background: #1c1c26; padding: 2px 6px; border-radius: 4px; }
    </style>
  </head>
  <body>
    <main>
      <h1>LEDrums</h1>
      <p>Web app not built yet &mdash; run <code>pnpm build</code>.</p>
    </main>
  </body>
</html>
`;

function contentType(filePath: string): string {
  return CONTENT_TYPES[extname(filePath).toLowerCase()] ?? 'application/octet-stream';
}

/** Resolve a URL path to a file inside `rootDir`, guarding against traversal. */
function resolveSafe(rootDir: string, urlPath: string): string | null {
  // Strip query/hash and decode; default '/' to index.html.
  const cleanUrl = urlPath.split('?')[0]!.split('#')[0]!;
  let decoded: string;
  try {
    decoded = decodeURIComponent(cleanUrl);
  } catch {
    return null;
  }
  const rel = normalize(decoded).replace(/^(\.\.[/\\])+/, '');
  const candidate = resolve(rootDir, '.' + (rel.startsWith('/') ? rel : '/' + rel));
  // Containment check: must stay within rootDir.
  if (candidate !== rootDir && !candidate.startsWith(rootDir + sep)) return null;
  return candidate;
}

/**
 * Serve a static asset for `req` from `rootDir` (default {@link DEFAULT_WEB_ROOT}).
 * SPA-fallback to `index.html` for unknown paths. If the build is missing entirely,
 * writes a placeholder so the server still boots. Returns `true` when handled.
 */
export function serveStatic(
  req: IncomingMessage,
  res: ServerResponse,
  rootDir: string = DEFAULT_WEB_ROOT,
): boolean {
  const indexPath = join(rootDir, 'index.html');

  // No build at all: serve the placeholder for everything.
  if (!existsSync(indexPath)) {
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
    res.end(PLACEHOLDER);
    return true;
  }

  const urlPath = req.url ?? '/';
  let target = resolveSafe(rootDir, urlPath === '/' ? '/index.html' : urlPath);

  // Traversal attempt or unresolvable → fall back to the SPA entry.
  if (target === null) target = indexPath;

  // Directory → its index.html; missing file → SPA fallback.
  if (existsSync(target) && statSync(target).isDirectory()) {
    target = join(target, 'index.html');
  }
  if (!existsSync(target) || !statSync(target).isFile()) {
    target = indexPath;
  }

  try {
    const body = readFileSync(target);
    res.writeHead(200, { 'Content-Type': contentType(target) });
    res.end(body);
  } catch {
    res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
    res.end('Not found');
  }
  return true;
}
