# E4 — Hidden sourcemaps archived by OTA

Spec: #122. Effort: **medium** (small, mechanical). Wave 1 (parallel with E1, E3).

## Mission

Every released build's minified stack traces stay decodable forever: the web build emits hidden sourcemaps, and the OTA publish archives them keyed by version. This is the spec's one irreversible decision — a release that ships without archived maps can never be symbolicated.

## What to build

1. **Vite**: `build.sourcemap: 'hidden'` in the web app's build config — `.map` files are emitted but the served JS carries **no** `sourceMappingURL` comment.
2. **OTA publish**: alongside the existing artifact upload, upload all emitted `.map` files under `sourcemaps/<version>/` on the same bucket/base. Version = the same source of truth the OTA flow already uses (tauri.conf). Idempotent re-publish behaviour should match how the rest of the publish handles overwrites.
3. **Verification in-slice**: run a production web build; assert maps exist in the output, served JS has no `sourceMappingURL` reference, and (dry-run or against a local/mock target — **no live publish**) the upload step enumerates the map files correctly.
4. **Docs**: a short note in whatever doc the OTA flow already maintains (or the script header) on how to symbolicate a report: version → fetch `sourcemaps/<version>/` → `source-map` CLI.

## Anchors to verify

- `apps/web/vite.config.ts` — confirm no existing `build` block conflicts; the design-system build (`vite.design-system.config.ts`) is separate and out of scope.
- `apps/desktop/scripts/ota.mjs` + `publish-ota.mjs` — where artifacts upload, how `BASE`/`OTA_PUBLIC_BASE` and `.env.local` are consumed, what "publish" enumerates.
- Where the built web assets land relative to what `publish-ota.mjs` uploads (the maps must be findable at publish time — verify the pipeline order: web build → sidecar/bundle → publish).

## Scope fence

May touch: `apps/web/vite.config.ts`, `apps/desktop/scripts/ota.mjs`, `apps/desktop/scripts/publish-ota.mjs`, OTA docs/README text.
Non-goals: no symbolication tooling, no Worker involvement, no changes to what the app serves at runtime, no version-bump logic changes, **no live publish to R2**.

## Tests

The publish scripts are `.mjs` with existing test precedent (`shell-tokens.test.mjs`) — if the map-enumeration logic is extractable as a pure function, test it that way; otherwise a dry-run assertion script is acceptable evidence, pasted in the report.

## Escalation triggers

- Bundle-size or build-time impact of sourcemap generation is surprisingly large (>~20% build-time regression).
- The publish flow's structure makes "upload extra files" require restructuring rather than addition.
