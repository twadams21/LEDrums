# Wave 2 assignment — correctness fixes (decision-free set)

**Agent:** one fable session (own window, low effort — compensated by a very concrete spec + master review). **Worktree:** `../ledrums-wt/wt-2` (verify `git status --porcelain` EMPTY first). **Branch:** `wave-2/correctness` off local `rock-solid`. **Parent:** `twux send-message --session parent` (≤30 lines per message).

**Read first (in this dir):** `PHASE0-RECONCILIATION.md` (your spec — esp. §2, §7, §8), `HANDOFF.md` (items A/B/C/H), `TRENT-DICTATION-2.md` (decisions + rejected patterns). Repo rules: `AGENTS.md` (core purity + determinism are NON-NEGOTIABLE; render = pure fn of time/inputs/model).

**Coordination:** Wave 1 runs in parallel on wt-1 (diagnosis + `scripts/ui-shot` tooling). Do NOT touch `scripts/ui-shot/**` or `AGENTS.md` (wave-1 owns them). If the dev-server port is busy, let vite pick the next one. Wave-1 findings (visualiser render source, tunnel root cause) will be forwarded to you when they land — don't block on them.

**Style discipline:** these are surgical FIXES, not redesign. The app shell is being re-laid-out in wave 3 — do not restructure chrome, docks, or palettes here. Respect Trent's locked graph prefs: no lift/click animations, instant hover highlight, dropping a wire anywhere on a node targets its input. Do NOT add modifier-order chips or reorder lists (explicitly rejected patterns).

**Work one item at a time. Commit per item (small, labelled commits). After items 1 and 2 land, send an interim report so master can review incrementally.**

---

## Item 1 — Trigger-graph fixes (P0 trust) — the 9 mapped defects + extras

Mechanism map with file:line is in `PHASE0-RECONCILIATION.md` §7 — treat hypotheses as leads, verify each in the live app before and after fixing. Fix all nine:

1. Wire curve shift on release (preview vs committed coords).
2. Duplicate wires (harden `canConnect` dedup — port normalization + any bypassing path).
3. Unselectable wires (add a generous invisible hit-path on edges; keep visual stroke unchanged).
4. Unreliable node XY (drag write-back vs rebuild race; positions must be stable across drag/zoom/graph-switch).
5. Spawn stacking (smart free-position placement: probe/offset from viewport centre; no overlaps on repeated add).
6. Selection-driven z-order churn (pin an explicit, stable stacking policy: wires under nodes, selection does NOT reorder).
7. Modifier handle placement (derive from actual card layout, not hardcoded `top:74%`).
8. Inspector not following selection (fix the selection-clear race in `AuthorShell`; inspector must always match the active selection; verify the Patch graph path too).
9. Hover inconsistency (one pattern per element class; instant CSS-driven hover per Trent's pref).

Plus, same item: **(a)** root-cause + fix the Delay-node corruption on add (§7 note: `changeKind` edge-stripping / `selectedGraph` staleness is the prime suspect — reproduce first); **(b)** extract the theme-token `getComputedStyle` read from `ParamRowTick.svelte` + `NodeSignalPreview.svelte` into ONE shared helper (kill the self-referential-`$effect` idiom permanently); **(c)** extend the flow-guard hardening (group A pattern, `flow-guard.ts`) to `PatchGraphView`.

**Acceptance:** live smoke-load — every interaction in HANDOFF item A's acceptance list works with a clean console (no `effect_update_depth_exceeded`, no uncaught throws, incl. rapid add/delete/wire/unwire of every node kind); regression tests where a seam is testable (dedup, placement, selection-follow).

## Item 2 — ONE RENDER TRUTH (P0 determinism, items B+C)

Direction confirmed by Trent: **collapse the throwaway web sim onto the core engine** rather than re-seeding a parallel implementation. `apps/web/src/lib/trigger-lab/sim.ts` (self-declared THROWAWAY; `Math.random()` ×6) must stop being a second source of render truth.

- Web-side simulation/preview must drive the SAME core code paths (`packages/core` voice engine/compositor) — core is already fully deterministic (seeded Mulberry32 `prng.ts`, `deriveSeed` per trigger). Web keeps only a thin adapter (input feeding, frame pumping). Kill every ambient `Math.random()`/wall-clock dependency in the render-truth path.
- **Per-trigger seeding (item C):** random-look effects (confetti etc.) seed from the trigger (voice/event id + trigger time) via the core PRNG — each fire looks different, identical inputs reproduce exactly.
- **Retrigger overlap (item C):** verify overlapping voices — rapid retriggers spawn independent voices, each running its full envelope from its own t=0, earlier voices finishing uninterrupted. Test it; fix if broken. (Trigger-started envelopes are DROPPED — do not build.)
- **Acceptance:** two play nodes with identical settings → pixel-identical output given identical (time, inputs) — automated test at the compositor seam AND at the visualiser input; same node on a different hoop of the same drum differs only by geometry mapping. Live visual check with the dev app.
- This is the riskiest item: if full sim-collapse balloons, deliver the determinism-critical subset first (render path through core, seeded randomness), commit, report, and propose the remainder — don't silently expand.

## Item 3 — LayersDock smoothing (P1, item H)

§8 hypothesis: server stats at 2 Hz adopted raw → dock steps visibly. Confirm by observation first. Fix by client-side interpolation/smoothing between stat frames (server stays the truth — authority principle intact; no sim writes while link open). Kill the worst per-tick allocation waste while there (per-bus `filter()` per render, per-voice style-string churn). **Acceptance:** visually smooth under real voice load; before/after observation noted.

## Item 4 — Share/tunnel: in-app start/stop (RESCOPED by Trent, 2026-07-04)

Root cause is settled (WAVE1-REPORT.md item 2 + master follow-up): the tunnel is opt-in by design — `pnpm dev` never spawned cloudflared; Trent saw it working in the DESKTOP app (S4 sidecar enables it). cloudflared is now installed on this machine and `.env.local` (wt-master) sets `LEDRUMS_TUNNEL=1`. No archaeology needed. Build what Trent actually wants:

- **In-app tunnel control:** the Share button is ALWAYS visible in the top bar. States: **off** (popover offers a "Start sharing" action), **starting** (progress state), **live** (url + PIN + copy, as today), **error** (cloudflared missing / spawn failed — explain plainly + how to fix, never vanish silently).
- **Server seam:** a protocol message to start/stop the tunnel on demand — `TunnelManager` already encapsulates spawn/parse/shutdown (`tunnel-manager.ts`); add a lifecycle-control path from the web client. The env flag remains as "start at boot"; the in-app control works regardless of it. Keep S3's invariant: an enabled tunnel is ALWAYS PIN-gated (never a public un-gated URL), and only a local/non-viewer client may start or stop it (viewers over the tunnel must NOT be able to kill or restart the tunnel they rode in on).
- Existing tests around `tunnelConfigFromEnv`/`parseTunnelUrl` stay green; add coverage for the start/stop protocol path.
- **Acceptance:** from a plain `pnpm dev` with NO env flag: click Share → Start sharing → live trycloudflare url + PIN appear in the popover; stop works; a viewer connected via the tunnel cannot stop it. With cloudflared renamed away, the error state explains itself.

## Gates & report

Full sweep before handoff: `pnpm typecheck` + `pnpm test` green, 0 skips; **mandatory live smoke-load** (dev server, clean console across all views) — vitest is blind to the `$effect`/rAF bug class. Any UI-visible change: check against the design system (`docs/design-system.html`); regenerate via `pnpm design-system` only if you change styleguide-covered components.

Commit `docs/plans/2026-07-03-phase2-review/WAVE2-REPORT.md` on your branch (per-item: what changed, evidence, test names; surprises section). Slim final message to parent. Master reviews the full diff + merges.

Budget: check `twux usage`; above ~85% of the 5h window → finish current item, commit, report partial.
