---
last_updated: 2026-09-30
---

# Pattern Index

Lookup table for all pattern files in this directory. Check here before starting any task — if a pattern exists, follow it.

| Pattern | Use when |
|---------|----------|
| [stage-serialization.md](stage-serialization.md) | Serializing or consuming physical Stage drum frames without changing LED geometry |
| [audio-midi-inputs.md](audio-midi-inputs.md) | Verifying audio, named-track UDP inputs, MIDI Clock and dev timing without real inputs/output |
| [codebase-health-audit.md](codebase-health-audit.md) | Auditing performance, reliability, dead code and duplicated runtime logic |
| [add-generator-style.md](add-generator-style.md) | Adding a Style to an Effect-chain Generator, or changing which implementation a Style hosts |
| [add-an-effect.md](add-an-effect.md) | Adding a new underlying effect implementation to the registry (then give it a Generator Style) |
| [add-modifier.md](add-modifier.md) | Adding a pure framebuffer Modifier for Effect chains and the section Master chain |
| [add-a-graph-node-kind.md](add-a-graph-node-kind.md) | **Superseded** by Effect chains. Graph code only, until effect-chains S08 deletes it |
| [ui-shot-sweep.md](ui-shot-sweep.md) | Running or repairing the ui-shot screenshot sweep for gallery, shell, or visual close-out tasks |
| [section-graph-ownership.md](section-graph-ownership.md) | **Superseded** by Effect chains. Legacy section graph placement, until effect-chains S08 |
| [splice-material-regeneration.md](splice-material-regeneration.md) | Carrying short-lived stateful effect material through a deliberately slow splice cascade |
| [authoritative-recall-sync.md](authoritative-recall-sync.md) | Changing server-owned recall ordering, reconnect adoption, or canonical reference replay |
| [keyboard-ownership.md](keyboard-ownership.md) | Adding global keyboard shortcuts without stealing native or component keyboard accessibility |
