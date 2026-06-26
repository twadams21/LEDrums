# S1 — Core/server seam: runtime-mutable geometry + routing (voice host)

Part of the **Patch Graph authoritative** mission (`docs/prompts/patch-graph-authoritative.md`, read it for the model). Branch `feat/unified-shell`.

## Why
The Inspector node editors (a later slice) must actually change real device behaviour **in voice mode** (`LEDRUMS_ENGINE=voice`, the active dev mode). Today `VoiceEngineHost` snapshots its model/dmxMap at construction, and kit/output mutations are only dispatched to the **legacy** `EngineHost` (`apps/server/src/main.ts:172`), never the voice host. There is also no message to mutate routing at all. You build that foundation. **Server + core only — touch no `apps/web` files.**

## Scope (disjoint file set — yours alone)
- `packages/core/src/geometry/kit-schema.ts`
- `packages/core/src/geometry/pixel-model.ts`
- `apps/server/src/voice-engine-host.ts`
- `apps/server/src/ws-protocol.ts`
- `apps/server/src/input-router.ts`
- `apps/server/src/main.ts`
- New/updated tests beside the above (`*.test.ts`).
- `packages/core/src/geometry/dmx-map.ts` is **pure and already correct** — read it, don't change it (it already reads `drum.pixelsPerHoop` from the built model).

## Tasks
1. **Literal pixel count.** Add `pixelsPerHoop: z.number().int().positive().optional()` to `drumSchema` (`kit-schema.ts`). In `pixel-model.ts`, the local `pixelsPerHoop(kit, drum)` (line ~67) must return `drum.pixelsPerHoop` verbatim when set, else the existing density computation. Add a `kitGlobalSchema` default if useful, but per-drum override is the contract. Unit-test: a drum with `pixelsPerHoop: 50` yields exactly 50 pixels/hoop regardless of density.

2. **Make the voice host runtime-mutable (live kit reload).** `VoiceEngineHost` currently builds the `PixelModel` + `dmxMap` once in its constructor. Give it the kit and reload methods:
   - keep the current `KitConfig` on the host (`this.kit`).
   - `reloadKit()` — rebuild `PixelModel` via `buildPixelModel(this.kit)`, `this.engine.setModel(model)`, rebuild `this.dmxMap = buildDmxMap(this.kit, this.model)`, refresh attrs/anything model-derived.
   - `setKitTransform(drumId, partial)` — mutate the matching `kit.drums[i]` (origin/rotation/localSpinDeg/startAngleDeg/**pixelsPerHoop**), then `reloadKit()`.
   - `setKitOutputs(outputs)` — set `this.kit.outputs = outputs`, rebuild `this.dmxMap` only (no model rebuild needed), then `reloadOutputSettings()`.
   - ensure `setInputMap(map)` and `setOutput(settings)` also take effect on the voice path (transport/input). If the voice host already routes input via a resolver, update it; if `setOutput` is purely `OutputManager` settings, `reloadOutputSettings()` may already cover it — verify and wire whatever is missing.

3. **New WS message.** Add to `ClientMessage` (`ws-protocol.ts`): `{ t: 'setKitOutputs'; outputs: OutputConfig[] }`. Extend the existing `setKitTransform` message with an optional `pixelsPerHoop?: number`. Add `setKitOutputs` to any allow-list/validator array in that file (there is a string array of message types ~line 53).

4. **Route mutations to the ACTIVE host.** In `input-router.ts` + `main.ts`, when in voice mode the kit/output/input mutations (`setKitTransform`, `setKitOutputs`, `setInputMap`, `setOutput`) must reach `voiceHost` (and trigger its reload), in addition to / instead of the legacy host as appropriate. Do not regress the legacy path when voice mode is off. Add the `setKitTransform`/`setKitOutputs` structural-reload to the `main.ts` block that currently lists `setOutput`/`setKitTransform`.

5. **Tests.** Add focused tests: `pixelsPerHoop` literal (pixel-model); a voice-host test that `setKitOutputs([...])` changes `dmxMap` (different `universes[0].pixelIds`), and that `setKitTransform(drumId, { pixelsPerHoop })` changes the model pixel count. Keep them deterministic.

## Acceptance
- `pnpm --filter @ledrums/core typecheck` and `pnpm --filter @ledrums/server typecheck` clean.
- New tests pass (`pnpm --filter @ledrums/core test`, `pnpm --filter @ledrums/server test`).
- A `setKitOutputs` from a client reorders the transmitted pixels in voice mode; a `setKitTransform { pixelsPerHoop }` changes geometry live — both without a server restart. (Unit-verify; live-verify is Trent's.)

## Don't
- Don't touch any `apps/web` file. Don't change `dmx-map.ts` logic. Don't merge to main. Don't rename existing message types (only add).

## Report back
Report to your parent (`twux send-message --session parent`) with: commit SHA, files touched, gate output, the new message shape, and anything you deviated on. **Commit your work** on `feat/unified-shell` before reporting (the parent verifies from git).
