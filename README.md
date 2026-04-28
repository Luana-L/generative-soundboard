# generative-soundboard

An interactive WebAudio "mini algorave" soundboard. Three generative layers — rhythm, melody, texture — run on a shared transport and can be toggled, mixed, and reshaped live. Loosely inspired by [strudel.cc](https://strudel.cc/), but built from scratch on the raw WebAudio API.

## Layers

- **rhythm** — three drum voices (kick, snare, hat) driven by independent [Euclidean rhythms](https://louridas.github.io/rwa/assignments/musical-rhythms/) generated with Bjorklund's algorithm, so that k notes are evenly distributed over n time steps. Allows steps and pulses to be adjusted per voice; and pattern is recomputed live
- **melody** — randomized melodic line drawn from a **pitch class set** under transposition and inversion. Each note is rendered with FM
- **texture** — three detuned sawtooth oscillators through a lowpass filter whose cutoff is modulated by an LFO. Slow fades in/out

All three layers route through their own `GainNode`, then a master `GainNode`, then to `destination`.

## Project structure

```
index.html          UI shell
styles.css          UI styling
src/audio-engine.js Shared AudioContext, master bus, lookahead scheduler
src/rhythm.js       Bjorklund Euclidean rhythm + drum synthesis
src/melody.js       Pitch class set ops + FM synthesis voice
src/texture.js      Detuned-saw with LFO-modulated filter
src/main.js         DOM wiring
```

## Features

— FM synthesis
- Per-layer `GainNode` routing into a master `GainNode` into `destination`.
- `AudioParam` ADSR envelopes via `setTargetAtTime` for smooth volume / cutoff / detune ramps.
- **Pitch class set theory** in `melody.js` — transposition and inversion operations on pitch class sets
- A lookahead scheduler in `audio-engine.js` (`scheduler()` + `setInterval` clock) that schedules events
- **Bjorklund's algorithm** for Euclidean rhythms in `rhythm.js` — distributes `k` pulses as evenly as possible across `n` steps by iteratively merging remainder groups into front groups.