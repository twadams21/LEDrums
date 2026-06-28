# PRD — Multiplayer (server-authoritative live) + Tauri desktop app

_Branch: `feat/unified-shell` · 2026-06-28 · status: ready-for-agent_

## Problem Statement

Trent and a drummer want to build a light show together while in different locations. The
drummer's Mac is the only machine that can run the real rig — the physical drums (MIDI in), the
pixel controller, and the Art-Net/sACN output all live there. Today the app assumes a single
client (a newest-wins lock evicts any second connection), so two people cannot have the app open
at once: the drummer can't watch Trent author, and Trent can't drive the drummer's rig from his
own machine. There is also no easy way for the non-technical drummer to expose his locally-running
app so Trent can reach it — Tailscale is too much to ask of him, and opening a port on his laptop
is undesirable. Finally, there is no double-click desktop app for the drummer to run; today it is a
dev-server workflow.

## Solution

Make the server (running on the drummer's Mac) the live source of truth that **many** clients can
connect to at once, with exactly **one editor** at a time. Any client can press **Takeover** in the
TopBar to become the editor; everyone else is a read-only **viewer** whose UI updates live as the
editor makes changes. The drum-hit → render → controller path stays entirely local on the drummer's
Mac and is never put on the network, so live lighting latency is unchanged. The rendered visual is
already broadcast to every client, so Trent's visualiser, the drummer's visualiser, and the lights
all match.

The drummer runs a **Tauri desktop app** (double-click to open, quit any time; authored state
persists to his local filesystem). On launch the app starts the server and an **outbound Cloudflare
tunnel** (no inbound port, no account) and shows a shareable **URL + room PIN** prominently. Trent
opens the URL on a normal browser, enters the PIN, and is connected — both the UI and the live
WebSocket ride that one tunnel. They stay on a video call and screen-share for mouse/pointer
context; the app handles state, role, and live updates.

## User Stories

1. As the drummer, I want to double-click an app icon to start everything, so that I don't need a
   terminal or dev setup.
2. As the drummer, I want to quit the app at any time and have all authored work already saved, so
   that I never lose changes.
3. As the drummer, I want my authored content stored on my own machine's filesystem, so that the
   show lives with the rig.
4. As the drummer, I want the app to show me a URL and a PIN I can read out on the call, so that
   Trent can join without any technical setup.
5. As the drummer, I want no port opened to the public internet on my laptop, so that I'm not
   exposing my machine.
6. As Trent (remote), I want to open a URL in my normal browser and enter a PIN, so that I can join
   the drummer's session with zero install.
7. As Trent, I want to press a "Takeover" button to become the editor, so that I can author the
   show from my machine.
8. As a viewer, I want the UI to clearly show who is currently editing and that I'm in view-only
   mode, so that I understand why I can't edit.
9. As a viewer, I want all edit affordances disabled (not just ignored) while viewing, so that I
   don't think a change took effect when it didn't.
10. As a viewer, I want the graph, sections, inspector, and all authored state to update live as the
    editor changes them, so that I can follow along without refreshing.
11. As the drummer (a viewer), I want to hit a drum and see the lights reflect the edit Trent just
    made, so that we can iterate together in real time.
12. As any client, I want the 3D/2D visualiser to match exactly what the server renders and sends to
    the controller, so that what I see is what the audience will see.
13. As Trent, I want my edits to appear on the drummer's screen near-instantly, so that collaboration
    feels live.
14. As the editor, I want my own edits to not bounce back and disrupt my in-progress work, so that
    editing feels stable.
15. As a viewer who presses Takeover, I want to immediately become the editor and the previous editor
    to drop to viewer, so that control transfers cleanly.
16. As two people who both press Takeover at nearly the same time, I want a deterministic outcome
    (last press wins) with both UIs reflecting the final state, so that we never get stuck.
17. As the editor, I want my authored changes to keep persisting to the drummer's local filesystem
    (server-authoritative), so that the show survives an app restart or a browser refresh.
18. As a user, I want a single client disconnecting (e.g. closing a tab) to not interrupt the others
    or the lighting output, so that the session is resilient.
19. As a user, I want the lighting output to keep running even when zero clients are connected, so
    that a network blip never goes dark.
20. As the editor, I want a node move / wire / any authored edit to survive a refresh on my own
    machine (standalone case), so that local editing is reliable.
21. As a viewer, I want a refresh to re-sync me to the server's current state, so that reconnecting
    is trivial.
22. As Trent, I want to optionally use a stable named URL (my own Cloudflare domain) instead of the
    random quick-tunnel URL, so that recurring sessions have a predictable address — without an app
    code change.
23. As the drummer, I want the app to recover (or clearly report) if the tunnel drops, so that a
    transient network issue is understandable.
24. As a security-conscious user, I want the room PIN to gate the WebSocket connection, so that a
    leaked tunnel URL alone can't join or edit the session.
25. As the editor, I want the live-lighting latency (drum → lights) to be unaffected by how many
    viewers are connected, so that collaboration never degrades the show.
26. As a Mac user, I want to open the app without fighting Gatekeeper, so that "double-click to run"
    is actually true.

## Implementation Decisions

### Roles & multi-client (server)

- Replace the single-client `SingleClientLock` with a **`ClientRegistry`** that holds many sockets
  and tracks a single **editor** socket. It stays socket-decoupled (a minimal socket interface, like
  the current lock) and **iterable**, so existing `for (const ws of clients)` broadcast loops
  (including the binary frame broadcast) work unchanged across all connected clients.
- The registry answers: `editorId` (current editor, or null), `isEditor(socket)`, `canMutate(socket)`,
  `takeover(socket)` (assigns the socket as editor, returns the demoted prior editor), `admit`/`remove`
  (now additive, not evicting), `size`, and a presence snapshot.
- **Editor election:** there is no auto-editor by default; the first client may auto-claim editor when
  there is none (so a solo session can edit immediately). `takeover` is **last-writer-wins**. On the
  editor disconnecting, the editor slot goes empty (or optionally falls to the oldest remaining
  client — decide in slice; default: empty until someone takes over, but auto-claim when exactly one
  client remains so the standalone case stays editable).
- **Mutation gating:** all authoring/editing client messages (e.g. `setShow`, `setShowLibrary`,
  `setKitTransform`, `setKitOutputs`, `setOutput`, `setInputMap`, setlist/song/section mutations) are
  applied only when `canMutate(socket)`. Non-editor mutations are rejected (no-op + an error/notice).
  Engine *inputs* (`midi`/`osc`/`cc`/`programChange`/`key`/recall) are NOT gated — they come from the
  drummer's local hardware and must always drive the engine regardless of who is editing.

### Presence & live authoring broadcast (protocol + server)

- New **client** message: `{ t: 'takeover' }`. (Optionally `{ t: 'auth'; pin }` at connect — see PIN.)
- New **server** message carrying role/presence, broadcast on join/leave/takeover. Shape (encodes the
  decision):

  ```
  { t: 'presence'; editorId: string | null; youAreEditor: boolean; clientCount: number }
  ```

  `editorId` is an opaque per-connection id the server assigns; `youAreEditor` is computed per
  recipient. The `state` message also carries the recipient's initial role so a fresh client knows
  immediately.
- **Live authoring broadcast:** when the editor pushes the authored show library, the server stores it
  (as today) AND **broadcasts it to all OTHER clients** so their UIs live-follow. Use the **whole
  show-library blob** (bandwidth is tiny) via a dedicated server message
  `{ t: 'showLibrary'; library: ShowLibraryBlob }` (lighter than a full `state` rebuild). The editor
  does not receive its own echo. The push debounce is lowered (~50–100ms) for liveness; granular
  per-edit messages are explicitly deferred.
- Rendered RGB frames continue to broadcast to every client (existing `onFrame` → binary broadcast),
  giving visual parity for free; verify it holds with multiple clients.

### Role-aware reconcile (web)

- The store gains a **role** (`editor` | `viewer`) derived from `presence`, plus the current editor
  identity for the indicator.
- `ShowLibrarySync` becomes **role-aware**:
  - **Editor / standalone:** keep the recently-shipped local-wins cold-load behavior (commit
    `06cb92e`) — local cache is the freshest source; push up to the server.
  - **Viewer:** **always follow the server live** — adopt every `showLibrary` broadcast (and the cold
    `state`), never prefer local. A viewer's localStorage is a passive mirror only.
- The editor ignores its own broadcast echo (signature-guarded, as today).

### Read-only UI & Takeover (web)

- A **Takeover** control in the TopBar plus an **editing/viewing indicator** ("You're editing" /
  "<editor> is editing — Viewing"). Pressing Takeover sends `{ t: 'takeover' }`; the resulting
  `presence` flips roles on all clients.
- When `role === 'viewer'`, **gate all edit entry points**: the store's authoring mutators no-op (or
  are disabled at the call sites) and edit affordances are visually disabled. Inputs that are
  view-only (selecting a graph to view, panning the canvas, switching views) remain available. The
  visualisers and live state remain fully live.

### Networking — tunnel (server / Tauri)

- A **`TunnelManager`** module manages a Cloudflare tunnel as a child process, with the process
  behind an injectable interface (for testing). Two modes, selected by config:
  - **Quick tunnel (default):** `cloudflared tunnel --url http://localhost:<port>` — outbound-only,
    no account, random `https://<id>.trycloudflare.com` URL parsed from stdout.
  - **Named tunnel (optional):** driven by a configured token/hostname for a stable URL on Trent's
    own Cloudflare domain. Same manager, different spawn args + credentials — switching is
    configuration, not a code change at call sites.
- The resolved share URL is surfaced to the UI (and shown prominently in the Tauri shell).
- **Room PIN:** the server requires a PIN to complete a WS session (an `auth` step or a PIN in the
  connect handshake/URL fragment). Connections without the correct PIN are refused before they can
  view or edit. The PIN is shown alongside the URL in the app.

### Tauri desktop app

- A Tauri shell wraps the existing node server as a **sidecar** and serves the built web UI from it
  (single origin → the UI and WS share the tunnel). The shell starts the server + the `TunnelManager`
  on launch, shows the share URL + PIN, and shuts both down cleanly on quit.
- Authored state persists to the local filesystem using the existing autosave (`projects/*.local.json`
  + the show library), relocated under the OS app-data directory for a packaged app.
- Mac-first (the drummer's machine) but the build stays cross-platform so Trent can also run it. The
  `cloudflared` binary is provided as a bundled/known sidecar; Mac signing/notarization is required so
  the drummer can open it without Gatekeeper friction.

### Sequencing (no spike — foundational-first)

The riskiest integration lands first and everything builds on it, so the order is its own de-risk:
1. Server `ClientRegistry` (multi-client + editor role + takeover + presence; remove the lock).
2. Protocol additions + live authoring broadcast + mutation gating (server).
3. Web role state + role-aware `ShowLibrarySync` follow + editor echo-ignore.
4. Web Takeover UI + read-only gating + presence indicator.
5. `TunnelManager` + PIN gate.
6. Tauri packaging (sidecar server + tunnel, local-FS persistence, URL/PIN surface, Mac signing).

## Testing Decisions

A good test asserts **external behavior** at the highest seam, never implementation details — given
inputs/messages, assert the observable outputs (broadcasts sent, role transitions, adopted state),
not internal fields.

- **`ClientRegistry` (unit, new):** mirrors `client-lock.test.ts`. Admit multiple sockets; first
  auto-claims editor; `takeover` is last-wins and demotes the prior editor; `canMutate` reflects role;
  presence snapshot updates on join/leave; `remove` of a non-editor doesn't change the editor; `remove`
  of the editor empties (or re-elects per the decided rule); frame/broadcast iteration covers all
  sockets.
- **Server message handling (integration):** drive `handleClientMessage` with a multi-socket capturing
  harness (extends the existing handler-test style). Assert: an editor's `setShowLibrary` is
  broadcast to the OTHER sockets (not echoed to itself) and persisted; a non-editor's mutation is
  rejected; `takeover` flips roles and emits `presence` to all; an unauthenticated/incorrect-PIN
  connect is refused; engine inputs are accepted regardless of role.
- **Web store/sync (extend `store.server-library.test.ts`):** using the capturing client harness,
  assert: a viewer live-follows `showLibrary` broadcasts; the editor ignores its own echo; `role`
  gates the read-only state; role-aware reconcile (editor/standalone local-wins vs viewer
  always-follow). The pure role-aware `ShowLibrarySync` decisions are unit-tested directly (mirrors
  its existing test style + the new `store.autosave.test.ts` save-path coverage).
- **`TunnelManager` (unit, new):** with a fake child-process, assert it selects the correct spawn for
  quick vs named mode, parses the URL from stdout, surfaces it, and tears down on stop; a crash/exit is
  reported.
- **Manual / not automated:** the real cloudflared tunnel reachability, the Tauri build + double-click
  run/quit, local-FS persistence in the packaged app, and Mac Gatekeeper — covered by a live two-machine
  checklist, not unit tests.

## Out of Scope

- Multi-writer concurrent editing / conflict resolution (CRDT/OT). Single-editor + takeover sidesteps
  it; a future revision-compare model is noted but not built.
- Public internet hosting, accounts, or third-party auth providers — only the call-based tunnel + PIN.
- Any change to the engine/render/output hot path (drum → render → controller stays local + unchanged).
- Granular per-edit authoring messages (whole-blob broadcast is sufficient at this scale).
- Tauri auto-update and full Windows/Linux packaging polish (cross-platform stays buildable; Mac is the
  shipped target for the drummer).

## Further Notes

- **Latency contract:** the only jitter-sensitive path is local (drum → server → render → controller)
  and must remain so; viewer/editor UI latency and authoring round-trips are explicitly allowed to lag.
- The recent cold-load persistence fix (`06cb92e`) is the editor/standalone half of the role-aware
  reconcile; this initiative generalizes it (viewers always follow the server).
- Named-tunnel support is configuration over a shared `TunnelManager`, so a stable URL needs no
  call-site code change — only Trent's Cloudflare config + a token.
- PIN UX: shown beside the URL in the Tauri shell; entered once by the joining client; gates the WS
  session (a leaked URL alone cannot join).
