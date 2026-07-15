# Observability + Backups — slice pack

Specs: GH **#122** (remote error reporting) · GH **#123** (project backups, blocked by #122).
Grilled decisions live in the issue bodies — briefs here add the dispatch contract only.
Seven slices: E1–E4 implement #122, B1–B3 implement #123.

## Wave plan (seam-gated)

| Wave | Slices | Parallel? | Why |
|---|---|---|---|
| 1 | E1 capture→bus · E3 ingest-worker · E4 sourcemaps | ✅ 3-wide | File-disjoint: protocol+web+client-message / new `apps/ingest-worker` / vite config+OTA scripts |
| 2 | E2 Reporter | serial | Shares server boot wiring + monitor-bus tap with E1's merge |
| 3 | B1 SnapshotStore | serial | Shares `boot.ts` + `client-message.ts` with E1/E2 merges |
| 4 | B2 restore WS+dialog · B3 off-site push | ✅ 2-wide | Disjoint by fence: B2 = protocol/client-message/web UI; B3 = worker routes + server queue wiring. B2 may not touch reporter/queue files; B3 may not touch `client-message.ts` or protocol. Merge B2 first |

Hot files forcing the serial spine: `apps/server/src/main.ts` + `boot.ts` (E1→E2→B1→B3 wiring), `apps/server/src/handlers/client-message.ts` (E1→B1→B2), `packages/protocol/src/index.ts` (E1→B2).

## Effort tiers

E2, B1, B2 = **high** (novel seams: Reporter, SnapshotStore; B2 is UI-significant). E1, E3, E4, B3 = **medium**. Never xhigh.

## The wire contract (shared seam: E2 ↔ E3, B3)

E2 and E3 are built in parallel/independently against THIS contract — do not improvise fields.

```
POST /ingest        Authorization: Bearer <token>
{ "reports": [ {
    "key": "<origin>|<message>|<topFrame>",      // dedup key
    "count": 3,                                   // occurrences this session so far
    "firstAt": 1770000000000, "lastAt": 1770000012345,   // epoch ms
    "envelope": {
      "machine": "...", "appVersion": "0.2.8", "engineMode": "voice",
      "platform": "darwin", "osRelease": "24.6.0",
      "sessionId": "<random per boot>", "uptimeMs": 123456, "origin": "web" | "server"
    },
    "error": { "message": "...", "stack": "...?", "source": "...?" },
    "breadcrumbs": [ /* MonitorEvent[], ≤20, first occurrence only */ ],
    "droppedReports": 0                           // queue drop counter, piggybacked
} ] }
→ 200 {"ok":true} · 401 bad token · 413 report >32KB · 429 per-machine rate limit

GET /reports?machine=&version=&since=&limit=      same bearer token → JSON array (newest first)

POST /backup?machine=<m>&reason=<r>&ts=<ISO>      same token, body = gzipped bundle
  → R2 key backups/<machine>/<ts>-<reason>.json.gz
GET /backups?machine=<m>                          → [{key,size,uploaded}]
GET /backup?key=<key>                             → blob
```

Discord webhook: Worker fires it only when `(machine, appVersion, key)` is new in D1. Count updates never ping.

## Universal dispatch rules (every slice)

- **Verify anchors against real code before building** — briefs pin paths because they're consumed now; if an anchor is wrong, say so in the report rather than forcing it.
- **Scope fence is honest**: crossing it obliges you to paste the diff of the out-of-fence change in your report.
- **Evidence**: committed-HEAD green (`pnpm typecheck` + `pnpm test`) AND pushed. Commit body is the report, ≤30 lines: what shipped, files touched, test-count delta, anchors that turned out wrong. Completion message = one line naming the commit and branch.
- **Non-negotiables** (AGENTS.md): `packages/core` stays pure; never block the render loop; no native addons. UI slices additionally: design system use-or-extend + `pnpm design-system` regen in the same change, `/make-interfaces-feel-better`, `pnpm ui-shot` captures.
- **Escalate, don't guess**: each brief lists its stop-and-ask triggers. Escalating a real ambiguity is success, not a stall.
- **No live infra from agents**: nothing deploys to Cloudflare, creates D1/R2 resources, or posts to a real Discord webhook. Produce config + README steps; Trent runs them.

## Briefs

- [E1 — Error capture net → Monitor bus](E1-capture-net.md)
- [E2 — Reporter: dedup, disk queue, shipper](E2-reporter.md)
- [E3 — Cloudflare ingest-worker (D1 + Discord)](E3-ingest-worker.md)
- [E4 — Hidden sourcemaps archived by OTA](E4-sourcemaps-ota.md)
- [B1 — SnapshotStore: bundle, triggers, retention](B1-snapshot-store.md)
- [B2 — Restore: WS messages + Backups dialog](B2-restore-ws-dialog.md)
- [B3 — Off-site backup push + Worker routes](B3-offsite-push.md)
