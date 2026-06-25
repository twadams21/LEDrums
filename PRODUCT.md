# Product

## Register

product

## Users

Two operators share one instrument, each in a different mode of the same app.

- **The technical designer (rig builder).** Designs the physical kit, power, and wiring; authors the *content* — effects, layers, modulation, output topology, kit geometry. Lives in the dense, configuration-heavy side of the app (Map, Routing, Effect/Modulation/Output panels). Wants depth, signal-flow legibility, and precise control without hand-holding.
- **The performer (show author + live operator).** Writes the music, sends MIDI/OSC into the engine, and arranges shows from the available content — building setlists, songs, sections, clip bindings — then triggers them live. Lives in the performance side (Perform, Arrange, Transport, Clip grid). Wants fast triggering, glanceable live state, and an interface that keeps up with a performance.

Both are artists. The tool serves the work first, but it is expected to be beautiful — craft is part of the spec, not a finish.

## Product Purpose

LEDrums is a real-time, cross-platform generative lighting engine and content-authoring app that drives a 3D LED-pixel drum kit. It maps live drum (MIDI) and Ableton (OSC) input plus authored layers (base / trigger / automation / effect) onto the XYZ pixels of each drum's hoops and outputs to Art-Net / sACN pixel controllers, with a live 3D visualizer preview in the browser.

It exists so a small creative team can design and perform light shows that are *native to a drum kit* — Composition → Layer → Clip → Effect, drum-pixel-native rather than 2D-media — from a single laptop on the LAN. Success is an operator who can build content and run a show end to end without leaving the app, trusting that what they see in the preview is what hits the rig.

## Brand Personality

A modern performance instrument: part lighting console, part modular synth, part live canvas. Dense, flat, and digital — never skeuomorphic. The interface is organized around **signal flow** (input → effect → layer → pixel → wire), and it earns its identity by **showing the work** — the project's own color and expressivity are first-class material on screen, not hidden behind chrome.

Three words: **engineered, expressive, fast**.

Voice: confident and terse, the way pro creative tools talk. Labels over explanations. The UI should feel like an instrument a working artist already trusts.

## Anti-references

- **Consumer SaaS dashboard** — rounded pastel cards, generous whitespace, hero metrics, marketing gloss. Too soft and too slow for a live tool.
- **Heavy skeuomorphism** — fake brushed metal, deep bevels, glossy knobs, drop-shadow overload. The instrument is digital and flat; depth comes from signal flow and hierarchy, not faux materials.
- **Bright creative-cloud look** — light backgrounds, candy gradients, Adobe/Figma-marketing energy. Wrong surface for a dark booth.

## Design Principles

1. **The tool disappears, the rig performs.** During a show the UI recedes so attention goes to the lights, the visualizer, and the music. Loud chrome competing with the output is a bug.
2. **Make the signal flow visible.** The interface should express the real path from input to pixel. Routing, layering, and modulation are the spine of the product; the layout should let an operator read that flow at a glance.
3. **One instrument, two operators.** Serve the technical designer's need for depth and density *and* the performer's need for speed and glanceability. Mode and progressive density resolve the tension — don't flatten one user to serve the other.
4. **Show the color.** The app is a canvas for the project's own expressivity. Live frame, effect output, and state color are materials in the design — surfaced and legible, not buried in a corner.
5. **Dense, but never noise.** Pack controls like a console, but hold legibility with hierarchy, rhythm, and restraint. Density is earned by readability in a dark room, not pixels-per-inch for its own sake.

## Accessibility & Inclusion

- **Dark booth, low light.** The primary context is a dark performance space. Maintain high contrast, glanceable state indicators, and generous hit targets; avoid blinding light surfaces.
- **WCAG AA baseline.** Hit AA contrast (4.5:1 body, 3:1 large text) across the dark UI — especially the muted/dim text and disabled states that are easy to under-contrast in a dark theme.
