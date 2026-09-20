# Slice 01 — generate real `.amxd` device files

Role: implementer. One slice, one branch, one PR. Requested by **Trent** (Trent's MacBook Pro,
2026-09-20 session): "Let's build the .amxds" — the goal is a file Tim can drag onto an Ableton
track. Tim's Live edition is **assumed** (by Trent) to include Max for Live; not confirmed.

## Context (read first)

- `integrations/ableton/README.md` — what exists: generated `.maxpat` patch sources, the CJS
  `node.script` runtime, and the "not packaged or verified in Live" boundary.
- `integrations/ableton/generate.cjs` + `generate.test.cjs` — the patch generator you extend.
- The server half is merged and shipped (PR #218, v0.3.2). Do not touch it.

This machine has **no Ableton Live and no Max**. Nothing you produce can be load-tested here.
Never claim it loads in Live. Do not launch any desktop app.

## Deliver

1. **Container writer + reader** (new `integrations/ableton/amxd.cjs`, pure, no deps): wrap a
   patcher JSON string in the unfrozen Max for Live device container, and parse one back.
   Expected layout (chunked, little-endian u32 lengths) — **verify against at least two
   independent public sources before relying on it** (open-source `.amxd` parsers/converters,
   Cycling '74 forum/doc material) and cite them in the README:
   - `ampf` · u32 `4` · device type fourcc: `aaaa` audio effect, `mmmm` MIDI effect, `iiii` instrument
   - `meta` · u32 `4` · u32 value (confirm what unfrozen devices carry)
   - `ptch` · u32 byte-length · patcher JSON as UTF-8 (confirm any trailing newline/NUL convention)
   Length is **bytes, not characters**. Frozen (`mx@c`) containers are out of scope: the reader
   must reject them with a clear error rather than mis-parse.
2. **Patcher fields a device needs.** Research what a Live-saved unfrozen device's patcher JSON
   carries beyond a plain `.maxpat` (e.g. `openinpresentation`, `devicewidth`, a `project` /
   `amxdtype` block, parameter banks) and add what is required to `buildPatch`, keeping the
   `.maxpat` output valid. Record anything you could not confirm as an explicit unknown.
3. **Generator output.** `node integrations/ableton/generate.cjs` also writes
   `LEDrums MIDI.amxd` (type `mmmm`) and `LEDrums Audio.amxd` (type `aaaa`) beside the patches,
   byte-deterministic; `--check` fails when either is stale. Commit the generated files.
   In the `.amxd` variant, replace the in-device label "Patch source — not packaged or verified
   in Live" with a short build tag (e.g. `generated device · v1`) — the label is Tim-facing.
4. **Hand-off folder.** `node integrations/ableton/generate.cjs --pack <dir>` writes
   `<dir>/LEDrums Ableton Devices/` containing exactly: both `.amxd` files, the seven
   `SCRIPT_FILES` runtime files (unfrozen devices resolve `node.script` dependencies beside the
   device), and `READ ME FIRST.txt`. No tests, CLI, generator or `.maxpat`. `--pack` refuses a
   non-empty target folder; it never deletes anything.
5. **`READ ME FIRST.txt`** for Tim — a drummer, not a developer. ≤ 25 lines, numbered, plain
   words: needs Live Suite (or Standard + Max for Live) and LEDrums 0.3.2+ running on the same
   Mac; keep the folder together; drag `LEDrums MIDI` onto a MIDI track before the instrument /
   `LEDrums Audio` onto an audio track; where it shows up (LEDrums → Settings → Input → Track
   inputs); what the status line should say; if it says "Duplicate identity" click New identity
   and save the Set; what to send back to Trent if it fails (the status text + the Max Console
   lines starting `LEDrums-Node`). State plainly that this is a first test build.
6. **README.** Update `integrations/ableton/README.md`: status line, the new commands, the
   container format with citations, the unfrozen-dependency limitation ("Collect All and Save"
   and moving the `.amxd` alone break the script link until a freeze pass in Max), and keep the
   verification boundary honest — generated, structurally tested, **never loaded in Max/Live**.
   Replace the "do not merely rename" packaging step 1 with the generated-device path; keep the
   freeze + second-machine gates.

## Tests (Node built-in, alongside the existing ones)

- Exact header bytes per kind; `ptch` length equals the UTF-8 byte length (include a non-ASCII
  character in a fixture to prove bytes ≠ chars); nothing after the declared payload end.
- Round-trip: `read(write(json, kind))` deep-equals `buildPatch(kind)` and returns the kind.
- Reader rejects: truncated file, wrong magic, length overrun, frozen `mx@c` payload.
- `--check` detects a stale `.amxd`; generation is byte-identical across two runs.
- `--pack` folder contents are exactly the expected set; refuses a non-empty target.
- Every `SCRIPT_FILES` entry exists and is what both devices' `dependency_cache` lists.

## Fences

- Touch only `integrations/ableton/**`, `knip.json` if the dead-code gate needs it, and this
  plan folder. No server, protocol, web, or `.mex` edits — the orchestrator records GROW.
- No new dependencies, no bundler, no `pnpm install` (disk is tight; these files need none).
- Do not weaken or delete existing tests. Do not change the wire protocol or runtime behaviour.
- Do **not** run the full `pnpm test`. Run only:
  `node integrations/ableton/generate.cjs --check` and
  `node --test --test-concurrency=1 integrations/ableton/*.test.cjs`.
  The orchestrator runs the full sweep at review.

## Done

Branch `feat/ableton-amxd-devices` off `main`, committed, pushed, PR opened into `main` (do not
merge). Copy this plan folder into the branch at the same path. Report to the parent with
`SendMessage`: PR URL, HEAD sha, test counts, the format sources you cited, and a short list of
**unknowns that only a real Live load can settle**. Slim report — evidence, not narrative.
