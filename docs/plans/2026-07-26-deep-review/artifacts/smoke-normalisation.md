# server-smoke digest — normalisation contract (INIT-04 S0)

Harness: `scripts/server-smoke.mjs`. Digest version `server-smoke/1`.
Baselines `smoke-baseline-voice.json` / `smoke-baseline-legacy.json` originally captured at
branch `init/04-server-hardening`, HEAD `7d6c910` (post fix batches 1–3); re-captured once at
`6d5e717` (the banner commit — the digest gained the `state.recovery` shape, the one sanctioned
re-capture; stability proven by double-run diff per engine).

The digest is an ALLOW-LIST: anything not listed under "Retained" is not in the
digest; anything listed under "Retained" is never redacted.

## Retained

- **banner** — every non-empty stdout line up to capture end, with volatile
  substrings masked (see redactions). `LAN:` lines are excluded from the line
  list and collapsed to `lanUrlCount` (their count is retained; their IPs are not).
- **messageOrder** — the ordered sequence of JSON WS message types received by
  the first client, EXCLUDING the two high-rate streams (`stats` frames and
  binary preview frames), which interleave nondeterministically. This is the
  field that pins the load-bearing presence → state → monitor-replay ordering
  (main.ts connect handler).
- **state** — the first `state` message's `project` / `model` / `effects` /
  `projects` / `output` / `showLibrary` / `songLibrary` / `tunnel` / `osc` /
  `recovery` members reduced to recursive KEY SHAPES (objects → sorted key map, arrays →
  length + first-element shape, scalars → typeof; depth-limited), plus the one
  retained VALUE `osc.statusValue` (bound vs error is boot behaviour).
- **statsKeySets** — the first 3 `stats` frames' sorted key sets (top-level
  keys, `stats.*` keys, `voice.*` keys or null). Values are never retained.
- **monitor** — the ordered list of every `monitor` message's event reduced to
  `{type, source, destination, label}` (labels masked per redactions). Both the
  live events received after admit and the replayed history appear, in socket
  order.
- `harness`, `engine`, `seedCorrupt` — run parameters.

## Redacted / excluded

- Monitor event `id`, `time`, and `detail` (details carry ports, IPs, paths,
  endpoint URLs).
- All Date.now-derived identifiers: snapshot stems `${Date.now()}-boot`
  (snapshot-store.ts), autosave timestamps, `createdAt`.
- Client ids `c<n>` (client-registry.ts).
- Ports (TCP + UDP, masked to `:<port>` / `udp:<port>` / `<oscPort>`), IPv4
  addresses (`<ip>`), hostnames.
- randomUUIDs (`<uuid>`), the per-run host token and any 32–64 char hex token
  (`<token>`), the room PIN (`PIN <pin>`).
- mkdtemp absolute paths (never printed in retained lines; projects dir is a
  fresh temp dir per run).
- All numeric stats values: `time`, `timeMs`, `beat`, `latencyMs`, `fps`,
  `uptimeMs`, pixel/voice counts — only KEY SETS are retained.
- Binary preview frame contents and their position in the stream.

## Proven properties (S0 gates, all passed at 7d6c910)

1. **Stability** — two consecutive runs byte-identical, both `--engine voice`
   and `--engine legacy`. (Re-proven for the single remaining boot at INIT-01
   S12, which removed the flag — see below.)
2. **Negative control (a)** — deleting the `WebSocket client accepted` monitor
   emit in main.ts produces a non-empty digest diff.
3. **Negative control (b)** — swapping the presence-then-state send order in
   the connection handler produces a non-empty digest diff.

## Environment pinning

The harness clears every `LEDRUMS_*` env var, then sets: fresh temp
`LEDRUMS_PROJECTS_DIR` (boot is always `source: seed` unless `--seed-corrupt`),
`LEDRUMS_TELEMETRY=off`, and ephemeral `PORT` / `OSC_PORT`. `--seed-corrupt`
(added for S10) writes a truncated `default.local.json` before boot to exercise
the recovery ladder.

**INIT-01 S12 removed `--engine`** along with the legacy engine itself, so there
is one boot to digest and the digest no longer carries an `engine` field.
Passing the flag now exits 2 rather than being ignored. Consequences for this
note: `smoke-baseline-legacy.json` is historical and unreproducible, and
`smoke-baseline-voice.json` predates the INIT-01 chunks (its `engine` field, its
`[voice engine]` banner suffix and its `Server started in voice mode` monitor row
are all gone), so it is superseded rather than a live gate. S12's own parity
evidence is a before/after pair captured across its own commit, recorded in that
commit body.

Baselines are machine-local in one respect: `lanUrlCount` counts this machine's
non-internal IPv4 interfaces. Re-capture baselines when comparing on another
machine or when interfaces change.
