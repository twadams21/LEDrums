# Try Spatial Field + Audio modulation

Integrated experiment for #214. This is not a desktop release. Actual Ableton/interface/kit validation is a human check; automated tests use synthetic inputs.

## 1. See the field without audio

Choose **Spatial Field** from the normal effect library. Wire it to Output, set Scope to Whole Kit, and trigger it. Use Loop for continuous motion; One-shot for a hit-shaped field/ripple. Start with defaults; vary Scale and Twist to see a continuous volume sampled by the separate drums.

A voice owns its hit disturbance. A single looping voice does not subscribe to every later drum hit. Repeated one-shot voices each originate their own disturbance. This preserves the existing engine's voice model.

## 2. Route Ableton audio explicitly

1. Choose an input that actually carries Ableton: an audio interface's loopback input or an already-installed virtual audio device.
2. Route Ableton's intended output to it. Keep your audible monitoring route working separately.
3. In LEDrums Settings → Input → Audio, select that input and enable capture.
4. Check the Level/Bass/Mids/Highs meters before making a graph mapping.
5. Start with conservative gain and a noise floor above the room/interface's idle noise.

Running on the same Mac does **not** give LEDrums automatic access to Ableton's output. A microphone captures the room, not an isolated DAW bus. LEDrums does not install drivers, monitor audio to speakers, or record/stream raw audio. Browser microphone permission and device availability still apply.

## 3. Make the field react

Add an **Audio** modulation source and choose a band. Expose a numeric parameter on the effect and wire Audio to it using the existing target-side mapping:

- **Level → Brightness:** use a low minimum and a modest maximum, not full power by default.
- **Bass → Disturbance:** increase the hit ripple's strength with low-frequency energy.
- **Mids → Twist:** try a narrow range first so the field bends instead of flickering.
- **Highs → Scale:** small changes add texture without turning every cymbal into noise.

Audio works on existing effects/modifiers too. It does not fire hits or decide tempo. Disable capture to release the input; stopped or stale feature streams return modulation to zero (the mapping's minimum), not necessarily blackout if your mapping minimum is nonzero.

## 4. Supply timing from Ableton

Select MIDI Clock rather than Manual timing in LEDrums, then select the intended clock route. In Ableton's MIDI settings, enable **Sync** on that output. For the desktop app the native destination is **LEDrums**; browsers with WebMIDI can select an available input. Do not send the same clock through two routes.

Start/Continue/Stop and clock pulses drive musical transport. Existing notes and CCs remain available for precise hits and continuous control. No audio beat detection is involved.

Transport sync does not convert an effect authored in seconds into a beat-relative effect. Use tempo-synced controls where available. Treat external-clock Lost/Waiting status as a routing issue before adjusting effects.

## Hardware check still required

Check permission and capture in the packaged Mac webview; route real Ableton audio and clock; compare audible hits to the physical kit; stop audio/unplug its device and stop clock to confirm the visible recovery states. Synthetic browser/device tests cannot establish round-trip latency or physical light appearance.
