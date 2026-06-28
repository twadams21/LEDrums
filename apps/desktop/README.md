# @ledrums/desktop — Tauri 2 desktop shell

Packages LEDrums as a native desktop app. The Rust shell spawns the LEDrums **server** as a
self-contained **sidecar binary**, bundles the built **web UI** and **cloudflared** as
resources, and surfaces the remote-share **URL + room PIN** in a small native window (the
in-webview ShareInfo lives behind the PIN gate, so the host needs an out-of-band surface to
read the PIN from).

```
apps/desktop/
  shell/index.html          native "share" surface (URL + PIN + copy buttons) → frontendDist
  scripts/
    prepare-bundle.mjs       beforeBuild/Dev: build web → stage web-dist → build sidecar
    build-sidecar.mjs        esbuild bundle + Node SEA → src-tauri/binaries/ledrums-server-<triple>
    fetch-cloudflared.mjs    download the platform cloudflared into src-tauri/cloudflared/
  src-tauri/                 Tauri crate (Cargo.toml, tauri.conf.json, src/lib.rs, icons, capabilities)
    binaries/                sidecar lands here (Tauri externalBin convention)
    cloudflared/             cloudflared resource lands here (gitignored binary)
    web-dist/  (../web-dist) staged copy of apps/web/dist, bundled as a resource
```

## Develop / build

```bash
# one-time: fetch the platform cloudflared (optional — app degrades to local/LAN without it)
pnpm --filter @ledrums/desktop fetch:cloudflared

# dev (runs prepare-bundle: builds web + sidecar, then tauri dev)
pnpm --filter @ledrums/desktop dev

# production bundle (runs cargo build + web build + sidecar build + bundling)
pnpm --filter @ledrums/desktop build
# or, from the repo root:
pnpm tauri:build
```

`pnpm tauri:build` is the only desktop hook wired into the root — the default `pnpm build`
does **not** require a Rust toolchain.

### Just the sidecar binary

```bash
pnpm --filter @ledrums/desktop build:sidecar          # for the host triple
node scripts/build-sidecar.mjs --triple aarch64-apple-darwin   # name for another triple
node scripts/build-sidecar.mjs --bundle-only          # stop after the esbuild bundle (no SEA)
```

## How the shell wires the sidecar

On launch (`src-tauri/src/lib.rs`) the Rust shell:

1. Picks a port (`LEDRUMS_DESKTOP_PORT`, default **4178** — distinct from dev's 4321) and
   spawns `ledrums-server` with:
   - `PORT=<port>`
   - `LEDRUMS_PROJECTS_DIR=<app-data>/projects` (created if missing — where a sandboxed
     binary can actually write)
   - `LEDRUMS_WEB_ROOT=<resource_dir>/web-dist`
   - `LEDRUMS_TUNNEL=quick` + `LEDRUMS_TUNNEL_BIN=<resource_dir>/cloudflared/cloudflared`
     **only when** a bundled cloudflared is present (otherwise local/LAN only, no PIN).
2. Captures the sidecar's stdout/stderr and parses the boot banner for the tunnel URL
   (`https://*.trycloudflare.com`), the room PIN (`(PIN <digits>)` / `Room PIN: <digits>`),
   and the local URL — pushing them to the native share window via the `boot://status` event.
3. Opens the **full app** in a second webview window at `http://127.0.0.1:<port>` (single
   origin → UI + WebSocket share the tunnel, reusing the web PinGate/ShareInfo).
4. On exit (closing any window quits the app, incl. the macOS "window closed but app lives"
   case) sends the sidecar **SIGTERM** so the server gracefully stops cloudflared + flushes
   autosaves, then SIGKILLs as a backstop — no orphaned processes.

The server changes that make this possible are env-gated with defaults that reproduce today's
behavior exactly: `LEDRUMS_PROJECTS_DIR` (apps/server `projects.ts`) and `LEDRUMS_WEB_ROOT`
(apps/server `static-host.ts`).

## Sidecar build (esbuild + Node SEA)

`build-sidecar.mjs` bundles `apps/server/src/main.ts` (+ workspace deps `@ledrums/core|io|
protocol`, `ws`, `zod`) into one CommonJS file with **esbuild** (`platform:node`,
`format:cjs`, `bundle:true`), then wraps it as a **Node Single Executable Application** using
Node's built-in SEA tooling (`node --experimental-sea-config` + `postject`). `ws`'s optional
native deps (`bufferutil`, `utf-8-validate`) are marked external so only the pure-JS fallback
is used — no node-gyp / native addons. The result needs **no Node installed** on the user's
machine.

The script ends with a **smoke test**: it boots the produced binary briefly to confirm the SEA
loads, and warns loudly if it does not.

> **Cross-target:** Node SEA copies the *host* `node` executable; it is not a cross-compiler.
> Produce each platform's binary **on that platform** (or in its CI), passing `--triple` if
> auto-detection (`rustc -vV`) is wrong. The output is named `ledrums-server-<triple>` per
> Tauri's sidecar convention.

> **Known environment blocker (documented):** on **Node 25.x + postject 1.0.0-alpha.6 on
> macOS x86_64**, postject's Mach-O injection produces a binary that crashes at launch with
> `dyld: ... unsupported thread-local, larger than 4GB`. This is a postject/Node toolchain
> incompatibility, **not** a code issue — the esbuild bundle itself runs cleanly
> (`node apps/desktop/sidecar/server.cjs` boots and serves). The smoke test detects this and
> prints remediation. To produce a working SEA, rebuild on a Node version whose postject
> injection is compatible (e.g. an LTS line), then `pnpm --filter @ledrums/desktop build`.

## macOS signing

Signing is **ad-hoc only** (`bundle.macOS.signingIdentity = "-"` in `tauri.conf.json`); there
is **no notarization**. The first launch of the `.app` therefore needs the quarantine
attributes cleared:

```bash
xattr -cr "/path/to/LEDrums.app"
```

## cloudflared

`fetch:cloudflared` downloads the platform binary into `src-tauri/cloudflared/`. It is
**optional**: downloading may be network-restricted, and the app degrades gracefully without
it (the server already logs a friendly "is cloudflared installed?" message and keeps serving
locally/over the LAN). The `src-tauri/cloudflared/` directory is kept in git (via `.gitkeep`)
so the Tauri `resources` path always resolves; the binary itself is gitignored.
