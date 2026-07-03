# Wave 1 report — ui-shot tooling + live smoke pass (2026-07-04)

Branch: `wave-1/ui-shot-smoke` (off `rock-solid`). Diagnosis only — no fixes beyond tooling-adjacent port overrides.

## Part A — `pnpm ui-shot` (shipped)

**Decision: thin JS wrapper on `playwright-core` with `channel:'chrome'`** (system Chrome), not shot-scraper. Rationale: zero browser download (disk constraint — playwright-core is ~3 MB of JS), no Python/pipx toolchain on this machine (`shot-scraper`/`uvx`/`pipx` all absent), pure-JS fits the repo's no-native-addons ethos, and we need app-aware actions (click/scrollTo before capture) which the wrapper does in ~130 lines.

- `pnpm ui-shot <name…> | --all | --list` — 18 named surfaces in `scripts/ui-shot/shots.json` (shell, top bar, transport, rail, trigger graph, node-selected inspector, visualizer, layers dock, patch graph, objects, song library, sections, perform, monitor, settings dialog, both add modals).
- Ad-hoc: `pnpm ui-shot --route "?view=patch" --select "main.workspace" --name x`.
- Auto-starts `pnpm dev` if the server is down; PNGs → gitignored `.ui-shots/`; console + uncaught page errors printed per shot; `--strict` exits 1 on any (cheap clean-console gate). Docs: `scripts/ui-shot/README.md`; AGENTS.md UI rule added.
- Tooling-adjacent fix: vite web/WS ports are now env-overridable (`LEDRUMS_WEB_PORT`/`LEDRUMS_WS_PORT`, server `PORT`) — required because wt-master's dev stack owned 5173/4321 and the hardcoded WS proxy would have silently pointed this worktree's web app at wt-master's server.

All smoke evidence below was gathered with this tool + playwright-core drivers against THIS branch's stack on :5175/:4322 (voice engine).

## Part B — verdicts

| # | Item | Verdict | Evidence |
|---|---|---|---|
| 1 | Visualiser render truth | **CONFIRMED**: link open → server frames; sim only when link closed | `store.svelte.ts:485-489` (`previewFrame = useServer ? serverFrame : frameBuf`); live: link open = viz canvas animating on fire (10/10 distinct captures), WS-blocked reload = frozen viz, 0 FPS, SYNC pill. So the `sim.ts` `Math.random()` calls only affect the OFFLINE preview. ⚠️ Consequence: Trent's live nondeterminism was almost certainly seen link-open, i.e. on SERVER frames — wave 2's "one render truth" should re-verify determinism at the server/core seam, not assume sim-only. |
| 2 | Share button / tunnel | **ROOT-CAUSED** | Tunnel is opt-in: `tunnelConfigFromEnv` (`tunnel-manager.ts:75-91`) returns null unless `LEDRUMS_TUNNEL` is set — "plain `pnpm dev` never spawns cloudflared" by design (S3). No `.env.local` exists in wt-1 or wt-master, and `cloudflared` is NOT installed on this machine (`which` fails). Boot log confirms: no tunnel/PIN lines. `ShareInfo` self-hides on `tunnel:{enabled:false}` (`main.ts:189`). Fix = env flag + cloudflared install (+ maybe a visible "tunnel off" state), not code archaeology. |
| 3 | LayersDock lag | **CONFIRMED** (2 Hz stepping) | Server broadcasts stats every 500 ms (`main.ts:550,574`); client adopts raw (`store.svelte.ts:1354`). Live: bus-meter `transform` sampled at 25 Hz under keyboard fire steps at ~430–500 ms intervals (gaps: 432,499,448,482,587,450,434,468,417 ms). Jank = update-rate drop, as hypothesised. Interpolation fix direction stands. |
| 4 | Delay-node corruption | **NOT-REPRO as data corruption; PLAUSIBLE alternate root cause found** | Wired-in Delay + modifier & modulation adds via modals (incl. Delay selected in inspector): Delay node data intact, console clean, no `changeKind` misfire observed. BUT: every add spawns at the SAME viewport-centre point (`GraphPalette.svelte:42-48`) — the new node lands EXACTLY on the Delay, and its canvas intercepts all pointer events (playwright: "subtree intercepts pointer events" on the occluded Delay; clicking the Delay's coordinates selects the overlapping node instead). A node that's suddenly overlapped, unclickable, and shows another node's face is a convincing "semi-replaced, broken, had to delete it". Wave 2: fix spawn stacking first, then re-test; keep `changeKind` (`store.svelte.ts:2555-2580`) as secondary suspect. |
| 5.1 | Wire curve shifts on release | **NOT-REPRO** (node-drag path: edge `d` identical during drag vs after release). Trent's case may be release of a wire-creation drag — needs a manual check; mechanism hypothesis unverified. |
| 5.2 | Duplicate wires | **NOT-REPRO headless** — identical repeat drag did not create a duplicate (first drag flaked to nothing, second created 1). dedup in `graph-wiring.ts:61-70` held in this path. |
| 5.3 | Wires unselectable | **CONFIRMED** — clicking the first edge (bounding-box centre, force) does not select it (`selected` class stays false). Thin-stroke hit test mechanism consistent. |
| 5.4 | Node XY unreliable | **NOT-REPRO** in single trial (drag moved node, position persisted). Race hypothesis untested under graph-rebuild load. |
| 5.5 | Nodes stack on add | **CONFIRMED** — two palette adds → identical transforms `translate(138px,-15px)`; third (modal add) landed on the same point. Direct cause of item-4's overlap illusion. |
| 5.6 | Z-order churns with selection | **CONFIRMED** — selected node's z-index jumps 0→1000 and the previous one drops back (xyflow raise-on-select, no explicit policy). |
| 5.7 | Modifier handle placement | **CONFIRMED in code** (`TriggerNode.svelte:146-153` hardcoded `top:74%/50%`); not re-measured live. |
| 5.8 | Inspector doesn't follow selection | **NOT-REPRO** — 3 sequential node clicks + a graph switch all tracked correctly. NOTE: one apparent mismatch (clicked Delay → inspector showed CC) was actually the 5.5 overlap stealing the click — worth remembering when triaging Trent's reports. |
| 5.9 | Hover inconsistency | **CONFIRMED in code** (mixed CSS `:hover` vs JS `hovered` prop across `NodeCard`/`GraphCanvas`/`GraphPalette`); not instrumentable headless. |
| 6 | Song Library e2e | **CONFIRMED working** — live drive: Add to library (0→1), Import to show (ref shows "IN THIS SHOW"/"Used by 1 show"), Detach copy (→"Not used by any show", closure cloned into show: Effects 51→61, Graphs 10→20). Shots: `.ui-shots/diag-song-library*.png`, named shot `song-library`. Discoverability complaint stands — it's below the fold of Objects→Songs. |
| 7 | Clean-console smoke | **PASS with one item** — every view + dialogs + all interactions above: zero uncaught errors, zero `effect_update_depth_exceeded`, zero rAF null-derefs. Only noise: **404 for `/favicon.ico`** on first load (web app has no favicon — already a §6 finding). |

## Surprises

1. **Item 1's consequence flips item B's premise:** the visualiser Trent distrusts renders SERVER frames when connected. The sim `Math.random()` story only covers offline preview. Wave 2's one-render-truth work should include a determinism test on the server frame stream itself.
2. **Item 4 is probably a UX illusion, not corruption** — spawn-point stacking + pointer-event theft makes an existing node look replaced/broken. Fixing 5.5 may make the "corruption" unreproducible forever; verify before hunting `changeKind`.
3. wt-master's dev stack squatting the default ports would have silently cross-wired this worktree's web app to the wrong server — the new port overrides prevent a whole class of wrong-evidence smoke runs.
4. Voice-engine idle rAF loop still calls `renderFrame()` (sim composite) every frame even when server frames are adopted (`store.svelte.ts:738`) — wasted work, candidate micro-fix for wave 2.

## Not done / caveats

- 5.1/5.2/5.4 need pointer-perfect manual or headed repro; headless mouse synthesis is a weaker probe for xyflow drag races.
- LayersDock CPU profile not taken (cadence evidence was sufficient for the hypothesis); do profile before the interpolation fix.
