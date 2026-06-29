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
4. On macOS, creates a CoreMIDI virtual destination named `LEDrums` and forwards incoming
   note/CC/program-change messages into the same local server input path as WebMIDI.
5. On exit (closing any window quits the app, incl. the macOS "window closed but app lives"
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

> **Pinned SEA Node (handled automatically):** Node "Current" (odd-major) lines such as **v25**
> trigger a postject Mach-O bug on macOS — the produced binary crashes at launch with
> `dyld: ... unsupported thread-local, larger than 4GB`. Even-major **LTS** lines (v20/22/24)
> are fine. Rather than depend on the dev's active Node, `build-sidecar.mjs` **pins a known-good
> LTS** (`22.23.1` by default) and uses it as the SEA base whenever the active Node isn't already
> on that line: it downloads + checksum-verifies the official build from nodejs.org into
> `apps/desktop/.node-pin/` (cached; gitignored) and builds against it. So `pnpm tauri build`
> works on any machine — including a Node-25 default — and produces a **reproducible** binary
> (same Node everywhere, not "whatever the builder had"). Override with
> `LEDRUMS_SEA_NODE_VERSION=<ver>`. Offline on an LTS line, it falls back to the active Node; on a
> Current line with no network it fails loudly rather than ship a broken binary. The smoke test
> still boots the result to confirm it loads.

## macOS signing

Signing is **ad-hoc only** (`bundle.macOS.signingIdentity = "-"` in `tauri.conf.json`); there
is **no notarization**. The first launch of the `.app` therefore needs the quarantine
attributes cleared:

```bash
xattr -cr "/path/to/LEDrums.app"
```

**JIT entitlements (required).** Tauri signs bundle binaries with the hardened runtime. The
server sidecar is a Node SEA, and V8 needs to allocate executable memory for its JIT — the
hardened runtime blocks that unless `bundle.macOS.entitlements` (→ `entitlements.plist`) grants
`com.apple.security.cs.allow-jit` + `allow-unsigned-executable-memory` (+ `disable-library-
validation`, since the app loads the differently-signed sidecar/cloudflared). Without it the
bundled server crashes on launch in `v8::...SetPermissionsOnExecutableMemory`. We don't notarize,
so these entitlements are purely to let the embedded Node run.

## Packaging the `.dmg`

`pnpm --filter @ledrums/desktop build` (targets `all`) produces `LEDrums.app` **and** a `.dmg` on
a normal (GUI) macOS machine. In a **headless** environment Tauri's `bundle_dmg.sh` fails because
it styles the disk-image window via AppleScript/Finder — the `.app` is still produced. Build just
the app and wrap a `.dmg` yourself:

```bash
pnpm --filter @ledrums/desktop tauri build --bundles app
APP=apps/desktop/src-tauri/target/release/bundle/macos/LEDrums.app
STAGE=$(mktemp -d); cp -R "$APP" "$STAGE/"; ln -s /Applications "$STAGE/Applications"
hdiutil create -volname LEDrums -srcfolder "$STAGE" -ov -format UDZO LEDrums.dmg
```

## cloudflared

`fetch:cloudflared` downloads the platform binary into `src-tauri/cloudflared/`. It is
**optional**: downloading may be network-restricted, and the app degrades gracefully without
it (the server already logs a friendly "is cloudflared installed?" message and keeps serving
locally/over the LAN). The `src-tauri/cloudflared/` directory is kept in git (via `.gitkeep`)
so the Tauri `resources` path always resolves; the binary itself is gitignored.

The download is **version-pinned** (`2026.6.1` by default; override with `CLOUDFLARED_VERSION`)
and prints the asset's SHA256. Verification is **opt-in** locally — set `CLOUDFLARED_SHA256` to
the expected hash to enforce it. **Release/packaging CI should set `CLOUDFLARED_SHA256` per
platform** (the hash differs by OS/arch) so bundled binaries are integrity-checked, not just
version-pinned.

## OTA auto-update (whole-bundle)

The app updates itself **as one whole bundle**. The server sidecar, the web UI, and cloudflared
are all packaged inside the `.app`, so a Tauri updater release replaces **everything at once**
(shell + server + UI + cloudflared). After the update installs and the app restarts, it boots
fresh and mints a **new tunnel URL + room PIN** — exactly as a clean launch would.

### How the check runs (Rust-driven, not the web app)

The drummer's window loads the external web UI over `http://127.0.0.1` and has **no Tauri APIs** —
only the transient `splash` window is Tauri-privileged. So the update check runs in the **Rust
shell** (`src-tauri/src/lib.rs`, `check_for_update`), using `tauri-plugin-updater`'s Rust API:

1. On startup it spawns a background task (it never blocks the server or the app window) that calls
   `app.updater()?.check()`.
2. If an update is available, it asks via a native `tauri-plugin-dialog` prompt
   (*"Update & Restart"* / *"Later"*).
3. On accept, it `download_and_install`s (streaming progress to the splash via `boot://status`,
   stage `"updating"`) and then `app.restart()`s.
4. **Any failure — offline, placeholder/unreachable endpoint, OTA not provisioned — is logged and
   swallowed**, and the app starts normally on the current version. OTA is never required to run.

Set **`LEDRUMS_SKIP_UPDATE=1`** to skip the check entirely (handy in dev).

The whole OTA flow runs in Rust, so the webview needs **no** updater/dialog/process capability
grants — `src-tauri/capabilities/splash.json` grants the splash only `core:default` +
`clipboard-manager:allow-write-text` (what `shell/main.js` actually uses). The updater/dialog/process
plugins are still `.plugin(...)`-initialized in `src-tauri/src/lib.rs`; only the webview-facing grants
were dropped.

If a user accepts an update **after** the app window is already up (the splash has since closed), the
Rust shell **reopens the splash window** so download progress (`boot://status`, stage `"updating"`)
is visible again, and closes it on failure (see `ensure_splash_window` / `check_for_update`).

### One-time setup — DONE (recorded here for reference)

The channel is **provisioned and live**; `tauri.conf.json` carries the real pubkey + endpoint. The
infra:

- **Signing keypair**: a production minisign keypair. The **private** key + password live in
  Infisical (workspace `a7e707cd-322f-4cf1-a8ec-48da2e35fe72`, env `prod`) under the namespaced
  names **`LEDRUMS_TAURI_SIGNING_PRIVATE_KEY`** / **`LEDRUMS_TAURI_SIGNING_PRIVATE_KEY_PASSWORD`**
  (namespaced because that vault already holds a different project's `TAURI_SIGNING_PRIVATE_KEY` —
  do not clobber it). The **public** key is committed in `plugins.updater.pubkey`.
- **Public R2 bucket** `ledrums-ota`, public base
  `https://pub-6ba98981a8804912b9551135ba976ef4.r2.dev`; `plugins.updater.endpoints` →
  `<base>/latest.json`.

To rotate the key or re-provision, regenerate with `tauri signer generate`, update the secrets +
`pubkey`, and re-publish.

### Release flow

Because the signing key is namespaced, the root `pnpm tauri:build` script maps it onto the canonical
`TAURI_SIGNING_PRIVATE_KEY*` env names Tauri expects, overriding the other project's key that
Infisical also injects in `prod`.

```bash
PROJ=a7e707cd-322f-4cf1-a8ec-48da2e35fe72
BASE=https://pub-6ba98981a8804912b9551135ba976ef4.r2.dev

# 1. bump `version` in src-tauri/tauri.conf.json (this is the OTA version clients compare against)

# 2. SIGNED build. Build per platform you ship (run on an arm64 Mac for darwin-aarch64).
infisical run --projectId "$PROJ" --env prod -- pnpm tauri:build

# 3. publish the artifact + (merged) latest.json to R2
infisical run --projectId "$PROJ" --env prod -- bash -c \
  "OTA_PUBLIC_BASE=$BASE node apps/desktop/scripts/publish-ota.mjs"
```

`scripts/publish-ota.mjs` locates the host platform's updater artifact under
`src-tauri/target/release/bundle/`, uploads it to `r2://<bucket>/<version>/<target>/<file>`, and
writes the Tauri v2 manifest `latest.json` (`{ version, notes, pub_date, platforms[<os>-<arch>] =
{ signature, url } }`). It **merges** into any existing same-version manifest, so a multi-arch
release built on several machines (e.g. `darwin-aarch64` + `darwin-x86_64`) accumulates into one
manifest. Env knobs: `OTA_BUCKET` (default `ledrums-ota`), `OTA_PUBLIC_BASE` (**required**),
`OTA_VERSION`, `OTA_TARGET`, `OTA_NOTES`. It needs `CLOUDFLARE_API_TOKEN` + `CLOUDFLARE_ACCOUNT_ID`
(R2 read/write) — supplied by Infisical.

> **Per-platform builds.** As with the sidecar (Node SEA is not a cross-compiler), produce each
> platform's signed bundle **on that platform** and run `publish:ota` there; the manifest merge
> keeps both arch entries.

> **⚠ Publish serially — one platform at a time.** `publish-ota.mjs` updates `latest.json` with a
> read-modify-write (fetch the manifest → merge this platform's entry → re-upload). Two publishes in
> flight at once can read the same manifest and clobber each other's platform entry. Always wait for
> one platform's publish to finish before starting the next; **never run `publish:ota` concurrently.**

> **Version is single-sourced.** `tauri.conf.json`'s `version` is authoritative (it's baked into the
> built app). `OTA_VERSION`, if set, only *asserts* that version — a mismatch aborts the publish
> (override with `OTA_ALLOW_VERSION_MISMATCH=1` only in an emergency), so the manifest can't drift
> from the artifact.
