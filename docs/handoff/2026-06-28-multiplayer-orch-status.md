# Orchestrator status — Multiplayer (server-authoritative live) + Tauri

_Branch: `feat/unified-shell` · 2026-06-28 · PRD: `docs/plans/2026-06-28-multiplayer-tauri-prd.md`_

## Mission
Many clients connect to the drummer's locally-running server; **one editor at a time** (Takeover);
viewers live-follow the editor's edits; the drum→render→controller hot path stays **local + untouched**.
A **Tauri** desktop app makes it double-click-to-run with local-FS persistence, exposed to Trent via an
outbound **Cloudflare tunnel + room PIN** (no inbound port, no Tailscale).

## Slices (vertical tracer bullets)
| Slice | Title | Brief | Blocked by | Status |
|-------|-------|-------|-----------|--------|
| S1 | Live multi-client spine | `docs/prompts/mp-S1-live-multiclient-spine.md` | — | ready |
| S2 | Takeover, roles & read-only UI | `docs/prompts/mp-S2-takeover-roles-readonly.md` | S1 | ready |
| S3 | Remote access: tunnel + PIN | `docs/prompts/mp-S3-tunnel-pin.md` | S1 | ready |
| S4 | Tauri desktop app | `docs/prompts/mp-S4-tauri-desktop.md` | S1, S2, S3 | ready |

## Wave plan (orchestrator merges + per-phase /code-review)
- **Wave 1:** S1 (server-foundational: registry + protocol presence/showLibrary + web follow). Merge + full sweep.
- **Wave 2:** S2 ∥ S3 (web takeover/roles ∥ server tunnel/PIN — disjoint enough; both build on S1's merged protocol/registry). Merge each + full sweep.
- **Wave 3:** S4 (Tauri packaging — needs S1–S3 functional). Merge + live checklist.

Why mostly sequential: S2 needs S1's registry+presence; S3 needs S1's multi-client server; S4 needs all. The genuine parallel pair is S2 ∥ S3.

## Build workflow (proven)
twux git-worktree implementer agents, **opus / high effort**, via `/implement`:
`git worktree add … -b … ; pnpm install --prefer-offline ; twux launch --role impl --model opus --effort high --doc docs/prompts/mp-S*.md --read docs/prompts/_worktree-note.md`.
Orchestrator merges each branch into `feat/unified-shell`, runs the full sweep (`pnpm typecheck` + `pnpm test`), and `/code-review`s per phase.

## Key decisions (from the PRD + grilling)
- Hot path (drum→render→controller) is local + untouched; client UI latency is allowed to lag.
- Frames already broadcast to all clients (visual parity ~free).
- `SingleClientLock` → `ClientRegistry` (multi-client + editor). Removal confirmed safe (only one active client today).
- Live authoring = **whole show-library blob** broadcast at low debounce (bandwidth tiny); granular edits deferred.
- Editor = first client; Takeover = **last-writer-wins**.
- Role-aware reconcile: editor/standalone **local-wins** (commit `06cb92e`); viewer **always follows** server.
- Networking default: cloudflared **quick** tunnel; **named** via config (no call-site change); room **PIN** gates WS.
- Tauri: server sidecar serves web; local-FS persistence under app-data; Mac signing/notarization.

## Gotchas
- Keep `packages/core` untouched.
- twux `--prompt` can paste-without-submitting — verify each launch started (`twux capture`); submit a `" "` if a `[Pasted text]` buffer is stuck.
- The `block-no-verify` hook false-positives on the literal string "git commit" in a bash command.
- Engine **inputs** (midi/osc/cc/programChange/key/recall) must NEVER be role-gated.

## Owed (carried from prior initiatives)
- Live `:5173` spot-checks remain owed across earlier initiatives; this one adds: two-machine live test (multi-client + takeover + tunnel + PIN + Tauri double-click/quit/persistence/Gatekeeper).
