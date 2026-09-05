# Initial-bundle follow-up — 2026-09-05

## Integration handoff

**Final local validation handoff — parent owns integration and the full sweep.** The concurrent writer's provisional report was preserved at `/tmp/ledrums-health-bundle-concurrent-report.md` and reconciled here against the completed final gates, real production matrix and paired measurements. The stylesheet failure noted in that report is fixed: Chrome gives failed CSS links an empty `.sheet`, so recovery now uses witnessed failed HTTP requests, repairs both rejected preloads, and awaits the real ready-content selector.

**Local implementation on `perf/health-lazy-surfaces`, based on `77c1d2a0`.** Source: Trent's approved initial-bundle follow-up in the session brief and `docs/plans/2026-09-05-codebase-health-audit.md`, cross-cutting item 6. Machine: `scutil --get ComputerName` → Trent's MacBook Pro.

The reliable improvement is **472,608 fewer initial JS bytes on Perform (22.42%)**, or **145,237 fewer gzip bytes (23.83%)**. The local browser timing samples **do not establish a stable startup speedup**: the final paired ready medians improve, earlier samples got worse, and dispatch/Settings medians remain worse. Do not market the byte reduction as measured latency improvement.

No push, PR, merge, release, deployment, dependency change, warning-threshold change, or full sweep belongs to this slice. The parent owns integration and its other audit fixes.

## Implementation and design preservation

| Before | After |
| --- | --- |
| `AuthorShell.svelte` statically imported Trigger, Sections and Objects. | Literal dynamic imports in `app/lazy-views.ts`; route-keyed `LazySurface` renders only the selected editor. Returning to loaded code is synchronous. Perform, transport, Stop all, output status, stores and the required Three visualizer remain eager. |
| `SettingsModal.svelte` imported all seven panes during startup. | `settings/lazy-panes.ts` loads only an opened pane. The small existing Dialog/header/nav stays eager and stable, so focus trapping, close, navigation and Escape exist before content arrives. Closed/inactive panes are unmounted, not hidden cached instances. |
| No route-level code-load presentation. | Token-based `LoadFeedback`: immediate reserved `aria-busy` space, quiet `role=status` feedback after 200ms, `role=alert` failure, 40px retry button, restrained warn glyph, existing body type and pretty wrapping. No spinner, invented percentage, entrance choreography, or minimum visible delay. |
| A naive repeated `import()` remained rejected in Chromium without making another request. | `lazy-component.ts` permits same-origin entry recovery only with a recognized import-fetch error **and failed HTTP resource-timing evidence**. Each explicit retry gets a fresh entry URL. Rejected Vite stylesheet preloads are actually reloaded and awaited before rendering. |
| A shared-dependency/evaluation/opaque import failure could misleadingly offer an ineffective retry. | Such failures show safe-reopen guidance, with no fake retry and no automatic reload. A shared module is never recursively cache-busted: that could duplicate runtime/store identity. Performance controls remain usable. |
| No reusable load-state examples. | The real loading/retry/safe-reopen states are demoed in `SectionPrimitives.svelte`, with real source pointers; `docs/design-system.html` regenerated in the same change. |

Applied `/make-interfaces-feel-better` and Impeccable's product register against `PRODUCT.md`, the existing styleguide README and `docs/design-system.html`. Loaded editor/pane markup and styling are unchanged: no redesign, new motion, or new color tokens.

### Ownership and lifetime

- `lazy-resource.svelte.ts` owns only imported code and one in-flight promise per resource. It does not retain component instances, stores, pane state, watchers, or engine data. Errors are contained even when the consuming surface has unmounted; re-navigation does not auto-retry.
- Route-keyed surfaces plus resource-specific delayed feedback prevent an old completion from replacing the current route. A late Settings load cannot reopen a dismissed modal. Existing MIDI/OSC learn cancellation remains on every Settings close path.
- The browser checks prove the same Settings dialog survives pane navigation. A focused IconButton tooltip legitimately owns the first Escape; the dialog-dismissal checks move focus to its ordinary pane navigation and wait for the tooltip to close, preserving existing layered Escape semantics.

## Same-code production measurements

### Method and baseline provenance

Frozen install: `pnpm install --frozen-lockfile`. A pre-split web build of this worktree was saved at `/tmp/ledrums-health-bundle-presplit-dist` before changing its imports. Both sides therefore contain the **same integrated store/sim/core state implementation**, not the older audit implementation.

- Parent pre-split reference: `/tmp/ledrums-health-startup-presplit.json` (main 2,108,374 bytes; available before splitting).
- Original worktree baseline: `/tmp/ledrums-health-bundle-startup-presplit.json` (main 2,108,368 bytes from this worktree's own archived build). The six-byte difference from the parent's reference is not credited as a splitting gain.
- Primary final paired samples: `/tmp/ledrums-health-bundle-startup-paired-before.json` and `-paired-after.json`. The exact archived unsplit dist and final dist were served sequentially by the same isolated server without rebuilding or changing source/core/state. The temporary adapter restores final dist in a `finally` block. No simultaneous own builds/browser jobs ran during this pair.
- Earlier after-run retained for comparison: `/tmp/ledrums-health-bundle-startup-after.json`.
- **Not used:** `/tmp/ledrums-health-startup-before.json`; it predates integrated state changes. None of its timing differences are attributed to splitting.

Both measured builds were served by the slice's connected server at `http://localhost:4412`, OSC 9412, voice mode, `LEDRUMS_TELEMETRY=off`, tunnel off, isolated `mktemp` projects directory `/tmp/ledrums-health-bundle-projects.OEOhFq`. The browser guard checks output is disabled before clicking a pad. No physical output was armed.

Ran the **unmodified** shared script:

```sh
UI_SHOT_BASE=http://localhost:4412 node scripts/health-startup.mjs
```

Script SHA-256: `d02a37b047bc2a39147fd206861eb0e5828de86e276c1a782839e2eae5de9275`.

System Chrome, fresh browser context per sample, cache disabled by CDP, 4× CPU throttling, 1600×1000 viewport, three cold samples each for Perform and Trigger. `readyMs` is navigation through visible pads/graph; `scriptMs` is CDP ScriptDuration, **not an isolated parser benchmark**. Pad dispatch measures DOM click through two rAF opportunities, **not MIDI/OSC-to-light latency**.

### Built and actually loaded JS

Bytes are decimal bytes. Gzip is summed `gzipSync` size of the exact built files actually listed by the browser resource entries, not a claim that the local server compressed transport. Maps, CSS and fonts are excluded from this JS table. Total artifact JS includes the separate styleguide.

| Measure | Pre-split | Lazy surfaces |
| --- | ---: | ---: |
| Initial main JS | 2,108,368 | 1,635,760 |
| Initial main gzip | 609,578 | 464,341 |
| Perform JS actually loaded at readiness | 2,108,368 / 1 chunk | 1,635,760 / 1 chunk |
| Perform loaded JS gzip | 609,578 | 464,341 |
| Trigger JS actually loaded at readiness | 2,108,368 / 1 chunk | 2,038,394 / 18 chunks |
| Trigger loaded JS gzip | 609,578 | 597,965 |
| All emitted JS | 2,249,032 / 4 chunks | 2,270,146 / 40 chunks |
| All emitted JS gzip (sum per file) | 652,465 | 675,741 |

Main files: `index-Dzt7Pu_R.js` → `index-hwkBpE17.js`. Detailed accounting: `/tmp/ledrums-health-bundle-byte-comparison.json`. Trigger's entry is about 148kB and its shared graph/editor chunk about 210kB; these no longer load on Perform. The source-map inspection before splitting identified Three, web authoring, xyflow and UI code as major contributors; source text lengths were diagnostic, not compressed-size attribution. Three was intentionally retained.

**Trade-off:** splitting defers bytes rather than deleting features. Total shipped JS and aggregate gzip grow, and cold Trigger now requests more chunks. The remaining >500kB main warning is real and unchanged, not suppressed.

### Timings: median [min–max], milliseconds

| View / metric | Pre-split | Lazy surfaces |
| --- | ---: | ---: |
| Perform ready | 4,189 [3,573–4,562] | 3,178 [2,459–4,970] |
| Perform script duration | 2,982 [2,411–3,218] | 2,182 [1,807–3,332] |
| Perform dispatch→paint opportunity | 152 [47–651] | 663 [234–668] |
| Perform Settings dialog visible | 4,435 [4,248–5,182] | 4,624 [4,098–5,351] |
| Trigger ready | 5,079 [4,056–5,091] | 4,455 [3,224–5,624] |
| Trigger script duration | 3,570 [2,812–3,584] | 3,048 [2,287–3,878] |
| Trigger Settings dialog visible | 3,009 [2,717–3,377] | 3,373 [3,183–3,501] |

These small, CPU-throttled samples on a concurrently used development machine are noisy. The overlapping ranges do not establish a causal improvement or stable regression. Earlier original-worktree→resume samples had **worse** ready medians: Perform 3,436→3,886 ms, Trigger 4,040→4,475 ms; the parent's reference was 2,743/3,983 ms. Those runs are retained, not discarded to manufacture a speedup. In the final pair, ready/script medians improve but **dispatch and Settings medians worsen**. Treat this as verified initial-byte reduction with stable startup/input latency still unproven; repeated quiet-machine paired runs remain the next performance investigation, not a hardware claim.

The shared script stops its Settings timer when the **dialog** becomes visible. Since the shell is now intentionally available before its pane, that number is **not pane-ready time** and must not be presented as an editor interaction speedup. Functional browser tests separately await actual pane contents.

## Verification

### Targeted gates

1. Frozen install passed; manifests and lockfile unchanged.
2. Latest focused Vitest run: **32/32** tests — resource 3, lazy surface 6, component recovery 17, Settings modal 6. Earlier adjacent shell-nav and Settings-registry checks also passed (33 tests). No full sweep. Existing Bits UI/Svelte `derived_inert` warnings remain in Settings component tests; no test failures or post-teardown exceptions remain. The test cleanup explicitly lets Bits UI finish its 24ms scroll-lock cleanup before jsdom teardown.
3. Web typecheck: **0 errors, 0 warnings**. Production web build passed; design-system build/regeneration passed. The size warning remains; Rollup also warns about xyflow's upstream `portal` circular reexport across chunks. Actual production graph paths were exercised; no dependency/config workaround was hidden in this slice.
4. Source/report diff whitespace checks are clean. `git diff --check` flags one trailing-whitespace line inside the generated HTML's minified Svelte whitespace-character template literal; the artifact is kept byte-identical to the generator output rather than hand-editing library string contents. Core, render/sim/store/server, WS contracts, package manifests/lockfile, knip config and parent benchmark script untouched by this slice. No runtime/model schema changes or new IO.

Useful commands:

```sh
pnpm --filter @ledrums/web test src/lib/ui/lazy-resource.test.ts src/lib/ui/lazy-component.test.ts src/lib/ui/LazySurface.test.ts src/lib/app/settings/SettingsModal.test.ts
pnpm --filter @ledrums/web typecheck
pnpm --filter @ledrums/web build
pnpm design-system
UI_SHOT_BASE=http://localhost:4412 node apps/web/src/lib/app/lazy-surfaces.browser.mjs
```

### Real production browser regression

`apps/web/src/lib/app/lazy-surfaces.browser.mjs` runs against the built, connected, disarmed app. Final evidence: `/tmp/ledrums-health-bundle-browser-final.log`; repeated successfully after restoring final dist in `/tmp/ledrums-health-bundle-browser-repeat.log`.

- No Trigger/Sections/Objects/Settings pane requests on Perform; controls and visualizer available.
- Aborted Trigger entry → visible loading/error → a **real second network request** on retry → graph ready. The negative control restores connectivity and calls the original native import URL: Chrome still rejects it without another request. Recovery uses a distinct entry URL, keeps the same document/WebSocket, and does not request a second main runtime. Warm return has neither another request nor even a fallback DOM mutation.
- Settings pending import: focus trap, Escape, opener restoration, close-before-resolve, no late reopening. Warm reopen cached; pane navigation retains the same Dialog.
- Rapid Objects→Sections: late Objects completion cannot replace Sections.
- Two simultaneous aborted route stylesheets (Field and SectionsView) → both actually re-requested and applied before ready content. Vite reports only the first preload rejection; Chrome's failed link still has an empty `.sheet`, so HTTP evidence is the guard. Settings entry fails first by abort and again with HTTP 503 → repeated real retry → Input renders, focus remains in the dialog.
- Aborted shared graph dependency → explicit safe-reopen guidance, no fake retry/reload, Perform still usable. A real show-name edit survives an explicit operator reload; the original fixture name is restored afterward.

No unhandled page exceptions. The six expected browser network diagnostics are asserted individually (five deliberate aborts, one HTTP 503); they are not treated as unexpected console-clean passes or suppressed broadly. An initial naive retry implementation failed this browser test before cache-safe recovery was added.

### Screenshots and inspection

Owned Vite stack bound **localhost:5412**, proxying WS to 4412 (not `127.0.0.1`). This strict capture command passed for all 11 affected/retained surfaces:

```sh
UI_SHOT_BASE=http://localhost:5412 pnpm ui-shot perform trigger-graph sections objects settings-input settings-zones settings-controls settings-drums settings-outputs settings-controller settings-system --strict
```

Inspected `.ui-shots/{perform,trigger-graph,sections,objects,settings-input,settings-zones,settings-controls,settings-drums,settings-outputs,settings-controller,settings-system}.png`: real loaded content, original geometry/layout, legible feedback and no introduced clipping. Tall Settings content continues to scroll. Controller capture is the existing **mock controller fixture**, not hardware evidence.

Also inspected production interception captures in `.ui-shots/health-bundle/`: `trigger-loading.png`, `trigger-failure.png`, `settings-loading.png`, `settings-failure.png`, `settings-ready.png`, `trigger-reopen-guidance.png`.

For strict `pnpm ui-shot` coverage of long-lived loading and error states themselves, a temporary UI-only loopback proxy at 5412 supplied a held Input module / caught evaluation failure to the same built app (no application test hooks): `.ui-shots/health-settings-loading.png` and `.ui-shots/health-settings-error.png`. These verify **presentation**, while real download/retry behavior is the separate Playwright interception test above. Screenshots are gitignored local evidence; their reproduction commands and browser test are retained.

## Explicit limits and deferrals

- **Not all overlays split.** ShowBrowser, Backups, clipboard dialogs and `Overlays.svelte` remain eager. Their nested-dialog/open-state/focus ownership would require a broader shell/body extraction; that complexity was deferred under the brief's meaningful-seams budget. `App.svelte` and `TopBar.svelte` therefore need no changes. This slice covers three real editor seams and all seven Settings panes, not every modal.
- Recovery depends on recognizable Vite entry URLs and Resource Timing `responseStatus`. Missing timing/opaque errors, shared-module failures and evaluation errors deliberately require an operator-controlled reopen. No recursive dependency rewriting, forced reload, or infinite automatic retries.
- Chrome verified; no packaged WKWebView, Safari/Firefox, hardware MIDI/OSC latency, physical LEDs, OTA or deployment certification. Engines without usable failure evidence receive safe-reopen guidance rather than an unverified retry promise.
- The default route policy is unchanged. A cold Trigger landing still pays the editor cost; this is not a claim of universal cold-start acceleration.
- Parent integration owns any scanner entry handling for the explicitly invoked colocated browser runner; this slice makes no knip/config/manifest edits.

### GROW handoff within the file fence

Ground: real route/pane import ownership changed, not engine behavior. Record: this report and short local-status entries in `.mex/ROUTER.md` / `.mex/context/architecture.md` carry the source-backed state, explicitly not merged/shipped status. Orient: `.mex/patterns/codebase-health-audit.md` records native-import failure caching, misleading entry URLs, failed CSS with a non-null `.sheet`, actual ready-selector assertions, fixed-baseline measurement and layered Escape semantics. `mex log --type decision` records the rationale. Existing scaffold dates are already 2026-09-05.

Final local logs: `/tmp/ledrums-health-bundle-{tests,typecheck,build,design-system}-final.log`, `-browser-final.log`, and `-shots-final.log`. Strict loading/error logs: `-loading-shot.log` / `-error-shot.log`; temporary UI-only adapter: `/tmp/ledrums-health-bundle-shot-proxy.mjs`. The standalone artifact was opened from `file://`: the new demo's four source pointers resolve, with no console errors. The owned Vite/server/proxy processes are stopped; listener checks confirm `:5412`, `:4412` and UDP `:9412` are released. No other agent's servers were touched.
