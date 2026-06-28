# Kit — authoritative hoop pixel counts

Literal LED pixel count **per hoop** on the physical LEDrums kit (Trent, confirmed 2026-06-26). All hoops on a drum carry the same count. These are the authoritative `drum.pixelsPerHoop` values.

| Drum | Pixels per hoop |
|---|---|
| Kick | 196 |
| Snare | 108 |
| Tom 1 | 108 |
| Tom 2 | 136 |

## Notes
- Maps to `drum.pixelsPerHoop` (`packages/core/src/geometry/kit-schema.ts`, the literal-count override from S1).
- Wire these into the kit defaults (`DEFAULT_KIT` / web fixtures) so the rig boots with correct geometry.
- **Hardware:** Advatek PixLite **A4 in expanded mode** — 4 outputs, each driving 2 data lines (Data + repurposed Clock); 2 hoops in series per data line; **16 hoops → 8 data lines → 4 outputs → 1 controller**.
- **Dense routing:** pixels are packed channel-dense from universe 0 ch 0, contiguous across the ordered chain (output 1 / data line 1, output 1 / data line 2, output 2 / data line 1 …). Pixels, strips, and data lines may straddle universe boundaries. A single kick hoop = 196 px = 588 channels → spans >1 universe (512 ch). Each output (and data line) may carry an **optional** `startUniverse` override when a hard boundary is needed.
