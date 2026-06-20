---
created: 2026-04-21
codex-source-path: 10 Inbox/LEDrums Content Design.md
codex-review-status: unreviewed
area: personal
type: "[[Note]]"
---
# Layers
- Base
	- Always on, usually fairly consistent across the whole drum
- Trigger
	- 
- Automation
- Effect

# Principles / Definitions / Roles
- SPD is the Music / Section / Song Controller

| < Song | < Section |     |     |
| ------ | --------- | --- | --- |
| Song > | Section > |     |     |


# Philosophies
- Each song would have a 'base layer', a 'trigger layer', and an 'automation layer'
- Base Layer
	- Always on content that swirls and moves etc. - classical lighting design
- Trigger layer
	- Momentary effects in 1D, 2D, or 3D space, evolving over time (so there is movement) 
	- Could just be a flash
- Movement through no movement
	- Light is static but each hoop turns on sequentially so that you get the effect of a disk moving through the drum
- Ableton can trigger saved OSC patterns that trigger lighting effects in a sequence
- The sound is as integrated with the lights as possible
	- What you hear is what you see and vice versa



# Effects
Particular combinations of parameters and maybe controls *DONT LOVE THIS BUT IT'S CLOSE

## Chase (Trigger)
- 16th note arp. moving through each hoop over and over and over 
- Could also change drums with each beat (grouping of 4 beats)

## Pixel Accumulation
- Pixels turning on randomly throughout the drum with each hit (could be 1 section of a song)

## Colour Melody
- Each note is a different colour

## Burst (Note Length)
- Harder you hit it, the longer the note and the brighter / longer the light
	- How do we build a system that can dynamically do both? And allows a 'switch' in Ableton to turn on Brightness or Length control? 

## Swing
- Like pushing a swing, each hit 'tops up' the energy of the light and you time the hit like pushing a swing or returning a tennis shot

## Sidechain
- Duck the base layer to accentuate the effect & or accentuate the actual musical sidechain

## Whole Drum
- Something happens and all pixels of the DRUM display the same content across the whole drum

## Whole Kit
- Something happens and all pixels of the KIT display the same content across the whole KIT

## Follow Hoop
- Hoop 2 follows 1, 3 follows 2, and 4 follows 3 etc. 
- There is a delay time between each hoop
- 0ms delay time is effectively the 'Whole Drum' effect

## Synced Hoops
- Hoop 1 = Hoop 1 on all drums

## Sacred Hogs
- Top Hoop is sparkling orange like a halo
- Each hoop underneath has little 'hogs' / 'motorbikes' circling around
- The Hogs could explode when they crash into each other

## Collisions / Collide
- Nodes circling around the hoops
- Have a chance to collide into each other that causes a different effect to happen in that localised area

## Riser
- Speed controls the pitch
	- Faster = higher

## 3D Wash - Radial Out
- wash radiates out from the origin of the hit in 3D space using UV texture maps from computed XYZ coordinate locations of each pixel
- 
## 3D Wash - Radial In
- Collapses in from inf to origin

## 3D Wash - Bounce
- Goes out and in from an origin

## 3D Wipe - (in any rotational axis)
- 2D plane passing through the kit in any given rotational axis (X, Y or Z or some combination of them)
- Can be a transition, with no return
- Can be a temporary effect that returns with a fade out or another wipe in the same axis, in the same direction or reverse
- Or could just highlight pixels in a given distance from the plane (Colour band / Stripe)

## 3D Shape
- Explore once we have the kit built

## Meter - Graphic EQ
- Each hoop is a segment of a Graph.EQ that meters the volume and/or velocity
- Could use the whole kit to meter in the Z axis given that everything is in 3D space

# Transitions / Envelopes
Between effects
- How do we go between base and effect or automation etc 


# Controls
Vary paramaters to change the lights in various ways

- Note Velocity
	- Instantaneous ability to change parameters
- Ableton Automation
- Speed of notes
- Volume
	- like a 'master switch' - use it to crank up the Saturation or Brightness or Noise
- Drum Zones
	- Center
	- Edge
	- Rim Tip
	- Rim Shoulder
	- Shell
- Timbre
	- Distance from Center to Edge
	- Or between tip and shoulder
- 

# Parameters
The individual levers we have that we can pull to change the look / lights dynamically. Controlled by 'Controls'. 
OSC messages can be mapped to these params. These are basically params of video effects in Resolume

- Brightness
- Saturation
- Speed
- Noise
- Hue / Colour
- Spacing 
- Delay Time
- Delay Feedback



# Other things you can do with LEDrums

## Drum Hero
- Drums play back a series of notes, can you keep up?

## Virtual Concert
- Drummer is in a different city, and their playing is live streamed and played back on the lights of the drum

## Training Aid
- Similar to Drum Hero, flashes when you should hit the drum, can be gamified